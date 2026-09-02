import { createFileRoute } from "@tanstack/react-router";
import { EvaluationIdSchema } from "@tracegate/shared";

import { getTracegateServer } from "../../../../server/composition.ts";
import { apiErrorResponse, assertLoopbackMutationRequest, noStoreJson } from "../../../../server/http.ts";

export const Route = createFileRoute("/api/evaluations/$id/cancel")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        try {
          assertLoopbackMutationRequest(request);
          const evaluationId = EvaluationIdSchema.parse(params.id);
          await (await getTracegateServer()).cancelEvaluation(evaluationId, request.signal);
          return noStoreJson({ accepted: true }, { status: 202 });
        } catch (error) {
          return apiErrorResponse(error);
        }
      },
    },
  },
});
