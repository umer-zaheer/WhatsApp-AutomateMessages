import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { MessageMedia } from "whatsapp-web.js";
import { normalizePhoneNumber } from "@/lib/phone";
import {
  clearAuthData,
  destroySession,
  disconnectSession,
  getClient,
  getWhatsAppState,
  normalizeSessionId,
  restartSession,
} from "@/lib/whatsapp/whatsapp";

const SESSION_COOKIE = "whatsapp_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function resolveSession(request) {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  const sessionId = normalizeSessionId(existing);

  if (sessionId) {
    return { sessionId, isNew: false };
  }

  return { sessionId: randomUUID(), isNew: true };
}

function withSessionCookie(response, sessionId, isNew) {
  if (isNew) {
    response.cookies.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
  }

  return response;
}

function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}

function sanitizeFilename(name) {
  return path.basename(name).replace(/[^\w.\-()+\s]/g, "_") || "file";
}

async function saveUploadedFiles(sessionId, files) {
  const uploadDir = path.join(os.tmpdir(), "whatsapp-sender", sessionId);
  await mkdir(uploadDir, { recursive: true });

  const savedFiles = [];

  for (const file of files) {
    if (!(file instanceof File) || file.size === 0) continue;

    const filename = path.basename(file.name);
    const filePath = path.join(
      uploadDir,
      `${Date.now()}-${randomUUID().slice(0, 8)}-${sanitizeFilename(filename)}`
    );
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);
    savedFiles.push({ filePath, filename });
  }

  return savedFiles;
}

async function removeSavedFiles(savedFiles) {
  await Promise.all(
    savedFiles.map(({ filePath }) => unlink(filePath).catch(() => {}))
  );
}

async function parseSendPayload(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const numbersRaw = formData.get("numbers");

    let numbers = [];
    if (typeof numbersRaw === "string") {
      numbers = JSON.parse(numbersRaw);
    }

    const message = formData.get("message")?.toString() || "";
    const files = formData.getAll("files");

    return { numbers, message, files };
  }

  const body = await request.json();
  return {
    numbers: body.numbers,
    message: body.message || "",
    files: [],
  };
}

export async function GET(request) {
  try {
    const { sessionId, isNew } = resolveSession(request);
    const { status, qr, error, loadingMessage, startedAt } =
      getWhatsAppState(sessionId);
    let qrDataUrl = null;

    if (qr) {
      qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
    }

    const response = NextResponse.json({
      status,
      qrDataUrl,
      ready: status === "ready",
      sessionId,
      error,
      loadingMessage,
      startedAt,
    });

    return withSessionCookie(response, sessionId, isNew);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  let savedFiles = [];

  try {
    const { sessionId, isNew } = resolveSession(request);
    const { status } = getWhatsAppState(sessionId);
    const client = getClient(sessionId);
    const { numbers, message, files } = await parseSendPayload(request);
    const trimmedMessage = message?.trim() || "";

    if (status !== "ready") {
      const response = NextResponse.json(
        {
          success: false,
          error: "WhatsApp is not connected. Scan the QR code first.",
        },
        { status: 400 }
      );
      return withSessionCookie(response, sessionId, isNew);
    }

    if (!Array.isArray(numbers) || numbers.length === 0) {
      const response = NextResponse.json(
        { success: false, error: "Provide at least one phone number." },
        { status: 400 }
      );
      return withSessionCookie(response, sessionId, isNew);
    }

    savedFiles = await saveUploadedFiles(sessionId, files);

    if (!trimmedMessage && savedFiles.length === 0) {
      const response = NextResponse.json(
        {
          success: false,
          error: "Provide a message, at least one file, or both.",
        },
        { status: 400 }
      );
      return withSessionCookie(response, sessionId, isNew);
    }

    const results = [];

    for (const number of numbers) {
      const normalized = normalizePhoneNumber(number);
      if (!normalized) continue;

      try {
        const numberId = await client.getNumberId(normalized);

        if (!numberId) {
          results.push({
            number: normalized,
            status: "not_registered",
          });
          continue;
        }

        const chatId = numberId._serialized;

        if (savedFiles.length > 0) {
          for (let i = 0; i < savedFiles.length; i += 1) {
            const { filePath, filename } = savedFiles[i];
            const media = MessageMedia.fromFilePath(filePath);
            media.filename = filename;
            const caption = i === 0 && trimmedMessage ? trimmedMessage : undefined;

            if (caption) {
              await client.sendMessage(chatId, media, { caption });
            } else {
              await client.sendMessage(chatId, media);
            }
          }
        } else {
          await client.sendMessage(chatId, trimmedMessage);
        }

        results.push({
          number: normalized,
          status: "sent",
        });
      } catch (err) {
        results.push({
          number: normalized,
          status: "failed",
          error: err.message,
        });
      }
    }

    const response = NextResponse.json({
      success: true,
      results,
      sessionId,
    });

    return withSessionCookie(response, sessionId, isNew);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  } finally {
    await removeSavedFiles(savedFiles);
  }
}

export async function PATCH(request) {
  try {
    const existing = request.cookies.get(SESSION_COOKIE)?.value;
    const sessionId = normalizeSessionId(existing);

    if (sessionId) {
      await disconnectSession(sessionId);
    }

    const response = NextResponse.json({
      success: true,
      status: "disconnected",
      ready: false,
    });

    return clearSessionCookie(response);
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const existing = request.cookies.get(SESSION_COOKIE)?.value;
    const sessionId = normalizeSessionId(existing);
    const clearAuth = request.nextUrl.searchParams.get("clearAuth") === "true";

    if (sessionId) {
      await destroySession(sessionId);
      if (clearAuth) {
        await clearAuthData(sessionId);
      }
    }

    const newSessionId = randomUUID();
    await restartSession(newSessionId);

    const response = NextResponse.json({
      success: true,
      sessionId: newSessionId,
      status: "initializing",
      ready: false,
    });

    response.cookies.set(SESSION_COOKIE, newSessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
