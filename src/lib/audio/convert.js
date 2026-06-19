import { execFile } from "child_process";
import { unlink } from "fs/promises";
import path from "path";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";
import { MessageMedia } from "whatsapp-web.js";

const execFileAsync = promisify(execFile);

export function isAudioFilename(filename) {
  return /\.(m4a|mp4|mp3|aac|ogg|opus|webm|wav)$/i.test(filename);
}

export async function prepareAudioForWhatsApp(savedFile) {
  const ext = path.extname(savedFile.filename).toLowerCase();
  if (ext === ".mp3") {
    return { ...savedFile, mimetype: "audio/mpeg" };
  }

  if (!ffmpegPath) {
    throw new Error("FFmpeg is not available on this server.");
  }

  const outputPath = savedFile.filePath.replace(/\.[^.]+$/, "") + ".mp3";
  const outputName = savedFile.filename.replace(/\.[^.]+$/, "") + ".mp3";

  await execFileAsync(
    ffmpegPath,
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      savedFile.filePath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "22050",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "64k",
      outputPath,
    ],
    { timeout: 30_000 }
  );

  if (savedFile.filePath !== outputPath) {
    await unlink(savedFile.filePath).catch(() => {});
  }

  return {
    filePath: outputPath,
    filename: outputName,
    mimetype: "audio/mpeg",
  };
}

export function applyMediaMetadata(media, savedFile) {
  media.filename = savedFile.filename;
  if (savedFile.mimetype) {
    media.mimetype = savedFile.mimetype;
  }
  return media;
}

export function buildMediaCache(savedFiles) {
  return savedFiles.map((savedFile) => {
    const media = applyMediaMetadata(
      MessageMedia.fromFilePath(savedFile.filePath),
      savedFile
    );

    return {
      mimetype: media.mimetype,
      data: media.data,
      filename: media.filename,
    };
  });
}

export function cloneMediaFromCache(cached) {
  const media = new MessageMedia(cached.mimetype, cached.data, cached.filename);
  media.filename = cached.filename;
  return media;
}

export function whatsappChatId(normalizedNumber) {
  return `${normalizedNumber}@c.us`;
}

export const FAST_SEND_OPTIONS = {
  sendSeen: false,
  linkPreview: false,
};
