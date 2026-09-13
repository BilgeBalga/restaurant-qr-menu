"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, toActionResult, type ActionResult } from "@/lib/errors";
import { requireActiveMembership } from "@/lib/auth/session";
import { logAuditEvent } from "@/lib/audit";
import { getTableCookie, setTableCookie } from "@/lib/customer/tableSession";
import {
  createOrderInputSchema,
  orderHistoryFiltersSchema,
  setOrderStatusInputSchema,
  type CreateOrderInput,
} from "@/lib/validation/order";
import { canTransition, TERMINAL_STATUSES, type OrderStatus } from "@/lib/business/orderStateMachine";
import { can } from "@/lib/business/permissions";
import { startOfDayInTimeZone, startOfNextDayInTimeZone } from "@/lib/business/timezone";

export interface CreateOrderResult {
  orderId: string;
  orderNumber: string;
  accessToken: string;
  totalCents: number;
}

/**
 * §9/§26: the client sends only menu_item_id/quantity/option_choice_ids —
 * never a price. The create_order RPC re-fetches and re-prices everything
 * server-side; this action's only job is shape validation (Zod) and
 * translating the RPC's result/errors into an ActionResult (§28) — it is
 * NOT where the pricing or availability guarantee lives.
 *
 * §18 closed-session detection: the httpOnly table cookie optionally
 * remembers which table_session_id this browser last ordered into. That
 * id (never anything client-supplied — read straight from the cookie) is
 * passed to create_order, which rejects outright if staff have since
 * closed that specific session — the stale-refresh scenario. A fresh QR
 * scan resets the cookie with no session id (lib/customer/tableSession.ts),
 * so it never blocks a genuinely new session at the same table. The cookie
 * is advisory only, same as tableId already was: create_order is the
 * actual enforcement layer regardless of what this action sends it.
 */
export async function createOrder(input: CreateOrderInput): Promise<ActionResult<CreateOrderResult>> {
  const parsed = createOrderInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(
      new AppError("VALIDATION_ERROR", parsed.error.message, "That order doesn't look right — please try again."),
    );
  }

  const { tableId, items, customerNote, idempotencyKey } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const tableCookie = await getTableCookie();
  const knownSessionId = tableCookie?.tableId === tableId ? (tableCookie.sessionId ?? null) : null;

  const { data, error } = await supabase.rpc("create_order", {
    p_table_id: tableId,
    p_items: items.map((item) => ({
      menu_item_id: item.menuItemId,
      quantity: item.quantity,
      option_choice_ids: item.optionChoiceIds,
      line_note: item.lineNote ?? null,
    })),
    p_customer_note: customerNote ?? null,
    p_idempotency_key: idempotencyKey,
    p_session_id: knownSessionId,
  });

  if (error) {
    return toActionResult(new AppError("CONFLICT", error.message, friendlyOrderError(error.message)));
  }

  const row = data as {
    order_id: string;
    order_number: string;
    access_token: string;
    total_cents: number;
    table_session_id: string;
  };

  if (tableCookie && tableCookie.tableId === tableId && tableCookie.sessionId !== row.table_session_id) {
    await setTableCookie({ ...tableCookie, sessionId: row.table_session_id });
  }

  return {
    ok: true,
    data: { orderId: row.order_id, orderNumber: row.order_number, accessToken: row.access_token, totalCents: row.total_cents },
  };
}

