import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

function resolveMigrationsFolder(): string {
  const configured = process.env.TRACEGATE_MIGRATIONS_DIR?.trim();
  if (configured !== undefined && configured.length > 0 && !isAbsolute(configured)) {
    throw new Error("TRACEGATE_MIGRATIONS_DIR must be an absolute path.");
  }
  const folder = configured ?? fileURLToPath(new URL("../drizzle/", import.meta.resolve("@tracegate/db")));
  if (!existsSync(join(folder, "meta", "_journal.json"))) {
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
