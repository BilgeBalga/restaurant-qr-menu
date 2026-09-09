import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { staffRoleEnum, tableSessionStatusEnum } from "./enums";

/**
 * Restaurants, staff, tables, QR tokens, and dining sessions (§7 "Core
 * tables", plus the review's six fixes). restaurant_id is denormalized
 * onto every tenant-owned row from here down — Finding 5 — so every RLS
 * policy in db/migrations is a flat equality check, never a join chain.
 */

export const restaurants = pgTable("restaurants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("UTC"),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  isActive: boolean("is_active").notNull().default(true),
  orderingEnabled: boolean("ordering_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 1:1 with restaurants — the FK doubles as the PK (§7). */
export const restaurantSettings = pgTable(
  "restaurant_settings",
  {
    restaurantId: uuid("restaurant_id")
      .primaryKey()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    logoUrl: text("logo_url"),
    accentColor: text("accent_color"),
    openingHours: jsonb("opening_hours"),
    orderNumberPrefix: text("order_number_prefix").notNull().default("A"),
    taxRate: numeric("tax_rate", { precision: 5, scale: 4 }).notNull().default("0"),
    serviceChargeRate: numeric("service_charge_rate", { precision: 5, scale: 4 })
      .notNull()
      .default("0"),
    minOrderCents: integer("min_order_cents"),
  },
  (table) => [
    check("restaurant_settings_tax_rate_bounds", sql`${table.taxRate} >= 0 AND ${table.taxRate} <= 1`),
    check(
      "restaurant_settings_service_charge_rate_bounds",
      sql`${table.serviceChargeRate} >= 0 AND ${table.serviceChargeRate} <= 1`,
    ),
    check(
      "restaurant_settings_min_order_cents_non_negative",
      sql`${table.minOrderCents} IS NULL OR ${table.minOrderCents} >= 0`,
    ),
  ],
);

/**
 * Mirrors auth.users 1:1 (§7). The actual FK to auth.users(id) and the
 * trigger that keeps this table populated automatically are added in
 * db/migrations/0001_functions.sql — Drizzle doesn't manage the `auth`
 * schema, so that cross-schema reference is hand-written SQL, not a
 * `.references()` call here.
 */
export const staffUsers = pgTable("staff_users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Role is scoped HERE, not on staff_users (§7) — one person, many restaurants, different roles. */
export const restaurantStaff = pgTable(
  "restaurant_staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    role: staffRoleEnum("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("restaurant_staff_restaurant_user_unique").on(table.restaurantId, table.staffUserId)],
);

export const tables = pgTable(
  "tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    seats: integer("seats"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tables_restaurant_label_unique").on(table.restaurantId, table.label),
    check("tables_seats_positive", sql`${table.seats} IS NULL OR ${table.seats} > 0`),
  ],
);

/**
 * History-preserving; at most one active token per table (§12). Revoking
 * is an UPDATE (is_active=false, revoked_at set), never a delete — old
 * tokens stay around for audit ("was this order really from this table's
 * current code, or an old leaked one?").
 */
export const tableQrTokens = pgTable("table_qr_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  restaurantId: uuid("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "restrict" }),
  tableId: uuid("table_id")
    .notNull()
    .references(() => tables.id, { onDelete: "restrict" }),
  token: text("token").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/**
 * Groups multiple orders from one dining party (§7/§14 of the brief).
 * Finding 1: the partial unique index enforces "at most one open session
 * per table" at the database level — session acquisition inside
 * create_order relies on this via INSERT ... ON CONFLICT. Finding 2:
 * set_order_status auto-closes a session the instant its last
 * non-terminal order finishes; closedByStaffId staying NULL marks an
 * auto-close, a real staff id marks a manual "clear table".
 */
export const tableSessions = pgTable(
  "table_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id, { onDelete: "restrict" }),
    status: tableSessionStatusEnum("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByStaffId: uuid("closed_by_staff_id").references(() => staffUsers.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("table_sessions_one_open_per_table")
      .on(table.tableId)
      .where(sql`${table.status} = 'open'`),
  ],
);

/**
 * Implementation detail supporting Finding 4 (atomic order numbering), not
 * a domain entity from §7's table list. One row per restaurant per day;
 * next_order_number() (db/migrations/0001_functions.sql) increments it
 * atomically via INSERT ... ON CONFLICT DO UPDATE ... RETURNING.
 */
export const restaurantDailyCounters = pgTable(
  "restaurant_daily_counters",
  {
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    day: date("day", { mode: "string" }).notNull(), // matches current_date in the RPC
    counter: integer("counter").notNull().default(0),
  },
  (table) => [uniqueIndex("restaurant_daily_counters_pk").on(table.restaurantId, table.day)],
);
