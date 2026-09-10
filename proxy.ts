import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Server-side route protection for /staff/* (§19, §25: "hidden UI routes"
 * are not authorization). Runs on every matching request, before any
 * Server Component renders — an unauthenticated request never reaches
 * page code, regardless of how it was made. (Next.js 16 renamed this file
 * convention from "Middleware" to "Proxy" — same mechanism, cosmetic rename.)
 *
 * This calls supabase.auth.getUser(), which revalidates against Supabase's
 * auth server rather than trusting the cookie's contents — the pattern
 * @supabase/ssr itself documents for this exact purpose. Next's own Proxy
 * guidance suggests lighter, cookie-only "optimistic" checks where
 * possible, but the real guarantee here is Postgres RLS (§26); this is
 * still just the fast-rejection layer, not the security boundary itself.
 *
 * Role/tenant checks (admin vs staff, restaurant scoping) are NOT here —
 * they can't be until the Phase 2 schema (restaurant_staff) exists. This
 * only answers "is there a valid Supabase session at all," and every
 * server action must independently re-check regardless (§19 finding).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isStaffRoute = pathname.startsWith("/staff");
  const isLoginRoute = pathname === "/staff/login";

  if (!isStaffRoute || isLoginRoute) {
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
  matcher: ["/staff/:path*"],
};
