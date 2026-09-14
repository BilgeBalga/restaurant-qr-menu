"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdminMembership } from "@/lib/auth/session";
import { startOfDayInTimeZone, startOfNextDayInTimeZone } from "@/lib/business/timezone";
import { AppError, toActionResult, type ActionResult } from "@/lib/errors";
import { auditLogFiltersSchema, type AuditLogFiltersInput } from "@/lib/validation/audit";

const AUDIT_LOG_PAGE_SIZE = 25;

const AUDIT_LOG_ROW_SELECT =
  "id, created_at, action, entity_type, entity_id, previous_value, new_value, staff_users ( email, full_name )";

export interface AuditLogRow {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string;
  /** null when the acting staff_users row is gone (actor_staff_id ON DELETE SET NULL) — never happens for a merely deactivated membership, only an actually-deleted staff_users row. */
  actorEmail: string | null;
  actorFullName: string | null;
  previousValue: unknown;
  newValue: unknown;
}

export interface AuditLogActorOption {
  id: string;
  email: string;
  fullName: string;
}

export interface AuditLogResult {
  logs: AuditLogRow[];
  /** Every staff member ever on this restaurant's roster (active or not) — same visibility as StaffManager, so a deactivated staffer's past actions stay filterable/attributable. */
  actorOptions: AuditLogActorOption[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

type AuditLogSelectRow = {
  id: string;
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string;
  previous_value: unknown;
  new_value: unknown;
  staff_users: { email: string; full_name: string } | { email: string; full_name: string }[] | null;
};

function toAuditLogRow(row: AuditLogSelectRow): AuditLogRow {
  const actor = Array.isArray(row.staff_users) ? row.staff_users[0] : row.staff_users;
  return {
    id: row.id,
    createdAt: row.created_at,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorEmail: actor?.email ?? null,
    actorFullName: actor?.full_name ?? null,
    previousValue: row.previous_value,
    newValue: row.new_value,
  };
}

type StaffRosterRow = {
  staff_user_id: string;
  staff_users: { email: string; full_name: string } | { email: string; full_name: string }[] | null;
};

/**
 * Admin-only audit trail for the caller's own restaurant (§29/§11
 * audit:read). requireAdminMembership() re-derives both restaurant_id and
 * role from restaurant_staff server-side — the client never supplies
 * either — and audit_logs_select_admin (RLS, db/migrations/0002_rls_policies.sql)
 * independently enforces the exact same admin-only, own-restaurant
 * boundary regardless, so a bug here couldn't leak another restaurant's
 * or a non-admin's data. The explicit .eq("restaurant_id", ...) below is
 * defense in depth, matching the convention already used in
 * listOrderHistory/listTableBoard, not the only thing standing between a
 * caller and someone else's rows.
 *
 * Read-only: this never touches how audit events are recorded
 * (lib/audit.ts / log_audit_event are unchanged).
 */
export async function listAuditLog(rawFilters: AuditLogFiltersInput): Promise<ActionResult<AuditLogResult>> {
  const membership = await requireAdminMembership();

  const parsed = auditLogFiltersSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Those filters don't look right."));
  }
  const filters = parsed.data;
  const supabase = await createSupabaseServerClient();

  // "Today"/"last N days" depend on the restaurant's own timezone, not the
  // server process's — same fix as order history/the dashboard (§17).
  const { data: restaurantRow } = await supabase
    .from("restaurants")
    .select("timezone")
    .eq("id", membership.restaurantId)
    .single();
  const timezone = (restaurantRow as { timezone: string } | null)?.timezone ?? "UTC";

  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  if (filters.range !== "all") {
    const now = new Date();
    const windowDays = filters.range === "today" ? 0 : filters.range === "last7" ? 6 : 29;
    const from = windowDays === 0 ? now : new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    dateFrom = startOfDayInTimeZone(timezone, from).toISOString();
    dateTo = startOfNextDayInTimeZone(timezone, now).toISOString();
  }

  const { data: rosterRows } = await supabase
    .from("restaurant_staff")
    .select("staff_user_id, staff_users ( email, full_name )")
    .eq("restaurant_id", membership.restaurantId);
  const actorOptions: AuditLogActorOption[] = ((rosterRows as StaffRosterRow[] | null) ?? [])
    .map((row) => {
      const staffUser = Array.isArray(row.staff_users) ? row.staff_users[0] : row.staff_users;
      return staffUser ? { id: row.staff_user_id, email: staffUser.email, fullName: staffUser.full_name } : null;
    })
    .filter((option): option is AuditLogActorOption => option !== null)
    .sort((a, b) => a.email.localeCompare(b.email));

  // Applied identically to the list query and the count query below — same
  // duplicated-but-simply-typed convention as listOrderHistory, rather than
  // a generic helper fighting the query builder's own chained return types.
  const from = (filters.page - 1) * AUDIT_LOG_PAGE_SIZE;
  const to = from + AUDIT_LOG_PAGE_SIZE - 1;

  let listQuery = supabase.from("audit_logs").select(AUDIT_LOG_ROW_SELECT).eq("restaurant_id", membership.restaurantId);
  if (filters.action) listQuery = listQuery.ilike("action", `%${filters.action}%`);
  if (filters.entityType) listQuery = listQuery.ilike("entity_type", `%${filters.entityType}%`);
  if (filters.actorStaffId) listQuery = listQuery.eq("actor_staff_id", filters.actorStaffId);
  if (dateFrom) listQuery = listQuery.gte("created_at", dateFrom);
  if (dateTo) listQuery = listQuery.lt("created_at", dateTo);

  const { data, error } = await listQuery.order("created_at", { ascending: false }).range(from, to).returns<AuditLogSelectRow[]>();
  if (error) {
    return toActionResult(new AppError("INTERNAL", error.message, "Couldn't load the audit log right now."));
  }

  let countQuery = supabase.from("audit_logs").select("id", { count: "exact", head: true }).eq("restaurant_id", membership.restaurantId);
  if (filters.action) countQuery = countQuery.ilike("action", `%${filters.action}%`);
  if (filters.entityType) countQuery = countQuery.ilike("entity_type", `%${filters.entityType}%`);
  if (filters.actorStaffId) countQuery = countQuery.eq("actor_staff_id", filters.actorStaffId);
  if (dateFrom) countQuery = countQuery.gte("created_at", dateFrom);
  if (dateTo) countQuery = countQuery.lt("created_at", dateTo);

  const { count: totalCount, error: countError } = await countQuery;
  if (countError) {
    return toActionResult(new AppError("INTERNAL", countError.message, "Couldn't load the audit log right now."));
  }

  return {
    ok: true,
    data: {
      logs: (data ?? []).map(toAuditLogRow),
      actorOptions,
      page: filters.page,
      pageSize: AUDIT_LOG_PAGE_SIZE,
      totalCount: totalCount ?? 0,
      totalPages: Math.max(1, Math.ceil((totalCount ?? 0) / AUDIT_LOG_PAGE_SIZE)),
    },
  };
}
