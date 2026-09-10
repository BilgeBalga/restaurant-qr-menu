import { describe, expect, it } from "vitest";
import { CartStore } from "@/components/customer/CartProvider";

/**
 * Regression test for the exact bug reported: getServerSnapshot must
 * return a referentially stable value, or useSyncExternalStore warns
 * ("The result of getServerSnapshot should be cached") and risks an
 * infinite render loop. The original bug was calling emptyCart(tableId)
 * — a fresh array plus a fresh random idempotencyKey — on every call.
 *
 * Only exercises getServerSnapshot()/getSnapshot() here, never
 * subscribe()/update() — those touch localStorage, unavailable in this
 * Node test environment (and rightly so: this test is about the
 * server-snapshot contract, not client hydration behavior).
 */
describe("CartStore.getServerSnapshot", () => {
  it("returns the exact same object reference on repeated calls", () => {
    const store = new CartStore("table-1");
    const first = store.getServerSnapshot();
    const second = store.getServerSnapshot();
    const third = store.getServerSnapshot();

    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it("returns an empty cart scoped to the correct tableId", () => {
    const store = new CartStore("table-42");
    const snapshot = store.getServerSnapshot();

    expect(snapshot.tableId).toBe("table-42");
    expect(snapshot.lines).toEqual([]);
  });

  it("matches getSnapshot() before any hydration has occurred (same underlying object)", () => {
    const store = new CartStore("table-1");
    expect(store.getSnapshot()).toBe(store.getServerSnapshot());
  });

  it("different CartStore instances (different tableIds) have independent, non-shared server snapshots", () => {
    const storeA = new CartStore("table-a");
    const storeB = new CartStore("table-b");

    expect(storeA.getServerSnapshot()).not.toBe(storeB.getServerSnapshot());
    expect(storeA.getServerSnapshot().tableId).toBe("table-a");
    expect(storeB.getServerSnapshot().tableId).toBe("table-b");
  });
});
