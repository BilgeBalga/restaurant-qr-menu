"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveMembership } from "@/lib/auth/session";
import { can } from "@/lib/business/permissions";
import { logAuditEvent } from "@/lib/audit";
import { AppError, toActionResult, type ActionResult } from "@/lib/errors";
import { updateRestaurantSettingsInputSchema, type UpdateRestaurantSettingsInput } from "@/lib/validation/settings";

export interface RestaurantSettingsView {
  restaurantId: string;
  name: string;
  currency: string;
  timezone: string;
  orderingEnabled: boolean;
  /** 0-100 — restaurant_settings stores these as 0-1 fractions; the form works in percent. */
  taxRatePercent: number;
  serviceChargeRatePercent: number;
}

/** numeric(5,4) fractions -> percent, rounded to 2 decimal places (the fraction's own precision). */
function toPercent(fraction: number): number {
  return Math.round(fraction * 10000) / 100;
}

/** percent -> the numeric(5,4) fraction restaurant_settings actually stores. */
function toFraction(percent: number): number {
  return Math.round(percent * 100) / 10000;
}

/**
 * restaurant_id is never taken from the caller — requireActiveMembership()
 * re-derives it from restaurant_staff (§19 finding), and RLS
 * (restaurants_select_staff / restaurant_settings_select_staff) scopes
 * both reads to that restaurant regardless. Readable by any active staff
 * member; only admin can write (enforced below in updateRestaurantSettings
 * and, independently, by restaurants_update_admin / restaurant_settings_
 * update_admin at the RLS layer).
 */
export async function getRestaurantSettings(): Promise<ActionResult<RestaurantSettingsView>> {
  const membership = await requireActiveMembership();
  const supabase = await createSupabaseServerClient();

  const [{ data: restaurant, error: restaurantError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase
      .from("restaurants")
      .select("id, name, currency, timezone, ordering_enabled")
      .eq("id", membership.restaurantId)
      .single(),
    supabase
      .from("restaurant_settings")
      .select("tax_rate, service_charge_rate")
      .eq("restaurant_id", membership.restaurantId)
      .single(),
  ]);

  if (restaurantError || !restaurant) {
    return toActionResult(
      new AppError("NOT_FOUND", restaurantError?.message ?? "restaurant not found", "Couldn't load restaurant settings."),
    );
  }
  if (settingsError || !settings) {
    return toActionResult(
      new AppError("NOT_FOUND", settingsError?.message ?? "restaurant_settings not found", "Couldn't load restaurant settings."),
    );
  }

  return {
    ok: true,
    data: {
      restaurantId: restaurant.id,
      name: restaurant.name,
      currency: restaurant.currency,
      timezone: restaurant.timezone,
      orderingEnabled: restaurant.ordering_enabled,
      taxRatePercent: toPercent(Number(settings.tax_rate)),
      serviceChargeRatePercent: toPercent(Number(settings.service_charge_rate)),
    },
  };
}

/**
 * Two independent UPDATEs (restaurants, then restaurant_settings) rather
 * than one RPC — both are already directly admin-writable under RLS with
 * no new function needed. Not cross-table atomic: a failure after the
 * first UPDATE leaves restaurants saved but restaurant_settings
 * unchanged. Acceptable for an admin-only settings screen (low
 * concurrency, easy to retry, no customer-facing invariant depends on
 * both changing together) — see the Phase 9 report for why this wasn't
 * escalated to a new SECURITY DEFINER function.
 */
