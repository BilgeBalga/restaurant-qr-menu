"use client";

import { useEffect, useRef } from "react";
import { syncTableCookieFromToken } from "@/app/actions/customerSession";

/**
 * Persists the table cookie when a page was reached via ?table=<token>
 * rather than /t/[token] directly — Server Components can't write
 * cookies during render, so this fires once client-side after mount.
 * Renders nothing; a missed sync just means the next request falls back
 * to re-resolving the query param, not a broken experience.
 */
export function TableCookieSync({ token }: { token: string }) {
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current) return;
    synced.current = true;
    void syncTableCookieFromToken(token);
  }, [token]);
  return null;
}
