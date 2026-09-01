import type { EvaluationId, EventEnvelope } from "@tracegate/shared";

export interface SseOptions {
  readonly heartbeatMs?: number;
  readonly maxFrameBytes?: number;
}

export type MilestoneSubscriber = (event: EventEnvelope) => void;

export interface MilestoneSubscriptionSource {
  subscribe(evaluationId: EvaluationId, subscriber: MilestoneSubscriber): () => void;
}

const encoder = new TextEncoder();

export function createMilestoneSseResponse(
  source: MilestoneSubscriptionSource,
  evaluationId: EvaluationId,
  signal: AbortSignal,
  options: SseOptions = {},
): Response {
  const heartbeatMs = options.heartbeatMs ?? 15_000;
  const maxFrameBytes = options.maxFrameBytes ?? 64 * 1_024;
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs < 10) throw new Error("heartbeatMs must be at least 10");
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1_024) throw new Error("maxFrameBytes must be at least 1024");

  let cleanup = (): void => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      let active = true;
      const enqueue = (frame: string): void => {
        if (!active) return;
        const bytes = encoder.encode(frame);
        if (bytes.byteLength > maxFrameBytes) {
          active = false;
          cleanup();
          controller.error(new Error("SSE milestone exceeded the configured frame bound"));
          return;
        }
        controller.enqueue(bytes);
      };
      const unsubscribe = source.subscribe(evaluationId, (event) => {
        enqueue(`id: ${event.cursor}\nevent: milestone\ndata: ${JSON.stringify(event)}\n\n`);
      });
      const heartbeat = setInterval(() => enqueue(": heartbeat\n\n"), heartbeatMs);
      const abort = (): void => {
        if (!active) return;
        active = false;
        cleanup();
        controller.close();
      };
      cleanup = () => {
        clearInterval(heartbeat);
        signal.removeEventListener("abort", abort);
        unsubscribe();
      };
      signal.addEventListener("abort", abort, { once: true });
      enqueue("retry: 1000\nevent: ready\ndata: {\"subscribed\":true}\n\n");
      if (signal.aborted) abort();
    },
    cancel: () => cleanup(),
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