/** create_order's RAISE EXCEPTION messages are DB-internal error codes — never shown to the customer verbatim. */
function friendlyOrderError(message: string): string {
  if (message.startsWith("MENU_ITEM_UNAVAILABLE")) {
    const name = message.split(":")[1]?.trim();
    return name ? `${name} just sold out — remove it and try again.` : "One of these items just sold out.";
  }
  if (message.startsWith("OPTION_UNAVAILABLE")) {
    const name = message.split(":")[1]?.trim();
    return name ? `${name} is no longer available — remove it and try again.` : "One of the selected options is no longer available.";
  }
  if (message.startsWith("TABLE_INACTIVE")) return "This table isn't currently in service.";
  if (message.startsWith("RESTAURANT_INACTIVE")) return "This restaurant isn't currently available.";
  if (message.startsWith("ORDERING_DISABLED")) return "This restaurant isn't taking orders right now.";
  if (message.startsWith("EMPTY_ORDER")) return "Your cart is empty.";
  if (message.startsWith("INVALID_QUANTITY")) return "Please choose a valid quantity.";
  if (message.startsWith("SESSION_CLOSED")) {
    return "This table session has ended. Please scan the QR code at your table to start a new session.";
  }
  return "Something went wrong placing your order. Please try again.";
}

export interface OrderStatusEntry {
  previousStatus: OrderStatus | null;
  newStatus: OrderStatus;
  createdAt: string;
}

export interface OrderTrackingView {
  orderNumber: string;
  status: OrderStatus;
  tableLabel: string;
  subtotalCents: number;
  taxCents: number;
  serviceChargeCents: number;
  totalCents: number;
  currency: string;
  customerNote: string | null;
  createdAt: string;
  items: {
    name: string;
    unitPriceCents: number;
    quantity: number;
    lineNote: string | null;
    options: { group: string; choice: string; priceDeltaCents: number }[];
  }[];
  statusHistory: OrderStatusEntry[];
}

/** §13/§16: the access_token IS the authorization — no login, no ownership check beyond "do you have this token." */
export async function getOrderByToken(accessToken: string): Promise<ActionResult<OrderTrackingView>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_order_by_token", { p_access_token: accessToken });

  if (error || !data) {
    return toActionResult(new AppError("NOT_FOUND", error?.message ?? "order not found", "We couldn't find that order."));
  }

  const row = data as {
    order_number: string;
    status: OrderStatus;
    table_label: string;
    subtotal_cents: number;
    tax_cents: number;
    service_charge_cents: number;
    total_cents: number;
    currency: string;
    customer_note: string | null;
    created_at: string;
    items: {
      name: string;
      unit_price_cents: number;
      quantity: number;
      line_note: string | null;
      options: { group: string; choice: string; price_delta_cents: number }[];
    }[];
    status_history: { previous_status: OrderStatus | null; new_status: OrderStatus; created_at: string }[];
  };

  return {
    ok: true,
    data: {
      orderNumber: row.order_number,
      status: row.status,
      tableLabel: row.table_label,
      subtotalCents: row.subtotal_cents,
      taxCents: row.tax_cents,
      serviceChargeCents: row.service_charge_cents,
      totalCents: row.total_cents,
      currency: row.currency,
      customerNote: row.customer_note,
      createdAt: row.created_at,
      items: row.items.map((item) => ({
        name: item.name,
        unitPriceCents: item.unit_price_cents,
        quantity: item.quantity,
        lineNote: item.line_note,
        options: item.options.map((o) => ({ group: o.group, choice: o.choice, priceDeltaCents: o.price_delta_cents })),
      })),
      statusHistory: row.status_history.map((h) => ({
        previousStatus: h.previous_status,
        newStatus: h.new_status,
        createdAt: h.created_at,
      })),
    },
  };
}

/**
 * Staff-only. requireActiveMembership() re-derives role/restaurant from
 * restaurant_staff — never trusts anything the client sent — and
 * canTransition()/can() give a fast, friendly rejection before the RPC
 * even runs. The RPC (set_order_status, with its own FOR UPDATE lock and
 * role check via auth.uid()) remains the actual guarantee regardless.
 */
