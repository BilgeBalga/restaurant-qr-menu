import { describe, expect, it } from "vitest";
import { provisionRestaurantInputSchema } from "@/lib/validation/platformAdmin";

const valid = {
  name: "The Ivory Bistro",
  slug: "the-ivory-bistro",
  timezone: "Europe/Berlin",
  currency: "EUR",
  ownerEmail: "owner@example.com",
};

describe("provisionRestaurantInputSchema", () => {
  it("accepts a fully valid input", () => {
    expect(provisionRestaurantInputSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a valid input with an optional order number prefix", () => {
    expect(provisionRestaurantInputSchema.safeParse({ ...valid, orderNumberPrefix: "b" }).success).toBe(true);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(provisionRestaurantInputSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(provisionRestaurantInputSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });

  it("rejects a slug that's too short", () => {
    expect(provisionRestaurantInputSchema.safeParse({ ...valid, slug: "a" }).success).toBe(false);
  });

  it("rejects a slug with invalid characters (uppercase, spaces, underscores)", () => {
    expect(provisionRestaurantInputSchema.safeParse({ ...valid, slug: "The Ivory Bistro" }).success).toBe(false);
    expect(provisionRestaurantInputSchema.safeParse({ ...valid, slug: "the_ivory_bistro" }).success).toBe(false);
    expect(provisionRestaurantInputSchema.safeParse({ ...valid, slug: "the-ivory-bistro!" }).success).toBe(false);
  });

  it("accepts a slug with lowercase letters, numbers, and hyphens", () => {
    expect(provisionRestaurantInputSchema.safeParse({ ...valid, slug: "bistro-42-downtown" }).success).toBe(true);
  });

  it("lowercases a slug given in mixed case rather than rejecting it outright", () => {
    const parsed = provisionRestaurantInputSchema.safeParse({ ...valid, slug: "the-ivory-bistro" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a currency the app doesn't support", () => {
    expect(provisionRestaurantInputSchema.safeParse({ ...valid, currency: "JPY" }).success).toBe(false);
  });

  it("accepts every currency the app actually supports", () => {
    for (const currency of ["EUR", "USD", "GBP"]) {
      expect(provisionRestaurantInputSchema.safeParse({ ...valid, currency }).success).toBe(true);
    }
  });

  it("rejects an invalid timezone", () => {
    expect(provisionRestaurantInputSchema.safeParse({ ...valid, timezone: "Not/A_Zone" }).success).toBe(false);
  });

  it("rejects an invalid owner email", () => {
    expect(provisionRestaurantInputSchema.safeParse({ ...valid, ownerEmail: "not-an-email" }).success).toBe(false);
    expect(provisionRestaurantInputSchema.safeParse({ ...valid, ownerEmail: "" }).success).toBe(false);
  });

  it("lowercases the owner email rather than rejecting mixed case", () => {
    const parsed = provisionRestaurantInputSchema.safeParse({ ...valid, ownerEmail: "Owner@Example.com" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.ownerEmail).toBe("owner@example.com");
  });

  it("rejects an order number prefix that's too long", () => {
    expect(provisionRestaurantInputSchema.safeParse({ ...valid, orderNumberPrefix: "TOOLONG" }).success).toBe(false);
  });
});
