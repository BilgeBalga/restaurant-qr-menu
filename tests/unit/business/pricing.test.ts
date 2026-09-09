import { describe, expect, it } from "vitest";
import { computeOrderTotals, type PricedLineItem } from "@/lib/business/pricing";

describe("computeOrderTotals", () => {
  it("matches the brief's §39 acceptance scenario: 2 burgers, 1 salad, 2 colas, no tax", () => {
    const items: PricedLineItem[] = [
      { unitPriceCents: 1200, quantity: 2, options: [] }, // Classic Burger
      { unitPriceCents: 950, quantity: 1, options: [] }, // Caesar Salad
      { unitPriceCents: 300, quantity: 2, options: [] }, // Cola
    ];

    const totals = computeOrderTotals(items, 0, 0);

    expect(totals.subtotalCents).toBe(1200 * 2 + 950 + 300 * 2);
    expect(totals.taxCents).toBe(0);
    expect(totals.serviceChargeCents).toBe(0);
    expect(totals.totalCents).toBe(totals.subtotalCents);
  });

  it("adds option price deltas per unit before multiplying by quantity", () => {
    const items: PricedLineItem[] = [
      {
        unitPriceCents: 1000,
        quantity: 3,
        options: [{ priceDeltaCents: 200 }, { priceDeltaCents: 150 }],
      },
    ];

    const totals = computeOrderTotals(items, 0, 0);

    // (1000 + 200 + 150) * 3
    expect(totals.subtotalCents).toBe(1350 * 3);
  });

  it("computes tax and service charge from the subtotal and rounds to the nearest cent", () => {
    const items: PricedLineItem[] = [{ unitPriceCents: 999, quantity: 1, options: [] }];

    const totals = computeOrderTotals(items, 0.08, 0.1);

    expect(totals.subtotalCents).toBe(999);
    expect(totals.taxCents).toBe(Math.round(999 * 0.08));
    expect(totals.serviceChargeCents).toBe(Math.round(999 * 0.1));
    expect(totals.totalCents).toBe(999 + totals.taxCents + totals.serviceChargeCents);
  });

  it("returns all zeros for an empty order", () => {
    expect(computeOrderTotals([], 0.08, 0.1)).toEqual({
      subtotalCents: 0,
      taxCents: 0,
      serviceChargeCents: 0,
      totalCents: 0,
    });
  });
});
