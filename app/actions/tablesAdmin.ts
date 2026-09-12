"use server";

import QRCode from "qrcode";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveMembership } from "@/lib/auth/session";
import { can } from "@/lib/business/permissions";
import { logAuditEvent } from "@/lib/audit";
import { getPublicEnv } from "@/lib/env";
import { AppError, toActionResult, type ActionResult } from "@/lib/errors";
import {
  createTableInputSchema,
  deleteTableInputSchema,
  tableIdInputSchema,
  updateTableInputSchema,
  type CreateTableInput,
  type UpdateTableInput,
} from "@/lib/validation/tables";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface AdminTableView {
  id: string;
  label: string;
  seats: number | null;
  isActive: boolean;
}

/**
 * Includes the rendered SVG — returned only from actions that mean to
 * actually show/print/download a QR right now. The list view
 * (app/actions/tables.ts's TableQrSummary) deliberately has no SVG field
 * — rendering one per row on a whole-restaurant table list would be
 * wasted work for every table the admin isn't currently looking at.
 */
export interface TableQrView {
  qrUrl: string;
  qrSvg: string;
  createdAt: string;
}

function requireTablesWrite(role: Parameters<typeof can>[0]): ReturnType<typeof toActionResult> | null {
  if (!can(role, "tables:write")) {
    return toActionResult(new AppError("FORBIDDEN", "role lacks tables:write", "You don't have permission to manage tables."));
  }
  return null;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

function isForeignKeyViolation(error: { code?: string } | null): boolean {
  return error?.code === "23503";
}

// ============================================================
// Table CRUD
// ============================================================

export async function createTable(input: CreateTableInput): Promise<ActionResult<AdminTableView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireTablesWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = createTableInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Please check the table's details."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tables")
    .insert({ restaurant_id: membership.restaurantId, label: parsed.data.label, seats: parsed.data.seats ?? null })
    .select("id, label, seats, is_active")
    .single();

  if (error || !data) {
    if (isUniqueViolation(error)) {
      return toActionResult(new AppError("CONFLICT", error!.message, "A table with that name already exists."));
    }
    return toActionResult(new AppError("INTERNAL", error?.message ?? "insert failed", "Couldn't create the table. Please try again."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "table.create",
    entityType: "tables",
    entityId: data.id,
    newValue: { label: data.label, seats: data.seats },
  });

  return { ok: true, data: { id: data.id, label: data.label, seats: data.seats, isActive: data.is_active } };
}

export async function updateTable(input: UpdateTableInput): Promise<ActionResult<AdminTableView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireTablesWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = updateTableInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Please check the table's details."));
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) patch.label = parsed.data.label;
  if (parsed.data.seats !== undefined) patch.seats = parsed.data.seats;
  if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;

  if (Object.keys(patch).length === 0) {
    return toActionResult(new AppError("VALIDATION_ERROR", "no fields to update", "Nothing to save."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tables")
    .update(patch)
    .eq("id", parsed.data.id)
    .eq("restaurant_id", membership.restaurantId)
    .select("id, label, seats, is_active")
    .single();

  if (error || !data) {
    if (isUniqueViolation(error)) {
      return toActionResult(new AppError("CONFLICT", error!.message, "A table with that name already exists."));
    }
    return toActionResult(new AppError("NOT_FOUND", error?.message ?? "table not found", "Couldn't find that table."));
  }

  // A pure activate/deactivate toggle gets its own audit action label
  // (§10's explicit "table activated/deactivated" bullet); anything that
  // also touches label/seats is logged as a generic update instead.
  const isActiveOnlyChange = parsed.data.isActive !== undefined && parsed.data.label === undefined && parsed.data.seats === undefined;
  const action = isActiveOnlyChange ? (parsed.data.isActive ? "table.activate" : "table.deactivate") : "table.update";

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action,
    entityType: "tables",
    entityId: data.id,
    newValue: patch,
  });

  return { ok: true, data: { id: data.id, label: data.label, seats: data.seats, isActive: data.is_active } };
}

/**
 * Hard delete only if the table has no history at all — table_sessions.
 * table_id and table_qr_tokens.table_id are BOTH ON DELETE RESTRICT
 * (lib/db/schema/core.ts), so a table that has ever had a QR token
 * issued (even a revoked one — kept deliberately, per §12's own comment,
 * "old tokens stay around for audit") or ever had a dining session (and
 * therefore possibly orders) cannot be hard-deleted at all. In practice
 * that means only a table created and never used can ever be deleted;
 * everything else must be deactivated instead — exactly the same
 * is_active-vs-delete duality already applied to categories/menu items.
 */
export async function deleteTable(input: { id: string }): Promise<ActionResult<null>> {
  const membership = await requireActiveMembership();
  const forbidden = requireTablesWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = deleteTableInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Invalid table."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tables")
    .delete()
    .eq("id", parsed.data.id)
    .eq("restaurant_id", membership.restaurantId)
    .select("id, label")
    .single();

  if (error) {
    if (isForeignKeyViolation(error)) {
      return toActionResult(
        new AppError("CONFLICT", error.message, "This table has QR or order history — deactivate it instead of deleting it."),
      );
    }
    return toActionResult(new AppError("NOT_FOUND", error.message, "Couldn't find that table."));
  }
  if (!data) {
    return toActionResult(new AppError("NOT_FOUND", "table not found", "Couldn't find that table."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "table.delete",
    entityType: "tables",
    entityId: parsed.data.id,
    previousValue: { label: data.label },
  });

  return { ok: true, data: null };
}

