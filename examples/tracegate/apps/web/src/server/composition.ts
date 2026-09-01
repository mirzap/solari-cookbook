import { TracegateDatabase } from "@tracegate/db";
import { parseServerEnv } from "@tracegate/shared";

import { FunctionalTracegateRuntime, SystemClock, persistBootCapabilities } from "./functional-runtime.ts";
import { TracegateServer } from "./tracegate-server.ts";

let singleton: Promise<FunctionalTracegateRuntime> | undefined;
let shutdown: Promise<void> | undefined;
let lifecycleInstalled = false;

function installLifecycle(): void {
  if (lifecycleInstalled) return;
  lifecycleInstalled = true;
  const close = () => { void shutdownTracegateServer().catch(() => { process.exitCode = 1; }); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

async function getRuntime(): Promise<FunctionalTracegateRuntime> {
  if (shutdown !== undefined) await shutdown;
  singleton ??= (async () => {
    const env = parseServerEnv({
      NODE_ENV: process.env.NODE_ENV,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      SOLARI_API_KEY: process.env.SOLARI_API_KEY,
      DATABASE_URL: process.env.DATABASE_URL ?? "file:tracegate-v2.db",
      TRACEGATE_BIND_HOST: process.env.TRACEGATE_BIND_HOST,
      TRACEGATE_PORT: process.env.TRACEGATE_PORT,
      TRACEGATE_LOG_LEVEL: process.env.TRACEGATE_LOG_LEVEL,
    });
    const database = await TracegateDatabase.open({
      url: env.DATABASE_URL,
      knownSecrets: [env.OPENROUTER_API_KEY, env.SOLARI_API_KEY],
    });
    try {
      await persistBootCapabilities(database, new SystemClock());
      const runtime = new FunctionalTracegateRuntime(database, {
        openRouterApiKey: env.OPENROUTER_API_KEY,
        solariApiKey: env.SOLARI_API_KEY,
        maximumConcurrency: 3,
      }, (schedule) => new TracegateServer(database, { onEvaluationCreated: schedule }));
      await runtime.recover(AbortSignal.timeout(10_000));
      installLifecycle();
      return runtime;
    } catch (error) {
      await database.close();
      throw error;
    }
  })();
  return singleton;
}

export async function getTracegateServer(): Promise<TracegateServer> {
  return (await getRuntime()).server;
}

export async function shutdownTracegateServer(): Promise<void> {
  if (shutdown !== undefined) return shutdown;
  const current = singleton;
  if (current === undefined) return;
  shutdown = (async () => {
    try {
      await (await current).close();
    } finally {
      if (singleton === current) singleton = undefined;
      shutdown = undefined;
    }
  })();
  return shutdown;
}
