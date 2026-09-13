import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Shared across schema files. Values match lib/business/orderStateMachine.ts
 * and lib/business/permissions.ts exactly (§15, §5/§11) — those TS modules
 * and this schema describe the same rules in two places by necessity (one
 * runs in Postgres, one in the app); keep them in sync by hand.
 */
export const staffRoleEnum = pgEnum("staff_role", ["admin", "manager", "staff", "kitchen"]);

/**
 * Restaurant lifecycle (SaaS Phase 1) — replaces the old plain is_active
 * boolean, which couldn't express "half-provisioned" separately from
 * "platform-suspended" or "owner-archived". "provisioning" must never be
 * reachable through any customer/staff-facing check — a restaurant only
 * becomes visible to anyone once provision_restaurant() flips it to
 * "active" in the same transaction that creates its owner membership.
 */
export const restaurantStatusEnum = pgEnum("restaurant_status", [
  "provisioning",
  "active",
  "suspended",
  "archived",
]);

export const tableSessionStatusEnum = pgEnum("table_session_status", ["open", "closed"]);

export const orderStatusEnum = pgEnum("order_status", [
  "new",
  "preparing",
  "ready",
  "completed",
  "cancelled",
]);

export const optionSelectionTypeEnum = pgEnum("option_selection_type", ["single", "multiple"]);
