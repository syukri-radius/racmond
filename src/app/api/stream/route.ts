import { ensureSeeded } from "@/lib/seed";
import { engine, startEngine, subscribe, type MetricUpdate, type StreamMessage } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Server-sent events channel that forwards the monitoring stream (metrics,
 * status transitions, alerts and CLI executor output) to the browser.
 */
export async function GET(request: Request) {
  await ensureSeeded();
  await startEngine();

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (message: StreamMessage | string) => {
        if (closed) return;
        try {
          const payload = typeof message === "string" ? message : `data: ${JSON.stringify(message)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
        }
      };

      send({ type: "hello", at: new Date().toISOString(), tick: engine.tick, nodeCount: engine.order.length });

      // immediate snapshot so a freshly connected client is in sync
      const updates: MetricUpdate[] = [];
      for (const id of engine.order) {
        const snapshot = engine.live.get(id);
        if (!snapshot) continue;
        updates.push({ nodeId: id, ...snapshot, status: engine.status.get(id) });
      }
      send({ type: "metrics", at: new Date().toISOString(), updates });

      unsubscribe = subscribe(send);
      heartbeat = setInterval(() => send(": keep-alive\n\n"), 15000);
      heartbeat.unref?.();

      const teardown = () => {
        closed = true;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", teardown, { once: true });
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
