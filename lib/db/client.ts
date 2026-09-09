import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getServerEnv } from "@/lib/env.server";
import * as schema from "@/lib/db/schema";

/**
 * Lazy singleton: the connection is opened on first use, not at module
 * import time, so nothing that merely imports this file needs a real
 * DATABASE_URL to build. Nothing calls this yet in Phase 1 — it's wired
 * and ready for the Phase 2 schema and Phase 6 order-creation server
 * actions to use.
 */
let cachedDb: ReturnType<typeof drizzle> | undefined;

export function getDb() {
  if (!cachedDb) {
    const env = getServerEnv();
    const queryClient = postgres(env.DATABASE_URL);
    cachedDb = drizzle(queryClient, { schema });
  }
  return cachedDb;
}
