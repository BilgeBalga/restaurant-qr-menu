import { NextResponse, type NextRequest } from "next/server";
import { resolveTableByToken } from "@/app/actions/menu";
import { setTableCookie } from "@/lib/customer/tableSession";

/**
 * §12 QR landing route. A Route Handler, not a page — Server Components
 * can't write cookies during render, and this needs to (§13's table
 * capability). Resolution happens exclusively through
 * resolve_table_by_token (SECURITY DEFINER, §26) — never a direct table
 * read, and a leaked/revoked token resolves to nothing (§25).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await resolveTableByToken(token);

  if (!result.ok) {
    return NextResponse.redirect(new URL("/menu?error=invalid_table", _request.url));
  }

  if (!result.data.tableActive) {
    return NextResponse.redirect(new URL("/menu?error=table_inactive", _request.url));
  }

  await setTableCookie({
    tableId: result.data.tableId,
    restaurantId: result.data.restaurantId,
    tableLabel: result.data.tableLabel,
  });

  return NextResponse.redirect(new URL("/menu", _request.url));
}
