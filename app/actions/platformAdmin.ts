"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { findOrCreateStaffAuthUser, type StaffAuthAdminClient } from "@/lib/auth/adminUsers";
import { logAuditEvent } from "@/lib/audit";
import { AppError, toActionResult, type ActionResult } from "@/lib/errors";
import { provisionRestaurantInputSchema, type ProvisionRestaurantInput } from "@/lib/validation/platformAdmin";

export interface ProvisionRestaurantResult {
  restaurantId: string;
  slug: string;
  /** False on a retry that found an already-provisioned restaurant for this slug — not an error, the same idempotent-return shape create_order already uses. */
  created: boolean;
  /** True only when a brand-new Auth account was created for the owner — relayed the same way addStaffMember's temporaryPassword already is. */
  ownerAuthCreated: boolean;
  ownerTemporaryPassword: string | null;
}

/**
 * Platform-admin-only restaurant provisioning (SaaS Phase 3). Two phases,
 * deliberately separate because Supabase Auth and Postgres can't share a
 * transaction (§ architecture proposal Part 4):
 *
 *   Phase A — resolve the owner's Auth/staff_users identity first, via
 *   the exact same findOrCreateStaffAuthUser used by addStaffMember
 *   (app/actions/staffAdmin.ts), unchanged. Already idempotent (looks up
 *   by email before creating) — a retry after this phase succeeded but
 *   phase B failed simply finds the existing account rather than
 *   recreating it, exactly the "don't attempt unsafe rollback of the
 *   Auth user, let the next retry reuse it" requirement.
 *
 *   Phase B — one atomic SECURITY DEFINER RPC (provision_restaurant,
 *   db/migrations/0012_provision_restaurant.sql) creates the restaurant,
 *   its settings, and the owner's admin membership together, or none of
 *   them (see that migration's own atomicity note).
 *
 * requirePlatformAdmin() is the first thing this does, before any other
 * work — mirrors every other admin-write action's ordering. The RPC
 * independently re-checks is_platform_admin() itself regardless (§26:
 * the RPC is the final authority, never just the app layer).
 */
export async function provisionRestaurant(input: ProvisionRestaurantInput): Promise<ActionResult<ProvisionRestaurantResult>> {
  await requirePlatformAdmin();

  const parsed = provisionRestaurantInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Please check the restaurant's details."));
  }

  // Same interop cast staffAdmin.ts already uses — the full generated
  // SupabaseClient type is too deep for TS to structurally check against
  // StaffAuthAdminClient's narrow interface.
  const admin = createSupabaseAdminClient() as unknown as StaffAuthAdminClient;
  const resolvedOwner = await findOrCreateStaffAuthUser(admin, parsed.data.ownerEmail);
  if (!resolvedOwner.ok) {
    return toActionResult(
      new AppError("INTERNAL", resolvedOwner.error, "Couldn't create or find the owner's account. Please try again."),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("provision_restaurant", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_timezone: parsed.data.timezone,
    p_currency: parsed.data.currency,
    p_owner_staff_user_id: resolvedOwner.data.id,
    p_order_number_prefix: parsed.data.orderNumberPrefix ?? null,
  });

  if (error || !data) {
    if (error?.message?.includes("FORBIDDEN")) {
      return toActionResult(new AppError("FORBIDDEN", error.message, "You don't have permission to create restaurants."));
    }
    return toActionResult(new AppError("INTERNAL", error?.message ?? "provisioning failed", "Couldn't create the restaurant. Please try again."));
  }

  const row = data as { restaurant_id: string; slug: string; created: boolean };

  // Only on a genuine creation — a retry that found an existing
  // restaurant for this slug is a no-op, not a new event worth logging,
  // same "only log when something actually changed" convention
  // settings.ts's recordSettingsAudit already uses.
  if (row.created) {
    await logAuditEvent(supabase, {
      restaurantId: row.restaurant_id,
      action: "restaurant.create",
      entityType: "restaurants",
      entityId: row.restaurant_id,
      newValue: { name: parsed.data.name, slug: row.slug, ownerEmail: parsed.data.ownerEmail },
    });
  }

  return {
    ok: true,
    data: {
      restaurantId: row.restaurant_id,
      slug: row.slug,
      created: row.created,
      ownerAuthCreated: resolvedOwner.data.created,
      ownerTemporaryPassword: resolvedOwner.data.temporaryPassword,
    },
  };
}

export type RestaurantStatus = "provisioning" | "active" | "suspended" | "archived";

export interface PlatformRestaurantRow {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  ownerEmail: string | null;
  currency: string;
  timezone: string;
  orderingEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface RawPlatformRestaurantRow {
  id: string;
  name: string;
  slug: string;
  status: RestaurantStatus;
  currency: string;
  timezone: string;
  ordering_enabled: boolean;
  created_at: string;
  updated_at: string;
  staff_users: { email: string } | { email: string }[] | null;
}

const PLATFORM_RESTAURANT_SELECT =
  "id, name, slug, status, currency, timezone, ordering_enabled, created_at, updated_at, staff_users ( email )";

function mapPlatformRestaurantRow(row: RawPlatformRestaurantRow): PlatformRestaurantRow {
  const owner = Array.isArray(row.staff_users) ? row.staff_users[0] : row.staff_users;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    ownerEmail: owner?.email ?? null,
    currency: row.currency,
    timezone: row.timezone,
    orderingEnabled: row.ordering_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The full tenant roster — platform-admin only (requirePlatformAdmin()),
 * backed by restaurants_select_platform_admin
 * (db/migrations/0013_platform_admin_read_access.sql), which is what
 * actually lets this see every restaurant regardless of the caller's own
 * (possibly nonexistent) restaurant_staff rows. staff_users(email)
 * resolves owner_staff_user_id to a displayable identity, embedded via
 * the same plain-FK-embed syntax staffAdmin.ts's MEMBER_SELECT already
 * uses successfully for the identical relationship shape.
 */
export async function listPlatformRestaurants(): Promise<ActionResult<PlatformRestaurantRow[]>> {
  await requirePlatformAdmin();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("restaurants")
    .select(PLATFORM_RESTAURANT_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    return toActionResult(new AppError("INTERNAL", error.message, "Couldn't load restaurants right now."));
  }

  return { ok: true, data: ((data as unknown as RawPlatformRestaurantRow[] | null) ?? []).map(mapPlatformRestaurantRow) };
}

/**
 * One restaurant's platform-admin detail view, resolved by slug (never
 * trusts a client-supplied id) — same platform-admin-only RLS as the
 * list above. Read-only in this phase: no status-changing controls
 * exist yet (Phase 5+).
 */
export async function getPlatformRestaurantBySlug(slug: string): Promise<ActionResult<PlatformRestaurantRow>> {
  await requirePlatformAdmin();

  if (!slug || typeof slug !== "string") {
    return toActionResult(new AppError("VALIDATION_ERROR", "invalid slug", "Invalid restaurant."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("restaurants")
    .select(PLATFORM_RESTAURANT_SELECT)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    return toActionResult(new AppError("INTERNAL", error.message, "Couldn't load this restaurant."));
  }
  if (!data) {
    return toActionResult(new AppError("NOT_FOUND", "restaurant not found", "Couldn't find that restaurant."));
  }

  return { ok: true, data: mapPlatformRestaurantRow(data as unknown as RawPlatformRestaurantRow) };
}
