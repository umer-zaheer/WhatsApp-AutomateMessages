import {
  getOrCreateSession,
  normalizeSessionId,
  subscribeToSession,
} from "@/lib/whatsapp/whatsapp";
import { buildConnectionPayload } from "@/lib/whatsapp/status";

const SESSION_COOKIE = "whatsapp_session";

export async function GET(request) {
  const sessionId = normalizeSessionId(
    request.cookies.get(SESSION_COOKIE)?.value
  );

  if (!sessionId) {
    return new Response("Missing session. Refresh the page.", { status: 400 });
  }

  getOrCreateSession(sessionId);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const pushUpdate = async () => {
        if (closed) return;

        try {
          const payload = await buildConnectionPayload(sessionId);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)
          );
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: error.message })}\n\n`
            )
          );
        }
      };

      await pushUpdate();

      const unsubscribe = subscribeToSession(sessionId, () => {
        pushUpdate().catch(() => {});
      });

      const heartbeat = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 30000);

      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
