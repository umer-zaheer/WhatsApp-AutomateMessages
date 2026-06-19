/**
 * Bulk WhatsApp Sender for Pakistani numbers (via whatsapp-web.js)
 * ------------------------------------------------------------------
 * 1. Reads a list of contacts from a .csv or .xlsx file
 *    (expects at least a "phone" column; an optional "name" column
 *    is used for personalization with {{name}})
 * 2. Normalizes every number into Pakistani international format
 *    (92XXXXXXXXXX, no +, no leading 0)
 * 3. Logs into WhatsApp Web (scan the QR code once, session is cached)
 * 4. Sends each contact a message, with a random delay between sends
 * 5. Writes a results log (sent / failed / not-on-whatsapp) to results.csv
 *
 * IMPORTANT — read before running:
 * - This uses an unofficial library that automates the WhatsApp Web
 *   client. WhatsApp's Terms of Service prohibit bulk/automated
 *   messaging, and accounts that send too fast or message numbers
 *   that haven't consented to contact get flagged and banned.
 * - Use this only for contacts who already expect to hear from you
 *   (existing customers, leads who opted in, etc.), keep volumes
 *   reasonable, and keep the delay between messages high enough
 *   (10–30s+) to look human. There is no setting that makes this
 *   risk-free — it just reduces it.
 */

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

// ----------------------- CONFIG -----------------------
const CONFIG = {
  // Path to your contacts file (.csv or .xlsx). Must have a "phone" column.
  INPUT_FILE: path.join(__dirname, 'contacts-sample.csv'),

  // Message to send. Use {{name}} to personalize if a "name" column exists.
  MESSAGE_TEMPLATE: 'Hello {{name}}, this is a message from our team.',

  // Delay between messages, in milliseconds. Randomized between min and max.
  MIN_DELAY_MS: 10000, // 10s
  MAX_DELAY_MS: 25000, // 25s

  // Where to write the send results log
  RESULTS_FILE: path.join(__dirname, 'results.csv'),
};
// --------------------------------------------------------

/**
 * Normalize a raw phone number string into Pakistani international
 * format expected by WhatsApp: "92XXXXXXXXXX" (no +, no leading 0).
 * Returns null if the number doesn't look like a valid PK mobile number.
 */
function normalizePakistaniNumber(raw) {
  if (!raw) return null;
  let num = String(raw).replace(/\D/g, ''); // strip everything but digits

  if (num.startsWith('0092')) num = num.slice(2);   // 0092xxxxxxxxxx -> 92xxxxxxxxxx
  if (num.startsWith('92')) {
    num = num;
  } else if (num.startsWith('0')) {
    num = '92' + num.slice(1);                       // 03xxxxxxxxx -> 923xxxxxxxxx
  } else if (num.length === 10 && num.startsWith('3')) {
    num = '92' + num;                                 // 3xxxxxxxxx -> 923xxxxxxxxx
  }

  // Valid PK mobile: 92 followed by 10 digits starting with 3 -> total 12 digits
  if (!/^923\d{9}$/.test(num)) return null;
  return num;
}

function loadContacts(filePath) {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

  const contacts = [];
  for (const row of rows) {
    // Be tolerant of header casing/variants
    const rawPhone = row.phone ?? row.Phone ?? row.PHONE ?? row.number ?? row.Number;
    const name = row.name ?? row.Name ?? row.NAME ?? '';
    const normalized = normalizePakistaniNumber(rawPhone);
    contacts.push({ rawPhone, name, normalized });
  }
  return contacts;
}

function buildMessage(template, name) {
  return template.replace(/{{\s*name\s*}}/gi, name || 'there');
}

function randomDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!fs.existsSync(CONFIG.INPUT_FILE)) {
    console.error(`Input file not found: ${CONFIG.INPUT_FILE}`);
    process.exit(1);
  }

  const contacts = loadContacts(CONFIG.INPUT_FILE);
  console.log(`Loaded ${contacts.length} rows from ${CONFIG.INPUT_FILE}`);

  const client = new Client({
    authStrategy: new LocalAuth(), // caches session so you don't re-scan every run
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  client.on('qr', (qr) => {
    console.log('Scan this QR code with WhatsApp (Linked Devices):');
    qrcode.generate(qr, { small: true });
  });

  client.on('authenticated', () => {
    console.log('Authenticated.');
  });

  client.on('ready', async () => {
    console.log('Client ready. Starting send run...\n');

    const results = [];

    for (let i = 0; i < contacts.length; i++) {
      const { rawPhone, name, normalized } = contacts[i];
      const label = `[${i + 1}/${contacts.length}] ${rawPhone}`;

      if (!normalized) {
        console.log(`${label} -> SKIPPED (invalid Pakistani number format)`);
        results.push({ phone: rawPhone, name, status: 'invalid_format' });
        continue;
      }

      try {
        const numberId = await client.getNumberId(normalized);
        if (!numberId) {
          console.log(`${label} -> SKIPPED (not registered on WhatsApp)`);
          results.push({ phone: rawPhone, name, status: 'not_on_whatsapp' });
          continue;
        }

        const text = buildMessage(CONFIG.MESSAGE_TEMPLATE, name);
        await client.sendMessage(numberId._serialized, text);
        console.log(`${label} -> SENT`);
        results.push({ phone: rawPhone, name, status: 'sent' });
      } catch (err) {
        console.log(`${label} -> FAILED (${err.message})`);
        results.push({ phone: rawPhone, name, status: 'failed: ' + err.message });
      }

      // Wait before the next message (skip wait after the last one)
      if (i < contacts.length - 1) {
        await randomDelay(CONFIG.MIN_DELAY_MS, CONFIG.MAX_DELAY_MS);
      }
    }

    // Write results log
    const ws = xlsx.utils.json_to_sheet(results);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'results');
    xlsx.writeFile(wb, CONFIG.RESULTS_FILE);
    console.log(`\nDone. Results written to ${CONFIG.RESULTS_FILE}`);

    await client.destroy();
    process.exit(0);
  });

  client.on('auth_failure', (msg) => {
    console.error('Authentication failure:', msg);
  });

  client.on('disconnected', (reason) => {
    console.log('Client disconnected:', reason);
  });

  client.initialize();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});