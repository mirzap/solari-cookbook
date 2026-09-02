import { useEffect, useState } from "react";
import { EvaluationIdSchema, type EvaluationId, type EvaluationSnapshot, type EventEnvelope } from "@tracegate/shared";
import { TracegateApiClient, TracegateApiError } from "./api-client.ts";
import { EvaluationProjection } from "./event-projection.ts";

export type LiveConnectionState = "loading" | "live" | "recovering" | "stopped";

export interface LiveEvaluationState {
  readonly snapshot: EvaluationSnapshot | null;
  readonly connection: LiveConnectionState;
  readonly error: string | null;
}

const RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000] as const;

function safeMessage(error: unknown): string {
  if (error instanceof TracegateApiError) return error.safe.message;
  return "The latest evaluation snapshot could not be loaded.";
}

export function useLiveEvaluation(rawEvaluationId: string): LiveEvaluationState {
  const [state, setState] = useState<LiveEvaluationState>({ snapshot: null, connection: "loading", error: null });

  useEffect(() => {
    const parsedId = EvaluationIdSchema.safeParse(rawEvaluationId);
    if (!parsedId.success) {
      setState({ snapshot: null, connection: "stopped", error: "This evaluation identifier is invalid." });
      return undefined;
    }

    const evaluationId: EvaluationId = parsedId.data;
    const client = new TracegateApiClient();
    let stopped = false;
    let disconnect: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryIndex = 0;
    let activeController: AbortController | undefined;
    let projection: EvaluationProjection | undefined;
    let buffered: EventEnvelope[] = [];
    let refreshInFlight = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let trailingRefresh = false;

    const recover = () => {
      if (stopped) return;
      disconnect?.();
      disconnect = undefined;
      activeController?.abort();
      projection = undefined;
      buffered = [];
      setState((current) => ({ ...current, connection: "recovering" }));
      const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)] ?? 5_000;
      retryIndex += 1;
      retryTimer = setTimeout(connect, delay);
    };

    const hydrateAfterReady = async () => {
      if (stopped || refreshInFlight) return;
      refreshInFlight = true;
      activeController = new AbortController();
      try {
        const snapshot = await client.snapshot(evaluationId, activeController.signal);
        if (stopped) return;
        projection = new EvaluationProjection(snapshot);
        const pending = buffered.sort((left, right) => Number(BigInt(left.cursor) - BigInt(right.cursor)));
        buffered = [];
        for (const event of pending) projection.apply(event);
        retryIndex = 0;
        setState({ snapshot: projection.value, connection: "live", error: null });
      } catch (error: unknown) {
        if (!stopped && !activeController.signal.aborted) {
          setState((current) => ({ ...current, error: safeMessage(error) }));
          recover();
        }
      } finally {
        refreshInFlight = false;
      }
    };

    const refreshAuthoritativeSnapshot = async () => {
      if (stopped || projection === undefined) return;
      if (refreshInFlight) {
        trailingRefresh = true;
        return;
      }
      refreshInFlight = true;
      activeController = new AbortController();
      try {
        const snapshot = await client.snapshot(evaluationId, activeController.signal);
        if (stopped) return;
        projection = new EvaluationProjection(snapshot);
        const pending = buffered.sort((left, right) => Number(BigInt(left.cursor) - BigInt(right.cursor)));
        buffered = [];
        for (const event of pending) projection.apply(event);
        setState({ snapshot: projection.value, connection: "live", error: null });
      } catch (error: unknown) {
        if (!stopped && !activeController.signal.aborted) recover();
      } finally {
        refreshInFlight = false;
        if (trailingRefresh && !stopped) {
          trailingRefresh = false;
          refreshTimer = setTimeout(() => {
            refreshTimer = undefined;
            void refreshAuthoritativeSnapshot();
          }, 350);
        }
      }
    };

    const scheduleAuthoritativeRefresh = () => {
      if (refreshTimer !== undefined) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void refreshAuthoritativeSnapshot();
      }, 350);
    };

    function connect() {
      if (stopped) return;
      setState((current) => ({ ...current, connection: current.snapshot === null ? "loading" : "recovering" }));
      disconnect = client.subscribe(evaluationId, {
        ready: () => void hydrateAfterReady(),
        event: (event) => {
          if (stopped) return;
          if (projection?.value.latestCursor !== null
            && projection?.value.latestCursor !== undefined
            && BigInt(event.cursor) <= BigInt(projection.value.latestCursor)) return;
          if (projection === undefined || refreshInFlight) {
            buffered.push(event);
            if (refreshInFlight) trailingRefresh = true;
            return;
          }
          setState({ snapshot: projection.apply(event), connection: "live", error: null });
          scheduleAuthoritativeRefresh();
        },
        error: recover,
      });
    }

    connect();
    return () => {
      stopped = true;
      disconnect?.();
      activeController?.abort();
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    };
  }, [rawEvaluationId]);

  return state;
}
