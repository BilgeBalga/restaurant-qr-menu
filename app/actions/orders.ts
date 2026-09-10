"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, toActionResult, type ActionResult } from "@/lib/errors";
import { requireActiveMembership } from "@/lib/auth/session";
import { createOrderInputSchema, setOrderStatusInputSchema, type CreateOrderInput } from "@/lib/validation/order";
import { canTransition, type OrderStatus } from "@/lib/business/orderStateMachine";
import { can } from "@/lib/business/permissions";

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
  });

  if (error) {
    return toActionResult(new AppError("CONFLICT", error.message, friendlyOrderError(error.message)));
  }

  const row = data as { order_id: string; order_number: string; access_token: string; total_cents: number };
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
  if (message.startsWith("ORDERING_DISABLED")) return "This restaurant isn't taking orders right now.";
  if (message.startsWith("EMPTY_ORDER")) return "Your cart is empty.";
  if (message.startsWith("INVALID_QUANTITY")) return "Please choose a valid quantity.";
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
  const { data: current } = await supabase.from("orders").select("status").eq("id", parsed.data.orderId).single();

  if (current && !canTransition(current.status as OrderStatus, parsed.data.status, membership.role)) {
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

/** Kanban feed (§17) — RLS already scopes this to the caller's own restaurant. */
export async function listActiveOrders(): Promise<ActionResult<OrderCardView[]>> {
  await requireActiveMembership();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, order_number, status, created_at, customer_note, total_cents,
       tables ( label ),
       order_items ( name_snapshot, quantity, line_note )`,
    )
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
  optionsByItemIndex: { group: string; choice: string; priceDeltaCents: number }[][];
  statusHistory: OrderStatusEntry[];
}

export async function getOrderDetail(orderId: string): Promise<ActionResult<OrderDetailView>> {
  await requireActiveMembership();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, order_number, status, created_at, customer_note, total_cents, subtotal_cents, tax_cents, service_charge_cents,
       tables ( label ),
       order_items ( name_snapshot, quantity, line_note, order_item_options ( group_name_snapshot, choice_name_snapshot, price_delta_cents_snapshot ) ),
       order_status_history ( previous_status, new_status, created_at )`,
    )
    .eq("id", orderId)
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
  const { error } = await supabase.rpc("clear_table", { p_table_id: tableId });

  if (error) {
    return toActionResult(new AppError("INTERNAL", error.message, "Couldn't clear this table. Please try again."));
  }

  return { ok: true, data: null };
}
