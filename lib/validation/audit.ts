import { z } from "zod";

/**
 * Shape only, not authority — same convention as lib/validation/tables.ts.
 * requireAdminMembership() (app/actions/audit.ts) and audit_logs_select_admin
 * (db/migrations/0002_rls_policies.sql) are the real guarantees; restaurant_id
 * itself is never a field here at all — it always comes from the caller's
 * own membership, never from client input.
 *
 * `action` and `entityType` are free-text (ILIKE) rather than a fixed enum
 * or a dropdown of distinct existing values: both are plain text columns
 * (db/migrations/0000_init_schema.sql), and their real value set lives only
 * as string literals scattered across app/actions/*.ts (~30 of them), not
 * in a lookup table — hardcoding a second copy of that list here would
 * drift the moment a new one is added. Same ILIKE-via-the-query-builder
 * convention already used safely for order history's search (order_number,
 * table label) — never a hand-built `.or()` filter string, so there's no
 * PostgREST composite-filter injection surface.
 */
export const auditLogFiltersSchema = z.object({
  range: z.enum(["today", "last7", "last30", "all"]).catch("all").default("all"),
  action: z.string().trim().max(100).optional().catch(undefined),
  entityType: z.string().trim().max(100).optional().catch(undefined),
  actorStaffId: z.string().uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});

/** The raw shape a page's `searchParams` naturally comes in as — parsed/defaulted above. */
export interface AuditLogFiltersInput {
  range?: string;
  action?: string;
  entityType?: string;
  actorStaffId?: string;
  page?: string | number;
}

export type AuditLogFilters = z.infer<typeof auditLogFiltersSchema>;