export async function setOrderStatus(input: {
  orderId: string;
  status: string;
  note?: string;
}): Promise<ActionResult<{ orderId: string; status: OrderStatus }>> {
  const membership = await requireActiveMembership();

  const parsed = setOrderStatusInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "That status isn't valid."));
  }

  if (!can(membership.role, "orders:status:write")) {
    return toActionResult(new AppError("FORBIDDEN", "role lacks orders:status:write", "You don't have permission to do that."));
  }

  const supabase = await createSupabaseServerClient();

  // §Bug #2 fix: scoped to membership.restaurantId — the trusted,
  // server-derived active restaurant — not just any restaurant the
  // caller happens to be staff at. This is also what stops the RPC call
  // below from ever running for a cross-tenant order: set_order_status
  // is SECURITY DEFINER and re-derives the caller's ROLE from the
  // order's true restaurant_id (staff_role_for), not from what's
  // "selected" — so a dual-membership staffer with a genuine (if
  // different) role at the order's real restaurant could previously
  // reach and pass that RPC's own check even while a DIFFERENT
  // restaurant was active here. The fix is not to trust a client- or
  // RPC-supplied restaurant id, but to never call the RPC at all unless
  // this pre-check already proves the order belongs to the active
  // restaurant.
  const { data: current, error: currentError } = await supabase
    .from("orders")
    .select("status")
    .eq("id", parsed.data.orderId)
    .eq("restaurant_id", membership.restaurantId)
    .maybeSingle();

  if (currentError) {
    return toActionResult(new AppError("INTERNAL", currentError.message, "Couldn't update this order. Please try again."));
  }

  if (!current) {
    return toActionResult(new AppError("NOT_FOUND", "order not found in active restaurant", "Order not found."));
  }

  if (!canTransition(current.status as OrderStatus, parsed.data.status, membership.role)) {
    return toActionResult(
      new AppError("CONFLICT", `illegal transition ${current.status} -> ${parsed.data.status}`, "This order already moved on — refresh to see its current status."),
    );
  }

  const { data, error } = await supabase.rpc("set_order_status", {
    p_order_id: parsed.data.orderId,
    p_new_status: parsed.data.status,
    p_note: parsed.data.note ?? null,
  });

  if (error) {
    if (error.message.includes("ILLEGAL_TRANSITION")) {
      return toActionResult(new AppError("CONFLICT", error.message, "This order already moved on — refresh to see its current status."));
    }
    if (error.message.includes("FORBIDDEN")) {
      return toActionResult(new AppError("FORBIDDEN", error.message, "You don't have permission to do that."));
    }
    return toActionResult(new AppError("INTERNAL", error.message, "Couldn't update this order. Please try again."));
  }

  const row = data as { order_id: string; status: OrderStatus };
  return { ok: true, data: { orderId: row.order_id, status: row.status } };
}

export interface OrderCardView {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  tableLabel: string;
  createdAt: string;
  customerNote: string | null;
  items: { name: string; quantity: number; lineNote: string | null }[];
  totalCents: number;
}

/**
 * Kanban feed (§17). §Bug #2 fix: explicitly scoped to
 * membership.restaurantId. RLS (is_staff_of) only proves the caller is
 * staff at *a* restaurant they belong to — for a dual-membership staffer
 * it legitimately returns rows from EVERY restaurant they're staff at,
 * not just the one currently selected, which is exactly what let one
 * restaurant's active-order board silently include another restaurant's
 * orders. The active-order board must contain only the selected
 * restaurant's orders.
 */
