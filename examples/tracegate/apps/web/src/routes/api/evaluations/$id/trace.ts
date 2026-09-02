import { createFileRoute } from "@tanstack/react-router";
import { EvaluationIdSchema, EventCursorSchema, TraceGateError, createControlError } from "@tracegate/shared";

import { getTracegateServer } from "../../../../server/composition.ts";
import { apiErrorResponse, assertLoopbackControlPlaneRequest, noStoreJson } from "../../../../server/http.ts";

export const Route = createFileRoute("/api/evaluations/$id/trace")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          assertLoopbackControlPlaneRequest(request);
          const evaluationId = EvaluationIdSchema.parse(params.id);
          const cursorValue = new URL(request.url).searchParams.get("cursor");
          const cursor = cursorValue === null ? null : EventCursorSchema.parse(cursorValue);
          const trace = await (await getTracegateServer()).getAgentTrace(evaluationId, cursor, request.signal);
          if (trace === null) {
            throw new TraceGateError(createControlError("not_found", "Evaluation trace not found.", {
              category: "incorrect_state",
              phase: "trace",
            }));
          }
          return noStoreJson(trace);
        } catch (error) {
          return apiErrorResponse(error);
        }
      },
    },
  },
});
