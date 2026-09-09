/**
 * Server-side pricing (§9/§26 of the reviewed architecture). This is the
 * one place order totals are computed. The create_order RPC (Phase 6) does
 * the same arithmetic in Postgres after re-fetching live prices — this
 * module exists so the arithmetic itself is unit-testable without a
 * database, and so the Next.js server action and the RPC can't drift
 * against two different rounding rules.
 *
 * Everything is integer cents. No floating-point currency math, ever.
 */

export interface PricedOption {
  priceDeltaCents: number;
}

export interface PricedLineItem {
  unitPriceCents: number;
  quantity: number;
  options: readonly PricedOption[];
}

export interface OrderTotals {
  subtotalCents: number;
  taxCents: number;
  serviceChargeCents: number;
  totalCents: number;
}

function lineTotalCents(item: PricedLineItem): number {
  const optionsDeltaCents = item.options.reduce((sum, o) => sum + o.priceDeltaCents, 0);
  return (item.unitPriceCents + optionsDeltaCents) * item.quantity;
}

/**
 * taxRate / serviceChargeRate are decimal fractions (e.g. 0.0800 for 8%),
 * matching restaurant_settings.tax_rate / service_charge_rate (§7).
 */
export function computeOrderTotals(
  items: readonly PricedLineItem[],
  taxRate: number,
  serviceChargeRate: number,
): OrderTotals {
  const subtotalCents = items.reduce((sum, item) => sum + lineTotalCents(item), 0);
  const taxCents = Math.round(subtotalCents * taxRate);
  const serviceChargeCents = Math.round(subtotalCents * serviceChargeRate);
  const totalCents = subtotalCents + taxCents + serviceChargeCents;

  return { subtotalCents, taxCents, serviceChargeCents, totalCents };
}
