import { createFileRoute } from "@tanstack/react-router";
import { EvaluationIdSchema, TraceGateError, createControlError } from "@tracegate/shared";

import { getTracegateServer } from "../../../server/composition.ts";
import { apiErrorResponse, assertLoopbackControlPlaneRequest, noStoreJson } from "../../../server/http.ts";

export const Route = createFileRoute("/api/evaluations/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          assertLoopbackControlPlaneRequest(request);
          const evaluationId = EvaluationIdSchema.parse(params.id);
          const server = await getTracegateServer();
          const snapshot = await server.getSnapshot(evaluationId, request.signal);
          if (snapshot === null) {
            throw new TraceGateError(createControlError("not_found", "Evaluation not found.", {
              category: "incorrect_state",
              phase: "snapshot",
            }));
          }
          return noStoreJson(snapshot);
        } catch (error) {
          return apiErrorResponse(error);
        }
      },
    },
  },
});
