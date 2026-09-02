import {
  ApiErrorSchema,
  CreateEvaluationRequestSchema,
  CreateEvaluationResponseSchema,
  AgentTraceProjectionSchema,
  EvaluationIdSchema,
  EvaluationReportProjectionSchema,
  EvaluationSnapshotSchema,
  EventCursorSchema,
  EventEnvelopeSchema,
  EventListResponseSchema,
  RuntimeCapabilitiesSchema,
  type ControlError,
  type CreateEvaluationRequest,
  type CreateEvaluationResponse,
  type AgentTraceProjection,
  type EvaluationId,
  type EvaluationReportProjection,
  type EvaluationSnapshot,
  type EventCursor,
  type EventEnvelope,
  type EventListResponse,
  type RuntimeCapabilities,
} from "@tracegate/shared";

export class TracegateApiError extends Error {
  readonly safe: ControlError;
  readonly status: number;

  constructor(safe: ControlError, status: number) {
    super(safe.message);
    this.name = "TracegateApiError";
    this.safe = safe;
    this.status = status;
  }
}

async function parsedJson(response: Response): Promise<unknown> {
  const value: unknown = await response.json();
  if (!response.ok) {
    const parsed = ApiErrorSchema.parse(value);
    throw new TracegateApiError(parsed.error, response.status);
  }
  return value;
}

export class TracegateApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
  }

  async capabilities(signal?: AbortSignal): Promise<RuntimeCapabilities> {
    return RuntimeCapabilitiesSchema.parse(await parsedJson(await fetch(`${this.baseUrl}/api/capabilities`, {
      headers: { Accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    })));
  }

  async createEvaluation(input: CreateEvaluationRequest, signal?: AbortSignal): Promise<CreateEvaluationResponse> {
    const body = CreateEvaluationRequestSchema.parse(input);
    return CreateEvaluationResponseSchema.parse(await parsedJson(await fetch(`${this.baseUrl}/api/evaluations`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    })));
  }

  async cancelEvaluation(evaluationId: EvaluationId, signal?: AbortSignal): Promise<void> {
    const id = EvaluationIdSchema.parse(evaluationId);
    await parsedJson(await fetch(`${this.baseUrl}/api/evaluations/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { Accept: "application/json" },
      ...(signal === undefined ? {} : { signal }),
    }));
  }

  async snapshot(evaluationId: EvaluationId, signal?: AbortSignal): Promise<EvaluationSnapshot> {
    const id = EvaluationIdSchema.parse(evaluationId);
    return EvaluationSnapshotSchema.parse(await parsedJson(await fetch(`${this.baseUrl}/api/evaluations/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      ...(signal === undefined ? {} : { signal }),
    })));
  }

  async report(evaluationId: EvaluationId, signal?: AbortSignal): Promise<EvaluationReportProjection> {
    const id = EvaluationIdSchema.parse(evaluationId);
    return EvaluationReportProjectionSchema.parse(await parsedJson(await fetch(`${this.baseUrl}/api/evaluations/${encodeURIComponent(id)}/report`, {
      headers: { Accept: "application/json" }, cache: "no-store", ...(signal === undefined ? {} : { signal }),
    })));
  }

  async trace(evaluationId: EvaluationId, cursor: EventCursor | null = null, signal?: AbortSignal): Promise<AgentTraceProjection> {
    const id = EvaluationIdSchema.parse(evaluationId);
    const parsedCursor = cursor === null ? null : EventCursorSchema.parse(cursor);
    const query = parsedCursor === null ? "" : `?cursor=${encodeURIComponent(parsedCursor)}`;
    return AgentTraceProjectionSchema.parse(await parsedJson(await fetch(`${this.baseUrl}/api/evaluations/${encodeURIComponent(id)}/trace${query}`, {
      headers: { Accept: "application/json" }, cache: "no-store", ...(signal === undefined ? {} : { signal }),
    })));
  }

  async events(evaluationId: EvaluationId, cursor: EventCursor | null = null, signal?: AbortSignal): Promise<EventListResponse> {
    const id = EvaluationIdSchema.parse(evaluationId);
    const parsedCursor = cursor === null ? null : EventCursorSchema.parse(cursor);
    const query = parsedCursor === null ? "" : `?cursor=${encodeURIComponent(parsedCursor)}`;
    return EventListResponseSchema.parse(await parsedJson(await fetch(`${this.baseUrl}/api/evaluations/${encodeURIComponent(id)}/events${query}`, {
      headers: { Accept: "application/json" }, cache: "no-store", ...(signal === undefined ? {} : { signal }),
    })));
  }

  subscribe(
    evaluationId: EvaluationId,
    handlers: { readonly event: (event: EventEnvelope) => void; readonly error: () => void; readonly ready: () => void; readonly open?: () => void },
  ): () => void {
    const id = EvaluationIdSchema.parse(evaluationId);
    const source = new EventSource(`${this.baseUrl}/api/evaluations/${encodeURIComponent(id)}/events`);
    source.addEventListener("milestone", (message) => {
      if (message instanceof MessageEvent) handlers.event(EventEnvelopeSchema.parse(JSON.parse(String(message.data)) as unknown));
    });
    source.addEventListener("ready", () => handlers.ready());
    source.addEventListener("open", () => handlers.open?.());
    source.addEventListener("error", () => handlers.error());
    return () => source.close();
  }
}
