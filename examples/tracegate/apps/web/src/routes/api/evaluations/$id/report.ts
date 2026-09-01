import { createFileRoute } from "@tanstack/react-router";
import { EvaluationIdSchema, TraceGateError, createControlError } from "@tracegate/shared";

import { getTracegateServer } from "../../../../server/composition.ts";
import { apiErrorResponse, noStoreJson } from "../../../../server/http.ts";

export const Route = createFileRoute("/api/evaluations/$id/report")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const evaluationId = EvaluationIdSchema.parse(params.id);
          const report = await (await getTracegateServer()).getReport(evaluationId, request.signal);
          if (report === null) {
            throw new TraceGateError(createControlError("not_found", "Evaluation report not found.", {
              category: "incorrect_state",
              phase: "report",
            }));
          }
          return noStoreJson(report);
        } catch (error) {
          return apiErrorResponse(error);
        }
      },
    },
  },
});
