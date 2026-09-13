import "server-only";
import { cookies } from "next/headers";

/**
 * SaaS Phase 5 — the "which of my several restaurants am I acting as"
 * selection hint. Mirrors lib/customer/tableSession.ts's exact shape and
 * the same "advisory only" contract that cookie already documents:
 * httpOnly, never read client-side, and NEVER trusted as authorization
 * by itself — every read of this value (lib/auth/session.ts's
 * requireActiveMembership()) re-validates it against a fresh
 * restaurant_staff query before it's allowed to select anything. A
 * missing, stale, or forged value degrades to "no selection," never to
 * "trust whatever's here."
 */
const COOKIE_NAME = "active_restaurant_id";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // a long-lived preference, not a security boundary — the DB check is what matters

export async function setActiveRestaurantCookie(restaurantId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, restaurantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function getActiveRestaurantCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}

/** Best-effort cleanup on sign-out — not a correctness requirement (a stale cookie is always re-validated regardless), just tidy. */
export async function clearActiveRestaurantCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
