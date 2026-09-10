"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { emptyCart, type Cart, type CartLine, type CartOptionSelection } from "@/lib/cart/cartTypes";
import { computeOrderTotals } from "@/lib/business/pricing";

function storageKey(tableId: string): string {
  return `tableside:cart:${tableId}`;
}

function loadCart(tableId: string): Cart {
  try {
    const raw = localStorage.getItem(storageKey(tableId));
    if (!raw) return emptyCart(tableId);
    const parsed = JSON.parse(raw) as Cart;
    if (parsed.tableId !== tableId) return emptyCart(tableId);
    return parsed;
  } catch {
    return emptyCart(tableId);
  }
}

function saveCart(cart: Cart): void {
  try {
    localStorage.setItem(storageKey(cart.tableId), JSON.stringify(cart));
  } catch {
    // localStorage unavailable (private mode, quota, etc.) — cart just won't persist across reloads.
  }
}

/**
 * A minimal external store, read via useSyncExternalStore — the correct
 * pattern for SSR-safe localStorage hydration (server has no localStorage,
 * so getServerSnapshot returns an empty cart; the client snapshot is
 * read/updated here). This avoids the anti-pattern of calling setState
 * synchronously inside a hydration effect.
 *
 * getServerSnapshot must return a referentially *stable* value —
 * useSyncExternalStore calls it on every render to check whether
 * anything changed, and a fresh object each time (the original bug here:
 * `emptyCart(tableId)` allocates a new array and a new random
 * idempotencyKey on every call) reads as "always different," which is
 * exactly the "getServerSnapshot should be cached" warning and the
 * infinite-render risk it's warning about. `serverSnapshot` is computed
 * once, in the constructor, and never reassigned — one stable reference
 * per CartStore instance (and a fresh instance, so a fresh stable
 * snapshot, is created per tableId via the useMemo below).
 */
export class CartStore {
  readonly tableId: string;
  private listeners = new Set<() => void>();
  private cart: Cart;
  private readonly serverSnapshot: Cart;
  private hydrated = false;

  constructor(tableId: string) {
    this.tableId = tableId;
    this.cart = emptyCart(tableId);
    this.serverSnapshot = this.cart;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (!this.hydrated && typeof window !== "undefined") {
      this.hydrated = true;
      this.cart = loadCart(this.tableId);
      this.notify();
    }
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Cart => this.cart;
  getServerSnapshot = (): Cart => this.serverSnapshot;

  private notify() {
    for (const listener of this.listeners) listener();
  }

  update(updater: (prev: Cart) => Cart): void {
    this.cart = updater(this.cart);
    saveCart(this.cart);
    this.notify();
  }
}

interface CartContextValue {
  cart: Cart;
  addLine: (line: Omit<CartLine, "lineId">) => void;
  removeLine: (lineId: string) => void;
  updateQuantity: (lineId: string, quantity: number) => void;
  setCustomerNote: (note: string) => void;
  clearCart: () => void;
  lineCount: number;
  estimateTotalCents: (taxRate: number, serviceChargeRate: number) => number;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ tableId, children }: { tableId: string; children: React.ReactNode }) {
  const store = useMemo(() => new CartStore(tableId), [tableId]);
  const cart = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  const addLine = useCallback(
    (line: Omit<CartLine, "lineId">) => {
      store.update((prev) => ({ ...prev, lines: [...prev.lines, { ...line, lineId: crypto.randomUUID() }] }));
    },
    [store],
  );

  const removeLine = useCallback(
    (lineId: string) => {
      store.update((prev) => ({ ...prev, lines: prev.lines.filter((l) => l.lineId !== lineId) }));
    },
    [store],
  );

  const updateQuantity = useCallback(
    (lineId: string, quantity: number) => {
      store.update((prev) => ({
        ...prev,
        lines: prev.lines.map((l) => (l.lineId === lineId ? { ...l, quantity: Math.max(1, Math.min(20, quantity)) } : l)),
      }));
    },
    [store],
  );

  const setCustomerNote = useCallback(
    (note: string) => {
      store.update((prev) => ({ ...prev, customerNote: note }));
    },
    [store],
  );

  const clearCart = useCallback(() => {
    store.update(() => emptyCart(tableId));
  }, [store, tableId]);

  const lineCount = cart.lines.reduce((sum, l) => sum + l.quantity, 0);

  const estimateTotalCents = useCallback(
    (taxRate: number, serviceChargeRate: number) =>
      computeOrderTotals(
        cart.lines.map((l) => ({
          unitPriceCents: l.unitPriceCents,
          quantity: l.quantity,
          options: l.options.map((o: CartOptionSelection) => ({ priceDeltaCents: o.priceDeltaCents })),
        })),
        taxRate,
        serviceChargeRate,
      ).totalCents,
    [cart.lines],
  );

  const value = useMemo(
    () => ({ cart, addLine, removeLine, updateQuantity, setCustomerNote, clearCart, lineCount, estimateTotalCents }),
    [cart, addLine, removeLine, updateQuantity, setCustomerNote, clearCart, lineCount, estimateTotalCents],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
