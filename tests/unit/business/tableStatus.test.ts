import { describe, expect, it } from "vitest";
import { deriveTableStatus, type TableOrderInfo } from "@/lib/business/tableStatus";

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

  it("falls back to available for the (should-be-unreachable) all-terminal case", () => {
    const orders = [ordersAgo("completed", 30)];
    expect(deriveTableStatus({ status: "open" }, orders, NOW)).toBe("available");
  });
});
