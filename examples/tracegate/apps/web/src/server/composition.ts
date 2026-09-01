import { TracegateDatabase } from "@tracegate/db";
import { parseServerEnv } from "@tracegate/shared";

import { TracegateServer } from "./tracegate-server.ts";

let singleton: Promise<TracegateServer> | undefined;

export function getTracegateServer(): Promise<TracegateServer> {
  singleton ??= (async () => {
    const env = parseServerEnv({
      NODE_ENV: process.env.NODE_ENV,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      SOLARI_API_KEY: process.env.SOLARI_API_KEY,
      DATABASE_URL: process.env.DATABASE_URL,
      TRACEGATE_BIND_HOST: process.env.TRACEGATE_BIND_HOST,
      TRACEGATE_PORT: process.env.TRACEGATE_PORT,
      TRACEGATE_LOG_LEVEL: process.env.TRACEGATE_LOG_LEVEL,
    });
    const database = await TracegateDatabase.open({
      url: env.DATABASE_URL,
      knownSecrets: [env.OPENROUTER_API_KEY, env.SOLARI_API_KEY].filter((value) => value.length > 0),
    });
    return new TracegateServer(database);
  })();
  return singleton;
}
