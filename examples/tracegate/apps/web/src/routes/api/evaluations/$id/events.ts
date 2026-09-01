import { createFileRoute } from "@tanstack/react-router";
import {
  EvaluationIdSchema,
  EventCursorSchema,
  TraceGateError,
  createControlError,
} from "@tracegate/shared";

import { getTracegateServer } from "../../../../server/composition.ts";
import { apiErrorResponse, noStoreJson } from "../../../../server/http.ts";

const notFound = () => new TraceGateError(createControlError("not_found", "Evaluation events not found.", {
  category: "incorrect_state",
  phase: "events",
}));

export const Route = createFileRoute("/api/evaluations/$id/events")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const evaluationId = EvaluationIdSchema.parse(params.id);
          const server = await getTracegateServer();
          if (request.headers.get("accept")?.includes("application/json") === true) {
            const rawCursor = new URL(request.url).searchParams.get("cursor");
            const cursor = rawCursor === null ? null : EventCursorSchema.parse(rawCursor);
            const events = await server.getEvents(evaluationId, cursor, request.signal);
            if (events === null) throw notFound();
            return noStoreJson(events);
          }
          const response = await server.eventStream(evaluationId, request.signal);
          if (response === null) throw notFound();
          return response;
        } catch (error) {
          return apiErrorResponse(error);
        }
      },
    },
  },
});
