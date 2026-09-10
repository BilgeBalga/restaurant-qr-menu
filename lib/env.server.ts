import "server-only";
import { z } from "zod";
import { formatEnvError, getPublicEnv } from "@/lib/env";

/**
 * Server-only env vars, including the Supabase secret key (§26, §33).
 * The `server-only` import makes any accidental client-component import of
 * this module fail at build time rather than silently shipping a secret.
 *
 * Uses Supabase's current API key system (publishable/secret keys), not
 * the legacy anon/service_role names.
 */

const serverOnlySchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  SENTRY_DSN: z.string().optional(),
});

export type ServerEnv = ReturnType<typeof getPublicEnv> & z.infer<typeof serverOnlySchema>;

let cachedServerEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;
  const result = serverOnlySchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  cachedServerEnv = { ...getPublicEnv(), ...result.data };
  return cachedServerEnv;
}
