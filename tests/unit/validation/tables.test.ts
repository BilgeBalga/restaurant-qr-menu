import { describe, expect, it } from "vitest";
import { createTableInputSchema, tableIdInputSchema, updateTableInputSchema } from "@/lib/validation/tables";

describe("createTableInputSchema", () => {
  it("accepts a valid table with and without seats", () => {
    expect(createTableInputSchema.safeParse({ label: "12" }).success).toBe(true);
    expect(createTableInputSchema.safeParse({ label: "12", seats: 4 }).success).toBe(true);
  });

  it("rejects an empty or whitespace-only label", () => {
    expect(createTableInputSchema.safeParse({ label: "" }).success).toBe(false);
    expect(createTableInputSchema.safeParse({ label: "   " }).success).toBe(false);
  });

  it("rejects zero, negative, or non-integer seats (mirrors the tables_seats_positive CHECK constraint)", () => {
    expect(createTableInputSchema.safeParse({ label: "12", seats: 0 }).success).toBe(false);
    expect(createTableInputSchema.safeParse({ label: "12", seats: -1 }).success).toBe(false);
    expect(createTableInputSchema.safeParse({ label: "12", seats: 2.5 }).success).toBe(false);
  });
});

describe("updateTableInputSchema", () => {
  it("is a true partial — omitted fields stay undefined", () => {
    const result = updateTableInputSchema.safeParse({ id: "11111111-1111-4111-8111-111111111111", isActive: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.label).toBeUndefined();
      expect(result.data.seats).toBeUndefined();
    }
  });

  it("distinguishes omitted seats (don't touch) from explicit null (clear it)", () => {
    const omitted = updateTableInputSchema.safeParse({ id: "11111111-1111-4111-8111-111111111111" });
    const cleared = updateTableInputSchema.safeParse({ id: "11111111-1111-4111-8111-111111111111", seats: null });
    expect(omitted.success && omitted.data.seats).toBeUndefined();
    expect(cleared.success && cleared.data.seats).toBeNull();
  });

  it("rejects an invalid id", () => {
    expect(updateTableInputSchema.safeParse({ id: "not-a-uuid", label: "12" }).success).toBe(false);
  });
});

describe("tableIdInputSchema", () => {
  it("accepts a valid uuid and rejects anything else", () => {
    expect(tableIdInputSchema.safeParse({ tableId: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
    expect(tableIdInputSchema.safeParse({ tableId: "not-a-uuid" }).success).toBe(false);
    expect(tableIdInputSchema.safeParse({}).success).toBe(false);
  });
});
