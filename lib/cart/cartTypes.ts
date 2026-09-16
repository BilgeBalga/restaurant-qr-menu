/**
 * Client-side, ephemeral, advisory — §14. Nothing here is authoritative:
 * displayed prices are a preview, computeOrderTotals (lib/business/pricing)
 * gives an estimate for the review screen, and create_order re-derives the
 * real total server-side regardless of what this object contains.
 */
export interface CartOptionSelection {
  groupId: string;
  groupName: string;
  choiceId: string;
  choiceName: string;
  priceDeltaCents: number;
}

export interface CartLine {
  lineId: string;
  menuItemId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  options: CartOptionSelection[];
  lineNote?: string;
  /**
   * Display-only, added Stage 2 for the redesigned cart's item thumbnails
   * — never read by create_order or any pricing/idempotency logic, so a
   * cart persisted before this field existed still round-trips fine
   * (reads back as undefined, MenuItemImage's existing monogram fallback
   * handles it exactly like a menu item with no photo).
   */
  imageUrl?: string | null;
}

export interface Cart {
  tableId: string;
  idempotencyKey: string;
  lines: CartLine[];
  customerNote?: string;
}

export function emptyCart(tableId: string): Cart {
  return { tableId, idempotencyKey: crypto.randomUUID(), lines: [] };
}
