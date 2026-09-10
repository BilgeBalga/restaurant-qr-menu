import "server-only";
import { cookies } from "next/headers";

/**
 * §13: the "table capability" — set once at /t/[token] resolution, read
 * by every later customer page so the customer never re-scans or types a
 * table number. httpOnly because only server code needs to read it
 * (Server Components fetch the menu, then pass tableId to client
 * components as a prop) — no client-side cookie access needed at all.
 * Advisory only: create_order still independently validates tableId
 * server-side regardless of what this cookie says.
 */
const COOKIE_NAME = "ts_table";
const MAX_AGE_SECONDS = 60 * 60 * 6; // a few hours of inactivity, per §13

export interface TableCookieData {
  tableId: string;
  restaurantId: string;
  tableLabel: string;
}

export async function setTableCookie(data: TableCookieData): Promise<void> {
  const store = await cookies();
  store.set("ts_table", JSON.stringify(data), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function getTableCookie(): Promise<TableCookieData | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TableCookieData;
  } catch {
    return null;
  }
}
