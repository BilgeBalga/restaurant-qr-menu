import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/format/money";
import { isValidTimeZone } from "@/lib/business/timezone";

/**
 * Shape only, not authority — same convention as every other validation
 * module here (lib/validation/order.ts, settings.ts, menu.ts). The real
 * guarantee is provision_restaurant()'s own is_platform_admin() check
 * plus restaurants.slug's UNIQUE constraint; this exists to reject a
 * malformed request with a clear message before it ever reaches the RPC.
 */

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Slug must be at least 2 characters")
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only");

export const provisionRestaurantInputSchema = z.object({
  name: z.string().trim().min(1, "Restaurant name is required").max(200),
  slug: slugSchema,
  timezone: z.string().refine(isValidTimeZone, { message: "Not a recognized timezone" }),
  currency: z.enum(SUPPORTED_CURRENCIES),
  ownerEmail: z.string().trim().toLowerCase().email("Enter a valid email address"),
  orderNumberPrefix: z.string().trim().toUpperCase().min(1).max(4).optional(),
});

export type ProvisionRestaurantInput = z.infer<typeof provisionRestaurantInputSchema>;
