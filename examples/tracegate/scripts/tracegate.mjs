import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const sharedEntry = path.join(root, "packages/shared/dist/index.js");
const webBuildOutput = path.join(root, "apps/web/dist/server");
const command = process.argv[2];
const hasExplicitTraceGatePort = process.env.TRACEGATE_PORT !== undefined;

const pnpmInvocation = (args) => ({
  executable: process.env.npm_execpath ?? "pnpm",
  args,
});

async function run(executable, args, options = {}) {
  const child = spawn(executable, args, {
    cwd: root,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  const forward = (signal) => child.kill(signal);
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
  process.removeListener("SIGINT", forward);
  process.removeListener("SIGTERM", forward);
  if (exitCode !== 0) throw new Error(`${path.basename(executable)} exited with code ${exitCode}`);
}

async function pnpm(args, env = process.env) {
  const invocation = pnpmInvocation(args);
  await run(invocation.executable, invocation.args, { env });
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function normalizedDatabaseUrl(raw) {
  if (!raw.startsWith("file:")) throw new Error("DATABASE_URL must use a local file: URL");
  const databasePath = raw.slice("file:".length);
  if (!databasePath || databasePath.startsWith("//")) {
    throw new Error("DATABASE_URL must name a local file without an authority");
  }
  const absolutePath = path.isAbsolute(databasePath)
    ? databasePath
    : path.resolve(root, databasePath);
  return { url: `file:${absolutePath}`, absolutePath };
}

async function validatedEnvironment() {
  if (!await exists(sharedEntry)) {
    await pnpm(["--filter", "@tracegate/shared", "build"]);
  }
  const { parseServerEnv } = await import(pathToFileURL(sharedEntry).href);
  const parsed = parseServerEnv({
    NODE_ENV: process.env.NODE_ENV,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    SOLARI_API_KEY: process.env.SOLARI_API_KEY,
    DATABASE_URL: process.env.DATABASE_URL ?? "file:./.tracegate/tracegate.db",
    TRACEGATE_BIND_HOST: process.env.TRACEGATE_BIND_HOST,
    TRACEGATE_PORT: process.env.TRACEGATE_PORT,
    TRACEGATE_LOG_LEVEL: process.env.TRACEGATE_LOG_LEVEL,
  });
  const database = normalizedDatabaseUrl(parsed.DATABASE_URL);
  await mkdir(path.dirname(database.absolutePath), { recursive: true });
  return {
    parsed,
    childEnv: { ...process.env, ...parsed, DATABASE_URL: database.url },
  };
}

async function databaseEnvironment() {
  const database = normalizedDatabaseUrl(process.env.DATABASE_URL ?? "file:./.tracegate/tracegate.db");
  await mkdir(path.dirname(database.absolutePath), { recursive: true });
  return { ...process.env, DATABASE_URL: database.url };
}

async function buildWorkspace() {
  await pnpm(["exec", "turbo", "run", "build", "--filter=!@tracegate/e2e"]);
}

async function migrateDatabase(env) {
  await pnpm(["--filter", "@tracegate/db", "db:migrate"], env);
}

const PORT_SCAN_ATTEMPTS = 50;

function loopbackUrl(host, port) {
  const displayHost = host.includes(":") ? `[${host}]` : host;
  return `http://${displayHost}:${port}`;
}

async function isPortAvailable(host, port) {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE" || error?.code === "EACCES") {
        resolve(false);
        return;
      }
      reject(error);
    });
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

async function selectDevPort(host, preferredPort) {
  if (hasExplicitTraceGatePort) {
    if (!await isPortAvailable(host, preferredPort)) {
      throw new Error(`TRACEGATE_PORT=${preferredPort} is unavailable on ${host}; choose another port`);
    }
    return preferredPort;
  }
  const finalCandidate = Math.min(65_535, preferredPort + PORT_SCAN_ATTEMPTS - 1);
  for (let candidate = preferredPort; candidate <= finalCandidate; candidate += 1) {
    if (await isPortAvailable(host, candidate)) return candidate;
  }
  throw new Error(`No available loopback port found from ${preferredPort} through ${finalCandidate}`);
}

async function serve(mode, env, host, port) {
  const viteCommand = mode === "dev" ? "dev" : "preview";
  console.log(`TraceGate: ${loopbackUrl(host, port)}`);
  await pnpm([
    "--filter", "@tracegate/web", "exec", "vite", viteCommand,
    "--host", host,
    "--port", String(port),
    "--strictPort",
  ], env);
}

async function main() {
  switch (command) {
    case "env": {
      const { parsed, childEnv } = await validatedEnvironment();
      console.log(JSON.stringify({
        status: "configured",
        bind: `http://${parsed.TRACEGATE_BIND_HOST}:${parsed.TRACEGATE_PORT}`,
        database: childEnv.DATABASE_URL.replace(root, "."),
        openRouter: "configured",
        solari: "configured",
      }, null, 2));
      return;
    }
    case "build":
      await buildWorkspace();
      return;
    case "db:generate":
    case "db:migrate":
    case "db:check": {
      const env = await databaseEnvironment();
      await pnpm(["--filter", "@tracegate/db", command], env);
      return;
    }
    case "dev": {
      await buildWorkspace();
      const { parsed, childEnv } = await validatedEnvironment();
      await migrateDatabase(childEnv);
      const port = await selectDevPort(parsed.TRACEGATE_BIND_HOST, parsed.TRACEGATE_PORT);
      const devEnv = { ...childEnv, TRACEGATE_PORT: String(port) };
      await serve("dev", devEnv, parsed.TRACEGATE_BIND_HOST, port);
      return;
    }
    case "start": {
      if (!await exists(webBuildOutput)) throw new Error("Web build is missing; run pnpm build first");
      const { parsed, childEnv } = await validatedEnvironment();
      await migrateDatabase(childEnv);
      await serve("preview", { ...childEnv, NODE_ENV: "production" }, parsed.TRACEGATE_BIND_HOST, parsed.TRACEGATE_PORT);
      return;
    }
    case "run": {
      await buildWorkspace();
      const { parsed, childEnv } = await validatedEnvironment();
      await migrateDatabase(childEnv);
      await serve("preview", { ...childEnv, NODE_ENV: "production" }, parsed.TRACEGATE_BIND_HOST, parsed.TRACEGATE_PORT);
      return;
    }
    case "health": {
      const { parsed } = await validatedEnvironment();
      const response = await fetch(`http://${parsed.TRACEGATE_BIND_HOST}:${parsed.TRACEGATE_PORT}/api/health`);
      console.log(`${response.status} ${await response.text()}`);
      if (!response.ok) process.exitCode = 1;
      return;
    }
    default:
      throw new Error("Expected one of: env, build, db:generate, db:migrate, db:check, dev, start, run, health");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "TraceGate command failed";
  console.error(`TraceGate: ${message}`);
  process.exitCode = 1;
});
