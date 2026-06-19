const DEFAULT_COUNTRY_CODE = "92";

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function maybeParseScientificNotation(value) {
  const trimmed = String(value).trim();
  if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(trimmed)) {
    return String(Math.round(Number(trimmed)));
  }
  return trimmed;
}

function stripExcelCell(value) {
  let text = maybeParseScientificNotation(value).trim();
  text = text.replace(/^="?(.+?)"?$/, "$1");
  return text.trim();
}

export function normalizePhoneNumber(raw) {
  let digits = stripExcelCell(raw).replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("0")) {
    digits = DEFAULT_COUNTRY_CODE + digits.slice(1);
  } else if (
    digits.length === 10 &&
    digits.startsWith("3") &&
    !digits.startsWith(DEFAULT_COUNTRY_CODE)
  ) {
    digits = DEFAULT_COUNTRY_CODE + digits;
  }

  return digits;
}

export function parsePhoneNumbers(raw) {
  return raw
    .split(/[\n,;]+/)
    .map((part) => normalizePhoneNumber(part))
    .filter(Boolean);
}

function splitCsvCells(line) {
  return line
    .split(/[,;\t|]+/)
    .flatMap((cell) => cell.split(/\s+/))
    .map((cell) => stripExcelCell(cell))
    .filter(Boolean);
}

export async function readCsvText(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return stripBom(new TextDecoder("utf-16le").decode(buffer));
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return stripBom(new TextDecoder("utf-16be").decode(buffer));
  }

  return stripBom(new TextDecoder("utf-8").decode(buffer));
}

export function parseCsvNumbers(csvText) {
  const seen = new Set();
  const numbers = [];

  for (const line of stripBom(csvText).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    for (const cell of splitCsvCells(trimmed)) {
      const normalized = normalizePhoneNumber(cell);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        numbers.push(normalized);
      }
    }
  }

  return numbers;
}
