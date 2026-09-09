import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Shared across schema files. Values match lib/business/orderStateMachine.ts
 * and lib/business/permissions.ts exactly (§15, §5/§11) — those TS modules
 * and this schema describe the same rules in two places by necessity (one
 * runs in Postgres, one in the app); keep them in sync by hand.
 */
export const staffRoleEnum = pgEnum("staff_role", ["admin", "manager", "staff", "kitchen"]);

export const tableSessionStatusEnum = pgEnum("table_session_status", ["open", "closed"]);

export const orderStatusEnum = pgEnum("order_status", [
  "new",
  "preparing",
  "ready",
  "completed",
  "cancelled",
]);

export const optionSelectionTypeEnum = pgEnum("option_selection_type", ["single", "multiple"]);
