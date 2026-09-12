import { z } from "zod";

/**
 * Public, browser-safe env vars. RLS — not secrecy — governs what the
 * publishable key can do (§26), so it's fine for this module to be
 * importable from client components. The secret key lives in
 * ./env.server.ts instead, which is import-guarded so it can never end up
 * in a client bundle.
 *
 * Uses Supabase's current API key system (publishable/secret keys), not
 * the legacy anon/service_role names.
 *
 * IMPORTANT — read every var via a static, literal `process.env.X`
 * expression, never by passing the whole `process.env` object around.
 * Next.js inlines NEXT_PUBLIC_* vars into the client bundle at build
 * time by finding literal `process.env.NEXT_PUBLIC_X` references in the
 * source; it cannot see "used" properties of a value that was handed to
 * something else as a whole object (e.g. `schema.safeParse(process.env)`).
 * That was the exact bug this file used to have: it worked on the server
 * (a real, fully-populated process.env there) and silently failed in the
 * browser (an effectively empty process.env, since nothing got inlined).
 *
 * Validation is lazy (on first call), not at module import time — several
 * routes render statically and must not require real credentials just to
 * build.
 */

const supabaseClientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const publicEnvSchema = supabaseClientEnvSchema.extend({
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

export type SupabaseClientEnv = z.infer<typeof supabaseClientEnvSchema>;
export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cachedSupabaseClientEnv: SupabaseClientEnv | undefined;
let cachedPublicEnv: PublicEnv | undefined;

export function formatEnvError(error: z.ZodError): string {
  const missing = error.issues.map((issue) => issue.path.join(".")).join(", ");
  return `Missing or invalid environment variables: ${missing}. Copy .env.example to .env.local and fill in real values.`;
}

/**
 * Exactly what constructing a Supabase client needs — nothing else.
 * createSupabaseServerClient/createSupabaseBrowserClient both call this,
 * not getPublicEnv(), specifically so building a Supabase client never
 * has an incidental dependency on NEXT_PUBLIC_APP_URL — neither of them
 * reads it, and OrderTracker's realtime subscription has no logical need
 * for the app's own canonical URL at all.
 */
export function getSupabaseClientEnv(): SupabaseClientEnv {
  if (cachedSupabaseClientEnv) return cachedSupabaseClientEnv;
  const raw = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
  const result = supabaseClientEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  cachedSupabaseClientEnv = result.data;
  return cachedSupabaseClientEnv;
}

/** The full public env, including NEXT_PUBLIC_APP_URL — for code that genuinely needs the app's own canonical URL (e.g. future QR-target generation). */
export function getPublicEnv(): PublicEnv {
  if (cachedPublicEnv) return cachedPublicEnv;
  const raw = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
  const result = publicEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  cachedPublicEnv = result.data;
  return cachedPublicEnv;
}
