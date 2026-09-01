import { createFileRoute } from "@tanstack/react-router";

import { getTracegateServer } from "../../server/composition.ts";
import { apiErrorResponse, assertLoopbackMutationRequest, noStoreJson } from "../../server/http.ts";

export const Route = createFileRoute("/api/evaluations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertLoopbackMutationRequest(request);
          const body: unknown = await request.json();
          const created = await (await getTracegateServer()).createEvaluation(body, request.signal);
          return noStoreJson(created, { status: 202 });
        } catch (error) {
          return apiErrorResponse(error);
        }
      },
    },
  },
});
