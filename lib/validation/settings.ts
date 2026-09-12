import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/format/money";
import { isValidTimeZone } from "@/lib/business/timezone";

/**
 * Shape only, not authority — same convention as lib/validation/order.ts.
 * The real guarantee is Postgres RLS (restaurants_update_admin,
 * restaurant_settings_update_admin) plus the CHECK constraints on
 * restaurant_settings; this schema exists to reject a malformed request
 * with a clear message before it reaches the database.
 *
 * Tax/service-charge are expressed here as percentages (0-100) because
 * that's what an admin actually types into a form — restaurant_settings
 * stores them as fractions (0-1, numeric(5,4)); the conversion happens in
 * app/actions/settings.ts, once, at the boundary.
 */
export const updateRestaurantSettingsInputSchema = z.object({
  name: z.string().trim().min(1, "Restaurant name is required").max(200),
  currency: z.enum(SUPPORTED_CURRENCIES),
  timezone: z.string().refine(isValidTimeZone, { message: "Not a recognized timezone" }),
  orderingEnabled: z.boolean(),
  taxRatePercent: z.number().min(0, "Must be 0 or greater").max(100, "Must be 100 or less"),
  serviceChargeRatePercent: z.number().min(0, "Must be 0 or greater").max(100, "Must be 100 or less"),
});

export type UpdateRestaurantSettingsInput = z.infer<typeof updateRestaurantSettingsInputSchema>;
