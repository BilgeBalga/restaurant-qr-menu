import { describe, expect, it } from "vitest";
import { updateRestaurantSettingsInputSchema } from "@/lib/validation/settings";

const valid = {
  name: "Demo Bistro",
  currency: "EUR",
  timezone: "Europe/Berlin",
  orderingEnabled: true,
  taxRatePercent: 8.5,
  serviceChargeRatePercent: 10,
};

describe("updateRestaurantSettingsInputSchema", () => {
  it("accepts a fully valid input", () => {
    expect(updateRestaurantSettingsInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(updateRestaurantSettingsInputSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(updateRestaurantSettingsInputSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });

  it("rejects a currency the app doesn't support", () => {
    expect(updateRestaurantSettingsInputSchema.safeParse({ ...valid, currency: "JPY" }).success).toBe(false);
  });

  it("accepts every currency the app actually supports", () => {
    for (const currency of ["EUR", "USD", "GBP"]) {
      expect(updateRestaurantSettingsInputSchema.safeParse({ ...valid, currency }).success).toBe(true);
    }
  });

  it("rejects an unrecognized timezone", () => {
    expect(updateRestaurantSettingsInputSchema.safeParse({ ...valid, timezone: "Not/AZone" }).success).toBe(false);
  });

  it("rejects negative tax/service-charge percentages", () => {
    expect(updateRestaurantSettingsInputSchema.safeParse({ ...valid, taxRatePercent: -1 }).success).toBe(false);
    expect(updateRestaurantSettingsInputSchema.safeParse({ ...valid, serviceChargeRatePercent: -0.01 }).success).toBe(false);
  });

  it("rejects percentages over 100", () => {
    expect(updateRestaurantSettingsInputSchema.safeParse({ ...valid, taxRatePercent: 100.01 }).success).toBe(false);
  });

  it("accepts the 0 and 100 boundary values", () => {
    expect(updateRestaurantSettingsInputSchema.safeParse({ ...valid, taxRatePercent: 0, serviceChargeRatePercent: 100 }).success).toBe(
      true,
    );
  });

  it("rejects a non-boolean orderingEnabled", () => {
    expect(updateRestaurantSettingsInputSchema.safeParse({ ...valid, orderingEnabled: "yes" }).success).toBe(false);
  });
});
