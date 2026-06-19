import QRCode from "qrcode";
import { getWhatsAppState } from "./whatsapp";

export async function buildConnectionPayload(sessionId) {
  const { status, qr, error, loadingMessage, startedAt } =
    getWhatsAppState(sessionId);
  let qrDataUrl = null;

  if (qr) {
    qrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
  }

  return {
    status,
    qrDataUrl,
    ready: status === "ready",
    sessionId,
    error,
    loadingMessage,
    startedAt,
  };
}
