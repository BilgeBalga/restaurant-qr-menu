import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Server-side route protection for /staff/* and /platform/* (§19, §25:
 * "hidden UI routes" are not authorization). Runs on every matching
 * request, before any Server Component renders — an unauthenticated
 * request never reaches page code, regardless of how it was made.
 * (Next.js 16 renamed this file convention from "Middleware" to "Proxy"
 * — same mechanism, cosmetic rename.)
 *
 * This calls supabase.auth.getUser(), which revalidates against Supabase's
 * auth server rather than trusting the cookie's contents — the pattern
 * @supabase/ssr itself documents for this exact purpose. Next's own Proxy
 * guidance suggests lighter, cookie-only "optimistic" checks where
 * possible, but the real guarantee here is Postgres RLS (§26); this is
 * still just the fast-rejection layer, not the security boundary itself.
 *
 * Role/tenant checks (admin vs staff, restaurant scoping) are NOT here,
 * and platform-admin status isn't either — this only answers "is there a
 * valid Supabase session at all." /platform/* pages independently call
 * requirePlatformAdmin() (lib/auth/session.ts), which re-derives platform
 * admin status from platform_admins every time — a restaurant admin who
 * clears this fast-rejection layer (they do have a valid session) is
 * still turned away there, same as every /staff/* authorization check
 * already works (§19 finding). No separate /platform login page exists
 * (or is needed) — unauthenticated requests to either area land on the
 * same /staff/login.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isStaffRoute = pathname.startsWith("/staff");
  const isPlatformRoute = pathname.startsWith("/platform");
  const isLoginRoute = pathname === "/staff/login";

  if ((!isStaffRoute && !isPlatformRoute) || isLoginRoute) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    // Misconfigured deployment — fail closed on staff routes rather than
    // silently letting the request through.
    return NextResponse.redirect(new URL("/staff/login", request.url));
  }

  const response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/staff/login", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/staff/:path*", "/platform/:path*"],
};
