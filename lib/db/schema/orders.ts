import { sql } from "drizzle-orm";
import { check, date, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { restaurants, staffUsers, tableSessions, tables } from "./core";
import { orderStatusEnum } from "./enums";
import { menuItems } from "./menu";

/**
 * Orders and their children. Nothing here is ever written directly by
 * `authenticated` or `anon` (Finding 6, db/migrations/0002_rls_policies.sql
 * revokes all table-level DML and grants SELECT only) — the create_order
 * and set_order_status SECURITY DEFINER functions
 * (db/migrations/0001_functions.sql) are the only writers.
 */

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "restrict" }),
    tableSessionId: uuid("table_session_id")
      .notNull()
      .references(() => tableSessions.id, { onDelete: "restrict" }),
    orderNumber: text("order_number").notNull(),
    /**
     * The restaurant-LOCAL calendar date next_order_number() minted
     * orderNumber for (db/migrations/0008_order_number_daily_scope.sql)
     * — order numbering resets daily by design, so order_number text
     * alone can repeat across different days; this is what actually
     * disambiguates them at the database level. Computed once in
     * create_order via restaurants.timezone, never re-derived from
     * created_at (which is UTC and says nothing about the restaurant's
     * own calendar).
     */
    orderDate: date("order_date", { mode: "string" }).notNull(),
    status: orderStatusEnum("status").notNull().default("new"),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull().default(0),
    serviceChargeCents: integer("service_charge_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    customerNote: text("customer_note"),
    /** Capability token for anonymous order tracking (§13) — not a login. */
    accessToken: text("access_token").notNull().unique(),
    /** Finding 4: lets create_order resolve a retry/double-tap to the original row instead of inserting twice. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("orders_restaurant_order_date_order_number_unique").on(
      table.restaurantId,
      table.orderDate,
      table.orderNumber,
    ),
    check("orders_subtotal_non_negative", sql`${table.subtotalCents} >= 0`),
    check("orders_tax_non_negative", sql`${table.taxCents} >= 0`),
    check("orders_service_charge_non_negative", sql`${table.serviceChargeCents} >= 0`),
    check("orders_total_non_negative", sql`${table.totalCents} >= 0`),
    // The invariant that actually protects against a pricing bug anywhere upstream:
    check(
      "orders_total_equals_components",
      sql`${table.totalCents} = ${table.subtotalCents} + ${table.taxCents} + ${table.serviceChargeCents}`,
    ),
  ],
);

/** name/price are SNAPSHOTS at order time — never re-read from menu_items (§7 "price history" decision). */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /**
     * ON DELETE RESTRICT, not SET NULL — reconciled per the critical
     * review's backstop decision (§7): a menu_item that has ever been
     * ordered can never be hard-deleted, only disabled. §19's "delete only
     * if never ordered" business rule is enforced here at the DB level,
     * not just by UI convention.
     */
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "restrict" }),
    nameSnapshot: text("name_snapshot").notNull(),
    unitPriceCentsSnapshot: integer("unit_price_cents_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    lineNote: text("line_note"),
  },
  (table) => [
    check("order_items_unit_price_non_negative", sql`${table.unitPriceCentsSnapshot} >= 0`),
    check("order_items_quantity_positive", sql`${table.quantity} > 0 AND ${table.quantity} <= 20`),
  ],
);

/** Also snapshotted — no live FK to option_choices/option_groups at all (§7). */
export const orderItemOptions = pgTable("order_item_options", {
  id: uuid("id").primaryKey().defaultRandom(),
  restaurantId: uuid("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "restrict" }),
  orderItemId: uuid("order_item_id")
    .notNull()
    .references(() => orderItems.id, { onDelete: "cascade" }),
  groupNameSnapshot: text("group_name_snapshot").notNull(),
  choiceNameSnapshot: text("choice_name_snapshot").notNull(),
  priceDeltaCentsSnapshot: integer("price_delta_cents_snapshot").notNull().default(0),
});

/** Append-only audit trail for order status (§15) — set_order_status is the only writer. */
export const orderStatusHistory = pgTable("order_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  restaurantId: uuid("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "restrict" }),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  previousStatus: text("previous_status"),
  newStatus: text("new_status").notNull(),
  changedByStaffId: uuid("changed_by_staff_id").references(() => staffUsers.id, { onDelete: "set null" }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Foundation only in Phase 2 (§29): table, RLS, and a reusable insert
 * helper exist and are tested; nothing calls it yet, because none of
 * Phase 2's own RPCs correspond to a §29-listed auditable action (order
 * status changes are deliberately redundant with order_status_history,
 * not double-logged here). Wiring arrives with Phase 9/10's menu/staff/
 * settings management actions.
 */
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * Nullable since SaaS Phase 2 (db/migrations/0011_platform_admin_foundation.sql)
   * — every restaurant-scoped event still always sets this; NULL is
   * reserved for a genuinely platform-level event (e.g. a future
   * "platform.admin.grant"), which has no restaurant to attach to.
   */
  restaurantId: uuid("restaurant_id").references(() => restaurants.id, { onDelete: "restrict" }),
  actorStaffId: uuid("actor_staff_id").references(() => staffUsers.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
