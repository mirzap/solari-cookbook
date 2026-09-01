import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: PersistenceSpikePage });

function PersistenceSpikePage() {
  return (
    <main>
      <h1>TraceGate persistence feasibility</h1>
      <p>TG-005 proves an authoritative libSQL snapshot followed by persisted live milestones.</p>
    </main>
  );
}