export async function listActiveOrders(): Promise<ActionResult<OrderCardView[]>> {
  const membership = await requireActiveMembership();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, order_number, status, created_at, customer_note, total_cents,
       tables ( label ),
       order_items ( name_snapshot, quantity, line_note )`,
    )
    .eq("restaurant_id", membership.restaurantId)
    .in("status", ["new", "preparing", "ready"])
    .order("created_at", { ascending: true });

  if (error) {
    return toActionResult(new AppError("INTERNAL", error.message, "Couldn't load orders right now."));
  }

  type Row = {
    id: string;
    order_number: string;
    status: OrderStatus;
    created_at: string;
    customer_note: string | null;
    total_cents: number;
    tables: { label: string } | { label: string }[] | null;
    order_items: { name_snapshot: string; quantity: number; line_note: string | null }[];
  };

  const cards: OrderCardView[] = ((data as Row[] | null) ?? []).map((row) => {
    const table = Array.isArray(row.tables) ? row.tables[0] : row.tables;
    return {
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      tableLabel: table?.label ?? "—",
      createdAt: row.created_at,
      customerNote: row.customer_note,
      totalCents: row.total_cents,
      items: row.order_items.map((item) => ({
        name: item.name_snapshot,
        quantity: item.quantity,
        lineNote: item.line_note,
      })),
    };
  });

  return { ok: true, data: cards };
}

export interface OrderDetailView extends OrderCardView {
  subtotalCents: number;
  taxCents: number;
  serviceChargeCents: number;
  currency: string;
  optionsByItemIndex: { group: string; choice: string; priceDeltaCents: number }[][];
  statusHistory: OrderStatusEntry[];
}

export async function getOrderDetail(orderId: string): Promise<ActionResult<OrderDetailView>> {
  const membership = await requireActiveMembership();
  const supabase = await createSupabaseServerClient();

  // §Bug #2 fix: scoped to the caller's currently-ACTIVE restaurant, not
  // just any restaurant RLS would let them see. is_staff_of(restaurant_id)
  // answers "is this staff at *a* restaurant they belong to," not "is
  // this their *selected* one" — a dual-membership staffer could
  // otherwise read another restaurant's order while a different
  // restaurant is active. membership.restaurantId comes from
  // requireActiveMembership(), never from the client.
  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, order_number, status, created_at, customer_note, total_cents, subtotal_cents, tax_cents, service_charge_cents,
       tables ( label ),
       restaurants ( currency ),
       order_items ( name_snapshot, quantity, line_note, order_item_options ( group_name_snapshot, choice_name_snapshot, price_delta_cents_snapshot ) ),
       order_status_history ( previous_status, new_status, created_at )`,
    )
    .eq("id", orderId)
    .eq("restaurant_id", membership.restaurantId)
    .single();

  if (error || !data) {
    return toActionResult(new AppError("NOT_FOUND", error?.message ?? "order not found", "Order not found."));
  }

  type Row = {
    id: string;
    order_number: string;
    status: OrderStatus;
    created_at: string;
    customer_note: string | null;
    total_cents: number;
    subtotal_cents: number;
    tax_cents: number;
    service_charge_cents: number;
    tables: { label: string } | { label: string }[] | null;
    restaurants: { currency: string } | { currency: string }[] | null;
    order_items: {
      name_snapshot: string;
      quantity: number;
      line_note: string | null;
      order_item_options: { group_name_snapshot: string; choice_name_snapshot: string; price_delta_cents_snapshot: number }[];
    }[];
    order_status_history: { previous_status: OrderStatus | null; new_status: OrderStatus; created_at: string }[];
  };

  const row = data as Row;
  const table = Array.isArray(row.tables) ? row.tables[0] : row.tables;
  const restaurant = Array.isArray(row.restaurants) ? row.restaurants[0] : row.restaurants;

  return {
    ok: true,
    data: {
      id: row.id,
      orderNumber: row.order_number,
      status: row.status,
      tableLabel: table?.label ?? "—",
      createdAt: row.created_at,
      customerNote: row.customer_note,
      totalCents: row.total_cents,
      subtotalCents: row.subtotal_cents,
      taxCents: row.tax_cents,
      serviceChargeCents: row.service_charge_cents,
      currency: restaurant?.currency ?? "USD",
      items: row.order_items.map((item) => ({ name: item.name_snapshot, quantity: item.quantity, lineNote: item.line_note })),
      optionsByItemIndex: row.order_items.map((item) =>
        item.order_item_options.map((o) => ({
          group: o.group_name_snapshot,
          choice: o.choice_name_snapshot,
          priceDeltaCents: o.price_delta_cents_snapshot,
        })),
      ),
      statusHistory: row.order_status_history
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((h) => ({ previousStatus: h.previous_status, newStatus: h.new_status, createdAt: h.created_at })),
    },
  };
}

