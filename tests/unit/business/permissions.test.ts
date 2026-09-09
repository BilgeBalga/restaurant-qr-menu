import { describe, expect, it } from "vitest";
import { can } from "@/lib/business/permissions";

describe("can", () => {
  it("grants admin every action in the §11 table", () => {
    expect(can("admin", "menu:write")).toBe(true);
    expect(can("admin", "tables:write")).toBe(true);
    expect(can("admin", "staff:manage")).toBe(true);
    expect(can("admin", "settings:write")).toBe(true);
    expect(can("admin", "audit:read")).toBe(true);
    expect(can("admin", "orders:cancel:ready")).toBe(true);
  });

  it("denies staff anything admin-only (§11)", () => {
    expect(can("staff", "menu:write")).toBe(false);
    expect(can("staff", "tables:write")).toBe(false);
    expect(can("staff", "staff:manage")).toBe(false);
    expect(can("staff", "settings:write")).toBe(false);
    expect(can("staff", "audit:read")).toBe(false);
    expect(can("staff", "orders:cancel:ready")).toBe(false);
  });

  it("grants staff the operational floor: orders, history", () => {
    expect(can("staff", "orders:read")).toBe(true);
    expect(can("staff", "orders:status:write")).toBe(true);
    expect(can("staff", "orders:cancel")).toBe(true);
    expect(can("staff", "history:read")).toBe(true);
  });

  it("keeps kitchen to order-queue actions only, per its documented scope", () => {
    expect(can("kitchen", "orders:read")).toBe(true);
    expect(can("kitchen", "orders:status:write")).toBe(true);
    expect(can("kitchen", "history:read")).toBe(false);
    expect(can("kitchen", "menu:write")).toBe(false);
  });
});
