import { rm, unlink } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import { Client, LocalAuth } from "whatsapp-web.js";

const execFileAsync = promisify(execFile);

const authDataPath = path.join(os.homedir(), ".whatsapp-sender", "wwebjs_auth");
const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const GLOBAL_KEY = "__whatsapp_sender_sessions__";
const INIT_TIMEOUT_MS = 90_000;

const PUPPETEER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-software-rasterizer",
  "--no-first-run",
  "--no-zygote",
];

function getSessionsMap() {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = new Map();
  }
  return globalThis[GLOBAL_KEY];
}

function createState() {
  return {
    status: "initializing",
    qr: null,
    error: null,
    loadingMessage: null,
    startedAt: Date.now(),
  };
}

function authSessionPath(sessionId) {
  return path.join(authDataPath, `session-${sessionId}`);
}

async function clearBrowserLocks(profileDir) {
  const lockNames = [
    "SingletonLock",
    "SingletonSocket",
    "SingletonCookie",
    "lockfile",
  ];

  await Promise.all(
    lockNames.map((name) => unlink(path.join(profileDir, name)).catch(() => {}))
  );
}

async function killOrphanBrowsers(sessionId) {
  const marker = `session-${sessionId}`;

  if (process.platform === "win32") {
    const script = [
      "Get-CimInstance Win32_Process",
      `| Where-Object { ($_.Name -match 'chrome|chromium') -and ($_.CommandLine -like '*${marker}*') }`,
      "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ].join(" ");

    try {
      await execFileAsync(
        "powershell.exe",
        ["-NoProfile", "-Command", script],
        { timeout: 15000 }
      );
    } catch (error) {
      console.warn(`[whatsapp] Could not kill orphan browsers:`, error.message);
    }
    return;
  }

  try {
    await execFileAsync("pkill", ["-f", marker], { timeout: 10000 });
  } catch {
    // No matching process — fine.
  }
}

async function prepareBrowserProfile(sessionId) {
  await killOrphanBrowsers(sessionId);
  await clearBrowserLocks(authSessionPath(sessionId));
}

function isBrowserAlreadyRunningError(error) {
  return /browser is already running/i.test(error?.message || "");
}

function attachClientEvents(client, state) {
  client.on("qr", (qr) => {
    state.status = "qr";
    state.qr = qr;
    state.error = null;
    state.loadingMessage = null;
  });

  client.on("authenticated", () => {
    state.status = "authenticated";
    state.qr = null;
    state.error = null;
  });

  client.on("ready", () => {
    state.status = "ready";
    state.qr = null;
    state.error = null;
    state.loadingMessage = null;
  });

  client.on("auth_failure", (message) => {
    state.status = "auth_failure";
    state.qr = null;
    state.error =
      typeof message === "string" ? message : "Authentication failed.";
  });

  client.on("disconnected", (reason) => {
    state.status = "disconnected";
    state.qr = null;
    state.error =
      typeof reason === "string" ? reason : "Disconnected from WhatsApp.";
  });

  client.on("loading_screen", (percent, message) => {
    state.loadingMessage = message || `Loading ${percent}%`;
  });
}

function scheduleInitTimeout(sessionId) {
  setTimeout(async () => {
    const sessions = getSessionsMap();
    const session = sessions.get(sessionId);
    if (!session || session.state.status !== "initializing") return;

    console.warn(
      `[whatsapp] Session ${sessionId} timed out while starting — restarting client`
    );

    try {
      await restartSession(sessionId);
    } catch (error) {
      session.state.status = "error";
      session.state.error = error.message;
    }
  }, INIT_TIMEOUT_MS);
}

async function startClient(session, { isRetry = false } = {}) {
  const { client, state, sessionId } = session;

  state.status = "initializing";
  state.qr = null;
  state.error = null;
  state.loadingMessage = isRetry
    ? "Recovering stale browser session…"
    : "Launching browser…";
  state.startedAt = Date.now();

  scheduleInitTimeout(sessionId);

  await prepareBrowserProfile(sessionId);

  try {
    await client.initialize();
  } catch (error) {
    if (!isRetry && isBrowserAlreadyRunningError(error)) {
      console.warn(
        `[whatsapp] Stale browser for ${sessionId}, cleaning up and retrying`
      );
      await prepareBrowserProfile(sessionId);
      return startClient(session, { isRetry: true });
    }

    console.error(`[whatsapp] initialize failed for ${sessionId}:`, error);
    state.status = "error";
    state.error = error.message || "Failed to start WhatsApp client.";
    state.loadingMessage = null;
  }
}

function createSession(sessionId) {
  const state = createState();
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: sessionId,
      dataPath: authDataPath,
    }),
    puppeteer: {
      headless: true,
      args: PUPPETEER_ARGS,
    },
  });

  attachClientEvents(client, state);

  const session = { client, state, sessionId, initPromise: null };
  session.initPromise = startClient(session);

  return session;
}

export function normalizeSessionId(value) {
  if (!value || !SESSION_ID_REGEX.test(value)) {
    return null;
  }
  return value;
}

export function getOrCreateSession(sessionId) {
  const id = normalizeSessionId(sessionId);
  if (!id) {
    throw new Error("Invalid session id");
  }

  const sessions = getSessionsMap();
  if (!sessions.has(id)) {
    sessions.set(id, createSession(id));
  }

  return sessions.get(id);
}

export async function destroySession(sessionId) {
  const id = normalizeSessionId(sessionId);
  if (!id) return;

  const sessions = getSessionsMap();
  const session = sessions.get(id);
  if (!session) return;

  sessions.delete(id);

  try {
    await session.client.destroy();
  } catch (error) {
    console.warn(`[whatsapp] destroy failed for ${id}:`, error.message);
  }

  await prepareBrowserProfile(id);
}

export async function clearAuthData(sessionId) {
  const id = normalizeSessionId(sessionId);
  if (!id) return;

  await rm(authSessionPath(id), { recursive: true, force: true }).catch(() => {});
}

export async function disconnectSession(sessionId) {
  const id = normalizeSessionId(sessionId);
  if (!id) return;

  const sessions = getSessionsMap();
  const session = sessions.get(id);

  if (session) {
    sessions.delete(id);

    try {
      await session.client.logout();
    } catch (error) {
      console.warn(`[whatsapp] logout failed for ${id}:`, error.message);
      try {
        await session.client.destroy();
      } catch (destroyError) {
        console.warn(`[whatsapp] destroy failed for ${id}:`, destroyError.message);
      }
    }
  }

  await clearAuthData(id);
  await prepareBrowserProfile(id);
}

export async function restartSession(sessionId) {
  await destroySession(sessionId);
  const session = getOrCreateSession(sessionId);
  await session.initPromise.catch(() => {});
  return session;
}

export function getWhatsAppState(sessionId) {
  return getOrCreateSession(sessionId).state;
}

export function getClient(sessionId) {
  return getOrCreateSession(sessionId).client;
}
