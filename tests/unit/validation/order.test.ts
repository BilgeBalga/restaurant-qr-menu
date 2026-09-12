import { describe, expect, it } from "vitest";
import { orderHistoryFiltersSchema } from "@/lib/validation/order";

describe("orderHistoryFiltersSchema", () => {
  it("defaults to no status filter, all-time range, and page 1 when given nothing", () => {
    const result = orderHistoryFiltersSchema.parse({});
    expect(result).toEqual({ status: undefined, range: "all", tableId: undefined, search: undefined, page: 1 });
  });

  it("accepts a valid completed/cancelled status", () => {
    expect(orderHistoryFiltersSchema.parse({ status: "completed" }).status).toBe("completed");
    expect(orderHistoryFiltersSchema.parse({ status: "cancelled" }).status).toBe("cancelled");
  });

  it("falls back to undefined status for anything else (garbage query string, or the 'All' option's empty value)", () => {
    expect(orderHistoryFiltersSchema.parse({ status: "" }).status).toBeUndefined();
    expect(orderHistoryFiltersSchema.parse({ status: "new" }).status).toBeUndefined();
    expect(orderHistoryFiltersSchema.parse({ status: "not-a-status" }).status).toBeUndefined();
  });

  it("accepts every defined date range option", () => {
    for (const range of ["today", "last7", "last30", "all"]) {
      expect(orderHistoryFiltersSchema.parse({ range }).range).toBe(range);
    }
  });

  it("falls back to 'all' for an invalid range rather than rejecting the request", () => {
    expect(orderHistoryFiltersSchema.parse({ range: "last-year" }).range).toBe("all");
    expect(orderHistoryFiltersSchema.parse({ range: "" }).range).toBe("all");
  });

  it("accepts a valid UUID tableId and falls back to undefined for anything else", () => {
    const id = "11111111-1111-4111-8111-111111111111"; // RFC4122 version/variant nibbles matter to zod's .uuid()
    expect(orderHistoryFiltersSchema.parse({ tableId: id }).tableId).toBe(id);
    expect(orderHistoryFiltersSchema.parse({ tableId: "" }).tableId).toBeUndefined();
    expect(orderHistoryFiltersSchema.parse({ tableId: "not-a-uuid" }).tableId).toBeUndefined();
  });

  it("trims a search term and rejects/truncates absurdly long input via .catch", () => {
    expect(orderHistoryFiltersSchema.parse({ search: "  T-042  " }).search).toBe("T-042");
    expect(orderHistoryFiltersSchema.parse({ search: "a".repeat(200) }).search).toBeUndefined();
  });

  it("coerces a string page (as it always arrives from a URL query string) to a number", () => {
    expect(orderHistoryFiltersSchema.parse({ page: "3" }).page).toBe(3);
  });

  it("falls back to page 1 for a missing, invalid, or non-positive page", () => {
    expect(orderHistoryFiltersSchema.parse({}).page).toBe(1);
    expect(orderHistoryFiltersSchema.parse({ page: "0" }).page).toBe(1);
    expect(orderHistoryFiltersSchema.parse({ page: "-1" }).page).toBe(1);
    expect(orderHistoryFiltersSchema.parse({ page: "not-a-number" }).page).toBe(1);
  });
});
