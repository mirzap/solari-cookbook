import { randomUUID } from "node:crypto";

import {
  ApiErrorSchema,
  TraceGateError,
  createControlError,
  zodIssuesToFieldIssues,
} from "@tracegate/shared";
import { z } from "zod";

const isLoopback = (hostname: string): boolean => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";

export function assertLoopbackMutationRequest(request: Request): void {
  const url = new URL(request.url);
  if (!isLoopback(url.hostname)) {
    throw new TraceGateError(createControlError("validation_failed", "TraceGate mutations require a loopback control-plane host.", {
      category: "policy",
      phase: "http_policy",
    }));
  }
  const host = request.headers.get("host");
  if (host !== null && !isLoopback(new URL(`http://${host}`).hostname)) {
    throw new TraceGateError(createControlError("validation_failed", "Unexpected mutation Host header.", {
      category: "policy",
      phase: "http_policy",
    }));
  }
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== url.origin) {
    throw new TraceGateError(createControlError("validation_failed", "Unexpected mutation Origin header.", {
      category: "policy",
      phase: "http_policy",
    }));
  }
}

export function apiErrorResponse(error: unknown): Response {
  const requestId = randomUUID();
  const safe = error instanceof TraceGateError
    ? error.safe
    : error instanceof z.ZodError
      ? createControlError("validation_failed", "Request validation failed.", {
          category: "policy",
          phase: "request_validation",
          fieldIssues: zodIssuesToFieldIssues(error),
        })
      : error instanceof DOMException && error.name === "AbortError"
        ? createControlError("operation_aborted", "The operation was aborted.", { category: "cancellation", phase: "request" })
        : createControlError("internal_error", "The request could not be completed because of an internal service error.", {
            category: "unknown",
            phase: "request",
            retryable: true,
          });
  const status = safe.code === "not_found" ? 404
    : safe.code === "conflict" ? 409
      : safe.code === "capability_blocked" || safe.code === "service_unavailable" ? 503
        : safe.code === "internal_error" ? 500
          : 400;
  return Response.json(ApiErrorSchema.parse({ error: safe }), {
    status,
    headers: { "Cache-Control": "no-store", "X-Request-ID": requestId },
  });
}

export function noStoreJson(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(value, { ...init, headers });
}
