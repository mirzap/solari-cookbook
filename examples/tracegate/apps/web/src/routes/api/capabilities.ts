import { createFileRoute } from "@tanstack/react-router";

import { getTracegateServer } from "../../server/composition.ts";
import { apiErrorResponse, assertLoopbackControlPlaneRequest, noStoreJson } from "../../server/http.ts";

export const Route = createFileRoute("/api/capabilities")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          assertLoopbackControlPlaneRequest(request);
          return noStoreJson(await (await getTracegateServer()).getCapabilities(request.signal));
        } catch (error) {
          return apiErrorResponse(error);
        }
      },
    },
  },
});
