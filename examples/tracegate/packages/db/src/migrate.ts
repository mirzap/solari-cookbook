import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function resolveMigrationsFolder(): string {
  const configured = process.env.TRACEGATE_MIGRATIONS_DIR?.trim();
  const candidates = [
    configured,
    fileURLToPath(new URL("../drizzle", import.meta.url)),
    resolve(process.cwd(), "packages/db/drizzle"),
    resolve(process.cwd(), "../../packages/db/drizzle"),
    resolve(process.cwd(), "examples/tracegate/packages/db/drizzle"),
  ].filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);
  const folder = candidates.find((candidate) => existsSync(resolve(candidate, "meta/_journal.json")));
  if (folder === undefined) {
    throw new Error("TraceGate database migrations are unavailable. Set TRACEGATE_MIGRATIONS_DIR to the packaged Drizzle migration directory.");
  }
  return folder;
}

export async function migrateTracegateDatabase(client: Client): Promise<void> {
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  await migrate(drizzle(client), { migrationsFolder: resolveMigrationsFolder() });
}
