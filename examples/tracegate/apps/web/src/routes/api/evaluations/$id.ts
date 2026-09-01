import { createFileRoute } from "@tanstack/react-router";
import { EvaluationIdSchema } from "@tracegate/shared";

import { getPersistenceSpikeServer } from "../../../server/composition.ts";

export const Route = createFileRoute("/api/evaluations/$id")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const parsedId = EvaluationIdSchema.safeParse(params.id);
        if (!parsedId.success) return Response.json({ error: "invalid_evaluation_id" }, { status: 400 });
        const server = await getPersistenceSpikeServer();
        const snapshot = await server.getSnapshot(parsedId.data, request.signal);
        return snapshot === null
          ? Response.json({ error: "evaluation_not_found" }, { status: 404 })
          : Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
      },
    },
  },
});
