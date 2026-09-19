import { describe, expect, it } from "vitest";
import { canClearTable, deriveTableStatus, type TableOrderInfo, type TableStatus } from "@/lib/business/tableStatus";

const NOW = new Date("2026-09-09T19:00:00.000Z");

function ordersAgo(status: TableOrderInfo["status"], minutesAgo: number): TableOrderInfo {
  return { status, createdAt: new Date(NOW.getTime() - minutesAgo * 60_000) };
}

describe("deriveTableStatus", () => {
  it("is available when there is no open session at all", () => {
    expect(deriveTableStatus(null, [], NOW)).toBe("available");
    expect(deriveTableStatus({ status: "closed" }, [], NOW)).toBe("available");
  });

  it("is ordering when a session is open but nothing has been submitted yet", () => {
    expect(deriveTableStatus({ status: "open" }, [], NOW)).toBe("ordering");
  });

  it("is preparing when there's an active order and nothing is ready or stale", () => {
    const orders = [ordersAgo("preparing", 2)];
    expect(deriveTableStatus({ status: "open" }, orders, NOW)).toBe("preparing");
  });

  it("needs attention as soon as any order is ready", () => {
    const orders = [ordersAgo("preparing", 2), ordersAgo("ready", 5)];
    expect(deriveTableStatus({ status: "open" }, orders, NOW)).toBe("needs_attention");
  });

  it("needs attention when a new order has sat unattended past the threshold", () => {
    const orders = [ordersAgo("new", 15)];
    expect(deriveTableStatus({ status: "open" }, orders, NOW, 10)).toBe("needs_attention");
  });

  it("does not flag a fresh new order as needing attention", () => {
    const orders = [ordersAgo("new", 2)];
    expect(deriveTableStatus({ status: "open" }, orders, NOW, 10)).toBe("preparing");
  });

  it("is served when the session is open and every order is terminal", () => {
    const orders = [ordersAgo("completed", 30)];
    expect(deriveTableStatus({ status: "open" }, orders, NOW)).toBe("served");
  });

  it("is served (not available) with a mix of completed and cancelled orders", () => {
    const orders = [ordersAgo("completed", 40), ordersAgo("cancelled", 20)];
    expect(deriveTableStatus({ status: "open" }, orders, NOW)).toBe("served");
  });
});

describe("canClearTable", () => {
  it("is false only for available — every other status has an open session worth clearing", () => {
    const statuses: TableStatus[] = ["ordering", "preparing", "needs_attention", "served"];
    for (const status of statuses) {
      expect(canClearTable(status)).toBe(true);
    }
    expect(canClearTable("available")).toBe(false);
  });
});