// ============================================================
// QR lifecycle
// ============================================================

function buildQrUrl(token: string): string {
  const appUrl = getPublicEnv().NEXT_PUBLIC_APP_URL;
  return new URL(`/t/${token}`, appUrl).toString();
}

async function renderQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 2, width: 320 });
}

async function hasActiveQrToken(supabase: SupabaseServerClient, tableId: string): Promise<boolean> {
  const { data } = await supabase.from("table_qr_tokens").select("id").eq("table_id", tableId).eq("is_active", true).limit(1);
  return Boolean(data && data.length > 0);
}

/** Never trusts a client-supplied tableId belongs to the caller's restaurant — checked before the RPC runs, which independently re-derives the same guarantee via staff_role_for(). */
async function tableBelongsToRestaurant(supabase: SupabaseServerClient, tableId: string, restaurantId: string): Promise<boolean> {
  const { data } = await supabase.from("tables").select("id").eq("id", tableId).eq("restaurant_id", restaurantId).maybeSingle();
  return Boolean(data);
}

/**
 * Current QR status for one table, with the SVG rendered — used when an
 * admin actually opens a table's QR panel (not for the list view, which
 * uses listTableBoard's lighter TableQrSummary instead).
 */
export async function getTableQrForDisplay(input: { tableId: string }): Promise<ActionResult<TableQrView | null>> {
  const membership = await requireActiveMembership();
  const forbidden = requireTablesWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = tableIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Invalid table."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("table_qr_tokens")
    .select("token, created_at")
    .eq("table_id", parsed.data.tableId)
    .eq("restaurant_id", membership.restaurantId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    return toActionResult(new AppError("INTERNAL", error.message, "Couldn't load this table's QR code."));
  }
  if (!data) {
    return { ok: true, data: null };
  }

  const qrUrl = buildQrUrl(data.token);
  const qrSvg = await renderQrSvg(qrUrl);
  return { ok: true, data: { qrUrl, qrSvg, createdAt: data.created_at } };
}

/**
 * Generates a fresh QR for a table with no active token, or rotates it
 * if one already exists — both are the same DB operation
 * (generate_table_qr_token, db/migrations/0006_table_qr_token_generation.sql),
 * differing only in the audit label. That RPC is what actually revokes
 * the old token and mints a new one atomically; this action's own job is
 * authorization, the friendly error mapping, and rendering the SVG for
 * the token the RPC just created.
 */
export async function generateTableQrToken(input: { tableId: string }): Promise<ActionResult<TableQrView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireTablesWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = tableIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Invalid table."));
  }

  const supabase = await createSupabaseServerClient();
  const belongs = await tableBelongsToRestaurant(supabase, parsed.data.tableId, membership.restaurantId);
  if (!belongs) {
    return toActionResult(new AppError("NOT_FOUND", "table not found for restaurant", "Couldn't find that table."));
  }

  const wasRotate = await hasActiveQrToken(supabase, parsed.data.tableId);

  const { data, error } = await supabase.rpc("generate_table_qr_token", { p_table_id: parsed.data.tableId });
  if (error || !data) {
    if (error?.message?.includes("FORBIDDEN")) {
      return toActionResult(new AppError("FORBIDDEN", error.message, "You don't have permission to manage this table's QR code."));
    }
    return toActionResult(new AppError("INTERNAL", error?.message ?? "rpc failed", "Couldn't generate a QR code. Please try again."));
  }

  const row = data as { id: string; token: string; created_at: string };
  const qrUrl = buildQrUrl(row.token);
  const qrSvg = await renderQrSvg(qrUrl);

  // Never log the raw token — the audit trail records which table's QR
  // changed and when, not the bearer credential itself.
  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: wasRotate ? "table.qr.rotate" : "table.qr.generate",
    entityType: "table_qr_tokens",
    entityId: row.id,
    newValue: { tableId: parsed.data.tableId },
  });

  return { ok: true, data: { qrUrl, qrSvg, createdAt: row.created_at } };
}

/**
 * Revokes every currently-active token for a table (normally at most
 * one, but nothing at the DB level actually enforces that, so this
 * clears all of them rather than assuming exactly one) — an UPDATE, not
 * a DELETE, so the row stays for audit per §12's design.
 */
export async function revokeTableQrToken(input: { tableId: string }): Promise<ActionResult<null>> {
  const membership = await requireActiveMembership();
  const forbidden = requireTablesWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = tableIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Invalid table."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("table_qr_tokens")
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq("table_id", parsed.data.tableId)
    .eq("restaurant_id", membership.restaurantId)
    .eq("is_active", true)
    .select("id");

  if (error) {
    return toActionResult(new AppError("INTERNAL", error.message, "Couldn't revoke the QR code. Please try again."));
  }
  if (!data || data.length === 0) {
    return toActionResult(new AppError("NOT_FOUND", "no active token", "This table doesn't currently have an active QR code."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "table.qr.revoke",
    entityType: "table_qr_tokens",
    entityId: data[0]!.id,
    previousValue: { tableId: parsed.data.tableId, revokedCount: data.length },
  });

  return { ok: true, data: null };
}
