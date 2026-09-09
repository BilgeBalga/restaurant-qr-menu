import { z } from "zod";

/**
 * Public, browser-safe env vars only. RLS — not secrecy — governs what the
 * anon key can do (§26), so it's fine for this module to be importable from
 * client components. The service-role key lives in ./env.server.ts instead,
 * which is import-guarded so it can never end up in a client bundle.
 *
 * Validation is lazy (on first call), not at module import time — several
 * Phase 1 routes render statically and must not require real credentials
 * just to build.
 */

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cachedPublicEnv: PublicEnv | undefined;

export function formatEnvError(error: z.ZodError): string {
  const missing = error.issues.map((issue) => issue.path.join(".")).join(", ");
  return `Missing or invalid environment variables: ${missing}. Copy .env.example to .env.local and fill in real values.`;
}

export function getPublicEnv(): PublicEnv {
  if (cachedPublicEnv) return cachedPublicEnv;
  const result = publicEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  cachedPublicEnv = result.data;
  return cachedPublicEnv;
}