export async function updateRestaurantSettings(
  input: UpdateRestaurantSettingsInput,
): Promise<ActionResult<RestaurantSettingsView>> {
  const membership = await requireActiveMembership();

  if (!can(membership.role, "settings:write")) {
    return toActionResult(
      new AppError("FORBIDDEN", "role lacks settings:write", "You don't have permission to change restaurant settings."),
    );
  }

  const parsed = updateRestaurantSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Please check the highlighted fields."));
  }

  const restaurantId = membership.restaurantId;
  const supabase = await createSupabaseServerClient();
  const before = await getRestaurantSettings();

  const { data: restaurantRow, error: restaurantUpdateError } = await supabase
    .from("restaurants")
    .update({
      name: parsed.data.name,
      currency: parsed.data.currency,
      timezone: parsed.data.timezone,
      ordering_enabled: parsed.data.orderingEnabled,
    })
    .eq("id", restaurantId)
    .select("id, name, currency, timezone, ordering_enabled")
    .single();

  if (restaurantUpdateError || !restaurantRow) {
    return toActionResult(
      new AppError("INTERNAL", restaurantUpdateError?.message ?? "update failed", "Couldn't save restaurant settings. Please try again."),
    );
  }

  const taxRateFraction = toFraction(parsed.data.taxRatePercent);
  const serviceChargeRateFraction = toFraction(parsed.data.serviceChargeRatePercent);

  const { data: settingsRow, error: settingsUpdateError } = await supabase
    .from("restaurant_settings")
    .update({ tax_rate: taxRateFraction, service_charge_rate: serviceChargeRateFraction })
    .eq("restaurant_id", restaurantId)
    .select("tax_rate, service_charge_rate")
    .single();

  if (settingsUpdateError || !settingsRow) {
    return toActionResult(
      new AppError(
        "INTERNAL",
        settingsUpdateError?.message ?? "update failed",
        "Restaurant details saved, but tax/service charge couldn't be updated. Please try again.",
      ),
    );
  }

  await recordSettingsAudit(supabase, restaurantId, before, parsed.data, {
    name: restaurantRow.name,
    currency: restaurantRow.currency,
    timezone: restaurantRow.timezone,
    orderingEnabled: restaurantRow.ordering_enabled,
    taxRatePercent: toPercent(Number(settingsRow.tax_rate)),
    serviceChargeRatePercent: toPercent(Number(settingsRow.service_charge_rate)),
  });

  return {
    ok: true,
    data: {
      restaurantId,
      name: restaurantRow.name,
      currency: restaurantRow.currency,
      timezone: restaurantRow.timezone,
      orderingEnabled: restaurantRow.ordering_enabled,
      taxRatePercent: toPercent(Number(settingsRow.tax_rate)),
      serviceChargeRatePercent: toPercent(Number(settingsRow.service_charge_rate)),
    },
  };
}

/**
 * Reuses the audit_logs / log_audit_event foundation laid down in Phase 2
 * (db/migrations/0001_functions.sql) via the shared lib/audit.ts wrapper.
 * One entry per table actually touched (restaurants vs.
 * restaurant_settings), and only when something actually changed, so a
 * no-op save doesn't create log noise.
 */
async function recordSettingsAudit(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  restaurantId: string,
  before: ActionResult<RestaurantSettingsView>,
  input: UpdateRestaurantSettingsInput,
  after: Omit<RestaurantSettingsView, "restaurantId">,
): Promise<void> {
  if (!before.ok) return;

  const restaurantChanged =
    before.data.name !== input.name ||
    before.data.currency !== input.currency ||
    before.data.timezone !== input.timezone ||
    before.data.orderingEnabled !== input.orderingEnabled;

  if (restaurantChanged) {
    await logAuditEvent(supabase, {
      restaurantId,
      action: "settings.restaurant.update",
      entityType: "restaurants",
      entityId: restaurantId,
      previousValue: {
        name: before.data.name,
        currency: before.data.currency,
        timezone: before.data.timezone,
        orderingEnabled: before.data.orderingEnabled,
      },
      newValue: {
        name: after.name,
        currency: after.currency,
        timezone: after.timezone,
        orderingEnabled: after.orderingEnabled,
      },
    });
  }

  const settingsChanged =
    before.data.taxRatePercent !== after.taxRatePercent || before.data.serviceChargeRatePercent !== after.serviceChargeRatePercent;

  if (settingsChanged) {
    await logAuditEvent(supabase, {
      restaurantId,
      action: "settings.tax_service_charge.update",
      entityType: "restaurant_settings",
      entityId: restaurantId,
      previousValue: {
        taxRatePercent: before.data.taxRatePercent,
        serviceChargeRatePercent: before.data.serviceChargeRatePercent,
      },
      newValue: {
        taxRatePercent: after.taxRatePercent,
        serviceChargeRatePercent: after.serviceChargeRatePercent,
      },
    });
  }
}
