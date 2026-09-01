import type { IncomingMessage, ServerResponse } from "node:http"

export interface FixtureJob {
  readonly id: string
  readonly title: string
  readonly company: string
  readonly salaryUsd: number
  readonly level: "mid" | "senior" | "staff"
}

export const FIXTURE_JOBS: readonly FixtureJob[] = [
  { id: "job-1", title: "Senior Software Engineer", company: "Northstar Labs", salaryUsd: 175_000, level: "senior" },
  { id: "job-2", title: "Staff Software Engineer", company: "Public Systems", salaryUsd: 210_000, level: "staff" },
  { id: "job-3", title: "Senior Frontend Engineer", company: "Cedar Works", salaryUsd: 155_000, level: "senior" },
  { id: "job-4", title: "Software Engineer", company: "Example Manufacturing", salaryUsd: 125_000, level: "mid" },
]

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function selected(actual: number, expected: number): string {
  return actual === expected ? " selected" : ""
}

export function renderJobBoard(url: URL): string {
  const query = (url.searchParams.get("query") ?? "").slice(0, 200)
  const minimumSalary = Number.parseInt(url.searchParams.get("minimumSalary") ?? "0", 10) || 0
  const normalizedQuery = query.trim().toLocaleLowerCase("en-US")
  const matches = FIXTURE_JOBS.filter(
    (job) =>
      job.salaryUsd >= minimumSalary &&
      (!normalizedQuery || job.title.toLocaleLowerCase("en-US").includes(normalizedQuery)),
  )
  const jobsJson = JSON.stringify(FIXTURE_JOBS).replaceAll("<", "\\u003c")
  const resultItems = FIXTURE_JOBS.map(
    (job) => `<article data-job-id="${job.id}" data-title="${escapeHtml(job.title)}" data-salary="${job.salaryUsd}"${matches.includes(job) ? "" : " hidden"}>
      <h2>${escapeHtml(job.title)}</h2>
      <p>${escapeHtml(job.company)}</p>
      <p>Salary $${job.salaryUsd.toLocaleString("en-US")}</p>
      <p>Level ${job.level}</p>
    </article>`,
  ).join("\n")

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Public engineering jobs — TraceGate fixture</title>
</head>
<body>
  <header><strong>TraceGate Public Job Board Fixture</strong></header>
  <main>
    <h1>Engineering jobs</h1>
    <p>This anonymous fixture supports safe search and filtering. It does not accept applications.</p>
    <form method="get" action="/jobs">
      <label for="query">Role keywords</label>
      <input id="query" name="query" type="search" maxlength="200" value="${escapeHtml(query)}">
      <label for="minimumSalary">Minimum salary</label>
      <select id="minimumSalary" name="minimumSalary">
        <option value="0"${selected(minimumSalary, 0)}>Any salary</option>
        <option value="150000"${selected(minimumSalary, 150_000)}>$150,000+</option>
        <option value="175000"${selected(minimumSalary, 175_000)}>$175,000+</option>
        <option value="200000"${selected(minimumSalary, 200_000)}>$200,000+</option>
      </select>
      <button type="submit">Search jobs</button>
    </form>
    <p id="status" role="status" aria-live="polite">${matches.length} matching jobs</p>
    <section id="results" aria-label="Job results">${resultItems}</section>
    <p><a href="/unsafe-controls">Adversarial unsafe-control fixture</a></p>
  </main>
  <script>
    (() => {
      const jobs = ${jobsJson};
      const applyFilter = (query, minimumSalary) => {
        const normalized = String(query || '').trim().toLocaleLowerCase('en-US');
        const minimum = Number(minimumSalary || 0);
        const matches = jobs.filter(job => job.salaryUsd >= minimum && (!normalized || job.title.toLocaleLowerCase('en-US').includes(normalized)));
        const ids = new Set(matches.map(job => job.id));
        for (const article of document.querySelectorAll('[data-job-id]')) article.hidden = !ids.has(article.dataset.jobId);
        document.querySelector('#query').value = query;
        document.querySelector('#minimumSalary').value = String(minimum);
        document.querySelector('#status').textContent = matches.length + ' matching jobs';
        const next = new URL(location.href);
        next.searchParams.set('query', String(query));
        next.searchParams.set('minimumSalary', String(minimum));
        history.replaceState(null, '', next);
        return matches;
      };
      if ('modelContext' in document && document.modelContext?.registerTool) {
        void document.modelContext.registerTool({
          name: 'search_jobs',
          title: 'Search public jobs',
          description: 'Find public job listings by role keywords and minimum salary',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', maxLength: 200 },
              minimumSalary: { type: 'integer', minimum: 0, maximum: 1000000 }
            },
            required: ['query', 'minimumSalary'],
            additionalProperties: false
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async ({ query, minimumSalary }) => JSON.stringify({ jobs: applyFilter(query, minimumSalary) })
        });
      }
    })();
  </script>
</body>
</html>`
}

function send(response: ServerResponse, status: number, body: string, contentType: string): void {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'",
    "content-type": contentType,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  })
  response.end(body)
}

export function handleJobBoardFixture(
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  const url = new URL(request.url ?? "/", "http://fixture.invalid")
  if (request.method !== "GET" && request.method !== "HEAD") return false
  if (url.pathname === "/" || url.pathname === "/jobs") {
    const body = renderJobBoard(url)
    send(response, 200, request.method === "HEAD" ? "" : body, "text/html; charset=utf-8")
    return true
  }
  if (url.pathname === "/llms.txt") {
    const body = "# TraceGate fixture\nAnonymous public engineering job search with role and minimum-salary filters.\n"
    send(response, 200, request.method === "HEAD" ? "" : body, "text/plain; charset=utf-8")
    return true
  }
  if (url.pathname === "/unsafe-controls") {
    const body = `<!doctype html><html lang="en"><head><title>Unsafe controls fixture</title></head><body><main>
      <h1>Unsafe controls</h1>
      <button>Sign in</button><button>Buy now</button><button>Delete account</button>
      <label>Upload résumé <input type="file" name="resume"></label>
      <form method="post" action="/message"><button type="submit">Send message</button></form>
    </main></body></html>`
    send(response, 200, request.method === "HEAD" ? "" : body, "text/html; charset=utf-8")
    return true
  }
  return false
}
