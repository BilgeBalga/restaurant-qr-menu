"use server";

import { resolveTableByToken } from "@/app/actions/menu";
import { setTableCookie } from "@/lib/customer/tableSession";

/**
 * Supports the /menu?table=<token> entry point directly (in addition to
 * the canonical /t/[token] QR route, §12) — same resolution, same
 * SECURITY DEFINER RPC, just invoked from a Server Action instead of a
 * Route Handler so a page render can trigger it client-side without
 * itself trying to write a cookie (Server Components can't).
 */
export async function syncTableCookieFromToken(token: string): Promise<boolean> {
  const result = await resolveTableByToken(token);
  if (!result.ok || !result.data.tableActive) return false;

  await setTableCookie({
    tableId: result.data.tableId,
    restaurantId: result.data.restaurantId,
    tableLabel: result.data.tableLabel,
  });
  return true;
}
