import { createFileRoute } from "@tanstack/react-router";

import { getTracegateServer } from "../../server/composition.ts";
import { apiErrorResponse, noStoreJson } from "../../server/http.ts";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const health = await (await getTracegateServer()).health(request.signal);
          return noStoreJson(health, { status: health.status === "unavailable" ? 503 : 200 });
        } catch (error) {
          return apiErrorResponse(error);
        }
      },
    },
  },
});