export async function clearTable(tableId: string): Promise<ActionResult<null>> {
  const membership = await requireActiveMembership();

  if (!can(membership.role, "orders:status:write")) {
    return toActionResult(new AppError("FORBIDDEN", "role lacks table-clear permission", "You don't have permission to do that."));
  }

  const supabase = await createSupabaseServerClient();

  // §Bug #2-shaped fix, found during the post-fix security audit (same
  // pattern, a different entity): clear_table is SECURITY DEFINER and
  // re-derives role from the TABLE's true restaurant_id, exactly like
  // set_order_status did for orders — so without this pre-check, a
  // dual-membership staffer could clear a different restaurant's table
  // while a different one is active. Mirrors tablesAdmin.ts's
  // tableBelongsToRestaurant guard, which already does this correctly
  // before generate_table_qr_token.
  const { data: tableRow, error: tableError } = await supabase
    .from("tables")
    .select("id")
    .eq("id", tableId)
    .eq("restaurant_id", membership.restaurantId)
    .maybeSingle();

  if (tableError) {
    return toActionResult(new AppError("INTERNAL", tableError.message, "Couldn't clear this table. Please try again."));
  }

  if (!tableRow) {
    return toActionResult(new AppError("NOT_FOUND", "table not found in active restaurant", "Table not found."));
  }

  const { data, error } = await supabase.rpc("clear_table", { p_table_id: tableId });

  if (error) {
    return toActionResult(new AppError("INTERNAL", error.message, "Couldn't clear this table. Please try again."));
  }

  // clear_table returns session_id: null when there was no open session to
  // close (e.g. it auto-closed a moment earlier) — nothing to audit then.
  const sessionId = (data as { session_id: string | null } | null)?.session_id ?? null;
  if (sessionId) {
    await logAuditEvent(supabase, {
      restaurantId: membership.restaurantId,
      action: "table.session.close",
      entityType: "table_sessions",
      entityId: sessionId,
      newValue: { tableId, status: "closed" },
    });
  }

  return { ok: true, data: null };
}

const HISTORY_PAGE_SIZE = 20;
/**
 * Search resolves candidates from two independently-capped queries (below)
 * before merging/paginating in memory — bounded, never an unbounded scan,
 * per the feature's pagination/performance requirement.
 */
const HISTORY_SEARCH_CANDIDATE_CAP = 500;

const HISTORY_ROW_SELECT = "id, order_number, status, created_at, total_cents, tables ( label )";

export interface OrderHistoryRow {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  tableLabel: string;
  createdAt: string;
  totalCents: number;
}

export interface OrderHistoryTableOption {
  id: string;
  label: string;
}

/** The raw shape a page's `searchParams` naturally comes in as — parsed/defaulted by orderHistoryFiltersSchema below. */
export interface OrderHistoryQueryInput {
  status?: string;
  range?: string;
  tableId?: string;
  search?: string;
  page?: string | number;
}

