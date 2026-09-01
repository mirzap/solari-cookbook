import { createFileRoute } from "@tanstack/react-router";
import { EvaluationIdSchema } from "@tracegate/shared";

import { getPersistenceSpikeServer } from "../../../../server/composition.ts";

export const Route = createFileRoute("/api/evaluations/$id/events")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const parsedId = EvaluationIdSchema.safeParse(params.id);
        if (!parsedId.success) return Response.json({ error: "invalid_evaluation_id" }, { status: 400 });
        const server = await getPersistenceSpikeServer();
        return server.eventStream(parsedId.data, request.signal);
      },
    },
  },
});
