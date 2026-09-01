import { TracegateDatabase } from "@tracegate/db";

import { PersistenceSpikeServer } from "./persistence-spike.ts";

let singleton: Promise<PersistenceSpikeServer> | undefined;

export function getPersistenceSpikeServer(): Promise<PersistenceSpikeServer> {
  singleton ??= TracegateDatabase.open({
    url: process.env.DATABASE_URL ?? "file:./tracegate.db",
    knownSecrets: [
      process.env.OPENROUTER_API_KEY,
      process.env.SOLARI_API_KEY,
      process.env.DEMO_ADMIN_SECRET,
    ].filter((value): value is string => typeof value === "string" && value.length > 0),
  }).then((database) => new PersistenceSpikeServer(database));
  return singleton;
}