export interface OrderHistoryResult {
  orders: OrderHistoryRow[];
  currency: string;
  tableOptions: OrderHistoryTableOption[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

type HistoryRowSelect = {
  id: string;
  order_number: string;
  status: OrderStatus;
  created_at: string;
  total_cents: number;
  tables: { label: string } | { label: string }[] | null;
};

function toHistoryRow(row: HistoryRowSelect): OrderHistoryRow {
  const table = Array.isArray(row.tables) ? row.tables[0] : row.tables;
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    tableLabel: table?.label ?? "—",
    createdAt: row.created_at,
    totalCents: row.total_cents,
  };
}

interface HistoryBaseFilters {
  restaurantId: string;
  statuses: readonly OrderStatus[];
  tableId?: string;
  dateFrom: string | null;
  dateTo: string | null;
}

/**
 * Staff order history: completed/cancelled orders only — the live kanban
 * (listActiveOrders) owns new/preparing/ready. RLS (orders_select_staff)
 * already scopes every query below to the caller's own restaurant; the
 * explicit .eq("restaurant_id", ...) filters are defense in depth, matching
 * the convention already used in dashboard.ts/tables.ts.
 *
 * Search (order number / table label) deliberately avoids building a raw
 * `.or()` filter string from user input: PostgREST's composite-filter
 * syntax treats commas/parens/periods as structural, so interpolating a
 * search term into one is an injection risk — a crafted term could smuggle
 * in an extra clause (e.g. reaching past the completed/cancelled
 * restriction). Instead, matching table ids are resolved first, then two
 * separately-parameterized, capped queries (order_number ILIKE, table_id
 * IN) are merged and paginated server-side.
 */
export async function listOrderHistory(rawFilters: OrderHistoryQueryInput): Promise<ActionResult<OrderHistoryResult>> {
  const membership = await requireActiveMembership();

  if (!can(membership.role, "history:read")) {
    return toActionResult(
      new AppError("FORBIDDEN", "role lacks history:read", "You don't have permission to view order history."),
    );
  }

  const parsed = orderHistoryFiltersSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Those filters don't look right."));
  }
  const filters = parsed.data;
  const supabase = await createSupabaseServerClient();

  // "Today"/"last N days" depend on the restaurant's own timezone, not the
  // server process's — same fix as the dashboard's "revenue today" (§17).
  const { data: restaurantRow } = await supabase
    .from("restaurants")
    .select("currency, timezone")
    .eq("id", membership.restaurantId)
    .single();
  const restaurant = restaurantRow as { currency: string; timezone: string } | null;
  const currency = restaurant?.currency ?? "USD";
  const timezone = restaurant?.timezone ?? "UTC";

  const { data: tableRows } = await supabase
    .from("tables")
    .select("id, label")
    .eq("restaurant_id", membership.restaurantId)
    .order("label", { ascending: true });
  const tableOptions = ((tableRows as { id: string; label: string }[] | null) ?? []).map((t) => ({ id: t.id, label: t.label }));

  const statuses = filters.status ? [filters.status] : TERMINAL_STATUSES;

  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  if (filters.range !== "all") {
    const now = new Date();
    const windowDays = filters.range === "today" ? 0 : filters.range === "last7" ? 6 : 29;
    const from = windowDays === 0 ? now : new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    dateFrom = startOfDayInTimeZone(timezone, from).toISOString();
    dateTo = startOfNextDayInTimeZone(timezone, now).toISOString();
  }

  // Applied (inline, below) identically to the list query, the count query,
  // and both search candidate queries — every path AND-s the same filters.
  const baseFilters: HistoryBaseFilters = {
    restaurantId: membership.restaurantId,
    statuses,
    tableId: filters.tableId,
    dateFrom,
    dateTo,
  };

  const search = filters.search;

  if (!search) {
    const from = (filters.page - 1) * HISTORY_PAGE_SIZE;
    const to = from + HISTORY_PAGE_SIZE - 1;
    let listQuery = supabase
      .from("orders")
      .select(HISTORY_ROW_SELECT)
      .eq("restaurant_id", baseFilters.restaurantId)
      .in("status", baseFilters.statuses);
    if (baseFilters.tableId) listQuery = listQuery.eq("table_id", baseFilters.tableId);
    if (baseFilters.dateFrom) listQuery = listQuery.gte("created_at", baseFilters.dateFrom);
    if (baseFilters.dateTo) listQuery = listQuery.lt("created_at", baseFilters.dateTo);
    const { data, error } = await listQuery.order("created_at", { ascending: false }).range(from, to).returns<HistoryRowSelect[]>();

    if (error) {
      return toActionResult(new AppError("INTERNAL", error.message, "Couldn't load order history right now."));
    }

    let countQuery = supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", baseFilters.restaurantId)
      .in("status", baseFilters.statuses);
    if (baseFilters.tableId) countQuery = countQuery.eq("table_id", baseFilters.tableId);
    if (baseFilters.dateFrom) countQuery = countQuery.gte("created_at", baseFilters.dateFrom);
    if (baseFilters.dateTo) countQuery = countQuery.lt("created_at", baseFilters.dateTo);
    const { count: totalCount, error: countError } = await countQuery;
    if (countError) {
      return toActionResult(new AppError("INTERNAL", countError.message, "Couldn't load order history right now."));
    }

    return {
      ok: true,
      data: {
        orders: (data ?? []).map(toHistoryRow),
        currency,
        tableOptions,
        page: filters.page,
        pageSize: HISTORY_PAGE_SIZE,
        totalCount: totalCount ?? 0,
        totalPages: Math.max(1, Math.ceil((totalCount ?? 0) / HISTORY_PAGE_SIZE)),
      },
    };
  }

