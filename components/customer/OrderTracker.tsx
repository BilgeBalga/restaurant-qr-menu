"use client";

import { useCallback, useEffect, useState } from "react";
import { getOrderByToken, type OrderTrackingView } from "@/app/actions/orders";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { OrderStatus } from "@/lib/business/orderStateMachine";

const STEPS: OrderStatus[] = ["new", "preparing", "ready", "completed"];
const STEP_LABEL: Record<OrderStatus, string> = {
  new: "Received",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

/**
 * §16: subscribes to the Broadcast channel `order-<access_token>` —
 * public (no RLS check), authorized purely because the token itself is
 * the capability (§12's pattern) and this page is the only place it's
 * ever displayed. Treated as an invalidation signal, not the payload of
 * record — every event triggers a real refetch via get_order_by_token,
 * so a missed or duplicate broadcast is harmless. Falls back to a 15s
 * poll whenever the channel isn't actively subscribed.
 */
export function OrderTracker({ accessToken, initialOrder }: { accessToken: string; initialOrder: OrderTrackingView }) {
  const [order, setOrder] = useState(initialOrder);
  const currency = order.currency;
  const [connectionState, setConnectionState] = useState<"connected" | "reconnecting">("connected");

  const refetch = useCallback(async () => {
    const result = await getOrderByToken(accessToken);
    if (result.ok) setOrder(result.data);
  }, [accessToken]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`order-${accessToken}`)
      .on("broadcast", { event: "order_status_changed" }, () => {
        void refetch();
      })
      .subscribe((status) => {
        setConnectionState(status === "SUBSCRIBED" ? "connected" : "reconnecting");
      });

    let pollId: ReturnType<typeof setInterval> | null = null;
    const watchdog = setInterval(() => {
      setConnectionState((current) => {
        if (current === "reconnecting" && !pollId) pollId = setInterval(() => void refetch(), 15_000);
        if (current === "connected" && pollId) {
          clearInterval(pollId);
          pollId = null;
        }
        return current;
      });
    }, 5_000);

    return () => {
      clearInterval(watchdog);
      if (pollId) clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [accessToken, refetch]);

  const isCancelled = order.status === "cancelled";
  const currentStepIndex = STEPS.indexOf(order.status);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-bronze-strong)]">Table {order.tableLabel}</p>
      <h1 className="font-display text-2xl font-semibold">Order #{order.orderNumber}</h1>

      {connectionState === "reconnecting" ? (
        <p className="mt-2 text-xs text-amber-800">Reconnecting live updates — checking every 15s in the meantime.</p>
      ) : null}

      {isCancelled ? (
        <p className="mt-4 rounded-md bg-red-50 px-4 py-3 text-red-800">This order was cancelled.</p>
      ) : (
        <ol className="mt-6 flex justify-between">
          {STEPS.map((step, i) => (
            <li key={step} className="flex flex-1 flex-col items-center text-center">
              <div
                className={`h-3 w-3 rounded-full ${i <= currentStepIndex ? "bg-[var(--color-bronze)]" : "bg-[var(--color-border)]"}`}
              />
              <span className={`mt-2 text-xs ${i <= currentStepIndex ? "font-medium text-[var(--color-charcoal)]" : "text-[var(--color-charcoal-muted)]"}`}>
                {STEP_LABEL[step]}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)] p-5">
        <h2 className="mb-3 font-semibold">Items</h2>
        <ul className="space-y-2 text-sm">
          {order.items.map((item, i) => (
            <li key={i}>
              <div className="flex justify-between">
                <span>
                  {item.quantity}× {item.name}
                </span>
              </div>
              {item.options.length > 0 ? (
                <p className="text-xs text-[var(--color-charcoal-muted)]">{item.options.map((o) => o.choice).join(", ")}</p>
              ) : null}
              {item.lineNote ? <p className="text-xs italic text-[var(--color-charcoal-muted)]">&ldquo;{item.lineNote}&rdquo;</p> : null}
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1 border-t border-[var(--color-border)] pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--color-charcoal-muted)]">Subtotal</dt>
            <dd className="tabular-nums">{money(order.subtotalCents, currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-charcoal-muted)]">Tax</dt>
            <dd className="tabular-nums">{money(order.taxCents, currency)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-charcoal-muted)]">Service charge</dt>
            <dd className="tabular-nums">{money(order.serviceChargeCents, currency)}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(order.totalCents, currency)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
