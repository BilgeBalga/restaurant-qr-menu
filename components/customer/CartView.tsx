"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/components/customer/CartProvider";
import { createOrder } from "@/app/actions/orders";
import { computeOrderTotals } from "@/lib/business/pricing";

function money(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

/**
 * Subtotal only — deliberately no tax/service-charge estimate here.
 * restaurant_settings has zero anon RLS grant (§26): the customer app
 * never reads tax_rate directly. The real total, tax included, comes
 * back from create_order's response and from get_order_by_token on the
 * confirmation/tracking page — this page is honest about only knowing
 * the subtotal until then, rather than guessing.
 */
export function CartView({ currency, orderingEnabled }: { currency: string; orderingEnabled: boolean }) {
  const router = useRouter();
  const { cart, removeLine, updateQuantity, setCustomerNote, clearCart } = useCart();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const subtotalCents = computeOrderTotals(
    cart.lines.map((l) => ({ unitPriceCents: l.unitPriceCents, quantity: l.quantity, options: l.options.map((o) => ({ priceDeltaCents: o.priceDeltaCents })) })),
    0,
    0,
  ).subtotalCents;

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await createOrder({
        tableId: cart.tableId,
        items: cart.lines.map((line) => ({
          menuItemId: line.menuItemId,
          quantity: line.quantity,
          optionChoiceIds: line.options.map((o) => o.choiceId),
          lineNote: line.lineNote,
        })),
        customerNote: cart.customerNote,
        idempotencyKey: cart.idempotencyKey,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      clearCart();
      router.push(`/order/${result.data.accessToken}`);
    });
  }

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 pt-16 text-center">
        <p className="text-[var(--color-charcoal-muted)]">Your cart is empty.</p>
        <Link href="/menu" className="mt-4 inline-block text-[var(--color-bronze-strong)] underline">
          Back to menu
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-32 pt-6">
      <h1 className="mb-4 font-display text-2xl font-semibold">Your order</h1>

      {!orderingEnabled ? (
        <p className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-800">
          This restaurant isn&apos;t taking orders right now — you can&apos;t submit until it reopens.
        </p>
      ) : null}

      <ul className="flex flex-col gap-4">
        {cart.lines.map((line) => (
          <li key={line.lineId} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)] p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{line.name}</span>
              <span className="tabular-nums">{money(line.unitPriceCents * line.quantity + line.options.reduce((s, o) => s + o.priceDeltaCents, 0) * line.quantity, currency)}</span>
            </div>
            {line.options.length > 0 ? (
              <p className="mt-1 text-xs text-[var(--color-charcoal-muted)]">{line.options.map((o) => o.choiceName).join(", ")}</p>
            ) : null}
            {line.lineNote ? <p className="mt-1 text-xs italic text-[var(--color-charcoal-muted)]">&ldquo;{line.lineNote}&rdquo;</p> : null}
            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateQuantity(line.lineId, line.quantity - 1)}
                  className="h-7 w-7 rounded-full border border-[var(--color-border)]"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="w-5 text-center text-sm tabular-nums">{line.quantity}</span>
                <button
                  type="button"
                  onClick={() => updateQuantity(line.lineId, line.quantity + 1)}
                  className="h-7 w-7 rounded-full border border-[var(--color-border)]"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
              <button type="button" onClick={() => removeLine(line.lineId)} className="text-sm text-red-700 underline">
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <label htmlFor="order-note" className="mb-1 block text-sm font-medium">
          Note for the whole order (optional)
        </label>
        <textarea
          id="order-note"
          defaultValue={cart.customerNote ?? ""}
          onBlur={(e) => setCustomerNote(e.target.value)}
          maxLength={500}
          rows={2}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-ivory-raised)] px-3 py-2 text-sm"
        />
      </div>

      <div className="mt-6 flex justify-between border-t border-[var(--color-border)] pt-4 text-sm">
        <span className="text-[var(--color-charcoal-muted)]">Subtotal</span>
        <span className="tabular-nums">{money(subtotalCents, currency)}</span>
      </div>
      <p className="mt-1 text-xs text-[var(--color-charcoal-muted)]">Tax and service charge are added at checkout.</p>

      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}

      <div className="fixed inset-x-4 bottom-4 mx-auto max-w-2xl">
        <button
          type="button"
          disabled={isPending || !orderingEnabled}
          onClick={handleSubmit}
          className="w-full rounded-lg bg-[var(--color-bronze)] px-5 py-3.5 font-medium text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Placing order…" : "Place order"}
        </button>
      </div>
    </div>
  );
}