  // Search path: resolve candidate order ids from two bounded, safely
  // parameterized queries, merge/dedupe/sort, then paginate in memory.
  const { data: matchingTables } = await supabase
    .from("tables")
    .select("id")
    .eq("restaurant_id", membership.restaurantId)
    .ilike("label", `%${search}%`);
  const matchingTableIds = ((matchingTables as { id: string }[] | null) ?? []).map((t) => t.id);

  function candidateBaseQuery() {
    let q = supabase
      .from("orders")
      .select("id, created_at")
      .eq("restaurant_id", baseFilters.restaurantId)
      .in("status", baseFilters.statuses);
    if (baseFilters.tableId) q = q.eq("table_id", baseFilters.tableId);
    if (baseFilters.dateFrom) q = q.gte("created_at", baseFilters.dateFrom);
    if (baseFilters.dateTo) q = q.lt("created_at", baseFilters.dateTo);
    return q;
  }

  const candidateQueries = [
    candidateBaseQuery()
      .ilike("order_number", `%${search}%`)
      .order("created_at", { ascending: false })
      .limit(HISTORY_SEARCH_CANDIDATE_CAP)
      .returns<{ id: string; created_at: string }[]>(),
  ];
  if (matchingTableIds.length > 0) {
    candidateQueries.push(
      candidateBaseQuery()
        .in("table_id", matchingTableIds)
        .order("created_at", { ascending: false })
        .limit(HISTORY_SEARCH_CANDIDATE_CAP)
        .returns<{ id: string; created_at: string }[]>(),
    );
  }

  const candidateResults = await Promise.all(candidateQueries);
  const firstError = candidateResults.find((r) => r.error)?.error;
  if (firstError) {
    return toActionResult(new AppError("INTERNAL", firstError.message, "Couldn't search order history right now."));
  }

  const merged = new Map<string, string>(); // id -> created_at
  for (const result of candidateResults) {
    for (const row of result.data ?? []) merged.set(row.id, row.created_at);
  }
  const sortedIds = [...merged.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id);

  const totalCount = sortedIds.length;
  const from = (filters.page - 1) * HISTORY_PAGE_SIZE;
  const pageIds = sortedIds.slice(from, from + HISTORY_PAGE_SIZE);

  let orders: OrderHistoryRow[] = [];
  if (pageIds.length > 0) {
    const { data, error } = await supabase
      .from("orders")
      .select(HISTORY_ROW_SELECT)
      .eq("restaurant_id", baseFilters.restaurantId)
      .in("id", pageIds)
      .returns<HistoryRowSelect[]>();
    if (error) {
      return toActionResult(new AppError("INTERNAL", error.message, "Couldn't search order history right now."));
    }
    const rowById = new Map((data ?? []).map((row) => [row.id, toHistoryRow(row)]));
    orders = pageIds.map((id) => rowById.get(id)).filter((row): row is OrderHistoryRow => row !== undefined);
  }

  return {
    ok: true,
    data: {
      orders,
      currency,
      tableOptions,
      page: filters.page,
      pageSize: HISTORY_PAGE_SIZE,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / HISTORY_PAGE_SIZE)),
    },
  };
}
