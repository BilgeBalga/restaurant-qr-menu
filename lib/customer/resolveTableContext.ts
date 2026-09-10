import "server-only";
import { resolveTableByToken, getRestaurant } from "@/app/actions/menu";
import { getTableCookie } from "@/lib/customer/tableSession";

export interface ResolvedTableContext {
  tableId: string;
  restaurantId: string;
  tableLabel: string;
  restaurantName: string;
  orderingEnabled: boolean;
  currency: string;
  /** Non-null only when resolved fresh from a ?table= query param this request — lets the page trigger a one-time cookie sync. */
  freshToken: string | null;
}

/**
 * Shared by every customer page: resolve from ?table=<token> if present
 * (supports /menu?table=X directly, not just /t/[token]), otherwise fall
 * back to the table cookie set at /t/[token] (§13). Either way, resolution
 * goes exclusively through resolve_table_by_token / the RLS-scoped
 * restaurants read — never a direct, unvalidated table lookup, and a
 * restaurant deactivated after the cookie was set re-resolves to null
 * here rather than silently trusting stale cookie data.
 */
export async function resolveCurrentTable(searchParamsTable?: string): Promise<ResolvedTableContext | null> {
  if (searchParamsTable) {
    const result = await resolveTableByToken(searchParamsTable);
    if (!result.ok || !result.data.tableActive || !result.data.restaurantActive) return null;
    return {
      tableId: result.data.tableId,
      restaurantId: result.data.restaurantId,
      tableLabel: result.data.tableLabel,
      restaurantName: result.data.restaurantName,
      orderingEnabled: result.data.orderingEnabled,
      currency: result.data.currency,
      freshToken: searchParamsTable,
    };
  }

  const cookie = await getTableCookie();
  if (!cookie) return null;

  const restaurant = await getRestaurant(cookie.restaurantId);
  if (!restaurant.ok) return null;

  return {
    tableId: cookie.tableId,
    restaurantId: cookie.restaurantId,
    tableLabel: cookie.tableLabel,
    restaurantName: restaurant.data.name,
    orderingEnabled: restaurant.data.orderingEnabled,
    currency: restaurant.data.currency,
    freshToken: null,
  };
}
