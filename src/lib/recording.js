export function getRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") return null;

  const candidates = [
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export function extensionForMimeType(mimeType) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("webm")) return "webm";
  return "audio";
}

export function blobToRecordingFile(blob, mimeType) {
  const ext = extensionForMimeType(mimeType);
  return new File([blob], `recording-${Date.now()}.${ext}`, { type: mimeType });
}
