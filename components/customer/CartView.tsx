"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/components/customer/CartProvider";
import { createOrder } from "@/app/actions/orders";
import { computeOrderTotals } from "@/lib/business/pricing";
import { formatMoney as money } from "@/lib/format/money";
import { MenuItemImage } from "@/components/ui/MenuItemImage";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StickyBar } from "@/components/ui/StickyBar";
import { CustomerBottomNav } from "@/components/customer/CustomerBottomNav";

function lastOrderStorageKey(tableId: string): string {
  return `tableside:last-order:${tableId}`;
}

/** Best-effort — same "never let this break the real flow" convention as CartProvider's own localStorage writes. */
function rememberLastOrder(tableId: string, accessToken: string): void {
  try {
    localStorage.setItem(lastOrderStorageKey(tableId), accessToken);
  } catch {
    // localStorage unavailable (private mode, quota, etc.) — the Orders tab just won't have a shortcut this visit.
  }
}

function MinusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.8 12.1a1 1 0 0 1-1 .9H8.8a1 1 0 0 1-1-.9L7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EmptyCartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M6 7h12l-1 12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7Z" strokeLinejoin="round" />
      <path d="M9 7V5a3 3 0 0 1 6 0v2" strokeLinecap="round" />
    </svg>
  );
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

      // Stage 1's flagged dependency: the Orders tab reads this same key
      // (CustomerBottomNav.tsx) to link back to this exact order — this
      // is the only place a new order's access token becomes reachable
      // outside the one-time redirect below.
      rememberLastOrder(cart.tableId, result.data.accessToken);

      clearCart();
      router.push(`/order/${result.data.accessToken}`);
    });
  }

  if (cart.lines.length === 0) {
    return (
      <div className="flex min-h-screen flex-col bg-[var(--color-canvas)]">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-24 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]">
            <EmptyCartIcon />
          </div>
          <h1 className="text-xl font-bold text-[var(--color-ink)]">Your cart is empty</h1>
          <p className="max-w-xs text-sm text-[var(--color-ink-muted)]">Add something delicious from the menu to get started.</p>
          <Link href="/menu">
            <Button variant="primary" className="mt-2">
              Browse the menu
            </Button>
          </Link>
        </div>
        <CustomerBottomNav tableId={cart.tableId} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      <div className="mx-auto w-full max-w-[480px] px-4 pb-[calc(11rem+env(safe-area-inset-bottom,0px))] pt-6">
        <header className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--color-ink)]">Your order</h1>
          <Link href="/menu" className="text-sm font-semibold text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
            Add more
          </Link>
        </header>

        {!orderingEnabled ? (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning)]">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--color-warning)]" aria-hidden="true" />
            This restaurant isn&apos;t taking orders right now — you can&apos;t submit until it reopens.
          </div>
        ) : null}

        <ul className="flex flex-col gap-3">
          {cart.lines.map((line) => (
            <li key={line.lineId}>
              <Card className="flex gap-3 p-3">
                <MenuItemImage
                  name={line.name}
                  imageUrl={line.imageUrl ?? null}
                  className="h-16 w-16 shrink-0 rounded-xl"
                  monogramClassName="text-xl"
                  fallbackBgClassName="bg-[var(--color-surface-sunken)]"
                  fallbackTextClassName="text-[var(--color-primary)]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-[var(--color-ink)]">{line.name}</span>
                    <span className="whitespace-nowrap tabular-nums font-bold text-[var(--color-ink)]">
                      {money(
                        line.unitPriceCents * line.quantity + line.options.reduce((s, o) => s + o.priceDeltaCents, 0) * line.quantity,
                        currency,
                      )}
                    </span>
                  </div>
                  {line.options.length > 0 ? (
                    <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{line.options.map((o) => o.choiceName).join(", ")}</p>
                  ) : null}
                  {line.lineNote ? <p className="mt-0.5 text-xs italic text-[var(--color-ink-muted)]">&ldquo;{line.lineNote}&rdquo;</p> : null}
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1 rounded-lg bg-[var(--color-surface-sunken)] p-0.5">
                      <button
                        type="button"
                        onClick={() => updateQuantity(line.lineId, line.quantity - 1)}
                        aria-label={`Decrease quantity of ${line.name}`}
                        className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-ink)] transition-transform active:scale-95"
                      >
                        <MinusIcon />
                      </button>
                      <span className="w-6 text-center text-sm font-semibold tabular-nums text-[var(--color-ink)]" aria-live="polite">
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(line.lineId, line.quantity + 1)}
                        aria-label={`Increase quantity of ${line.name}`}
                        className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-ink)] transition-transform active:scale-95"
                      >
                        <PlusIcon />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(line.lineId)}
                      aria-label={`Remove ${line.name} from cart`}
                      className="flex h-9 min-w-9 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/10"
                    >
                      <TrashIcon />
                      Remove
                    </button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>

        <Card className="mt-4 p-4">
          <label htmlFor="order-note" className="mb-1.5 block text-sm font-bold text-[var(--color-ink)]">
            Note for the whole order (optional)
          </label>
          <textarea
            id="order-note"
            defaultValue={cart.customerNote ?? ""}
            onBlur={(e) => setCustomerNote(e.target.value)}
            maxLength={500}
            rows={2}
            className="w-full resize-none rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface-sunken)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[var(--color-primary)] focus:bg-[var(--color-surface)] focus:outline-none"
          />
        </Card>

        <Card className="mt-4 flex flex-col gap-1.5 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-ink-muted)]">Subtotal</span>
            <span className="font-semibold tabular-nums text-[var(--color-ink)]">{money(subtotalCents, currency)}</span>
          </div>
          <p className="text-xs text-[var(--color-ink-muted)]">Tax and service charge are added at checkout.</p>
        </Card>

        {error ? (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning)]">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-warning)]" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>

      <StickyBar offsetClassName="bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]" className="mb-2">
        <div className="rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-surface)]/95 p-3 shadow-[0_-8px_24px_-4px_rgba(18,28,42,0.12)] backdrop-blur-xl">
          <Button
            variant="primary"
            disabled={isPending || !orderingEnabled}
            onClick={handleSubmit}
            className="flex h-[52px] w-full items-center justify-between px-5 text-base"
          >
            <span>{isPending ? "Placing order…" : "Place order"}</span>
            <span className="tabular-nums">{money(subtotalCents, currency)}</span>
          </Button>
        </div>
      </StickyBar>

      <CustomerBottomNav tableId={cart.tableId} />
    </div>
  );
}
