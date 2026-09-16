"use client";

import { useCallback, useEffect, useState } from "react";
import { getOrderByToken, type OrderTrackingView } from "@/app/actions/orders";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { startPollFallback } from "@/lib/realtime/pollFallback";
import type { OrderStatus } from "@/lib/business/orderStateMachine";
import { formatMoney as money } from "@/lib/format/money";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { CustomerBottomNav } from "@/components/customer/CustomerBottomNav";

const STEPS: OrderStatus[] = ["new", "preparing", "ready", "completed"];

const STEP_LABEL: Record<OrderStatus, string> = {
  new: "Order received",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Served",
  cancelled: "Cancelled",
};

const STEP_DESCRIPTION: Record<OrderStatus, string> = {
  new: "Sent straight to the kitchen.",
  preparing: "The kitchen is preparing your order.",
  ready: "Ready — on its way to your table.",
  completed: "Enjoy your meal!",
  cancelled: "",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The real timestamp a step was reached, straight from already-returned backend data — never fabricated (e.g. no invented ETA countdown). "new" comes from the order row itself; every later step comes from its transition in statusHistory (set_order_status writes one row per transition). */
function timestampForStep(order: OrderTrackingView, step: OrderStatus): string | null {
  if (step === "new") return order.createdAt;
  const matches = order.statusHistory.filter((h) => h.newStatus === step);
  return matches.length > 0 ? matches[matches.length - 1]!.createdAt : null;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * §16: subscribes to the Broadcast channel `order-<access_token>` —
 * public (no RLS check), authorized purely because the token itself is
 * the capability (§12's pattern) and this page is the only place it's
 * ever displayed. Treated as an invalidation signal, not the payload of
 * record — every event triggers a real refetch via get_order_by_token,
 * so a missed or duplicate broadcast is harmless. Reconnect handling
 * reuses lib/realtime/pollFallback.ts (the same watchdog/poll pattern
 * already proven by TableBoard/OrdersBoard) instead of the bespoke inline
 * version this component used before Stage 2 — same behavior, one fewer
 * copy of the logic — plus an explicit refetch the moment the channel
 * reconnects, so a status change that landed during a drop surfaces
 * immediately rather than waiting for the next poll tick.
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
    let wasConnected = true;

    const fallback = startPollFallback({ onPoll: () => void refetch() });

    const channel = supabase
      .channel(`order-${accessToken}`)
      .on("broadcast", { event: "order_status_changed" }, () => {
        void refetch();
      })
      .subscribe((status) => {
        const isConnected = status === "SUBSCRIBED";
        fallback.setConnected(isConnected);
        setConnectionState(isConnected ? "connected" : "reconnecting");
        if (isConnected && !wasConnected) void refetch();
        wasConnected = isConnected;
      });

    return () => {
      fallback.stop();
      supabase.removeChannel(channel);
    };
  }, [accessToken, refetch]);

  const isCancelled = order.status === "cancelled";
  const currentStepIndex = STEPS.indexOf(order.status);

  return (
    <div className="min-h-screen bg-[var(--color-canvas)]">
      <div className="mx-auto w-full max-w-[480px] px-4 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] pt-6">
        <header className="mb-4 flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Table {order.tableLabel}</p>
            <h1 className="mt-0.5 text-2xl font-bold text-[var(--color-ink)]">Order #{order.orderNumber}</h1>
          </div>
          {connectionState === "reconnecting" ? (
            <Chip tone="warning" className="mt-1 shrink-0">
              Reconnecting…
            </Chip>
          ) : null}
        </header>

        {isCancelled ? (
          <Card className="mb-4 flex items-center gap-3 border-[var(--color-muted-border)] bg-[var(--color-muted-bg)] p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-muted)] text-white">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <p className="font-semibold text-[var(--color-ink)]">This order was cancelled</p>
              <p className="text-sm text-[var(--color-ink-muted)]">Please speak to a member of staff if you have questions.</p>
            </div>
          </Card>
        ) : (
          <Card className="mb-4 flex flex-col p-4">
            {STEPS.map((step, i) => {
              const done = i <= currentStepIndex;
              const current = i === currentStepIndex;
              const timestamp = timestampForStep(order, step);
              const isLast = i === STEPS.length - 1;
              return (
                <div key={step} className="relative flex gap-3">
                  {!isLast ? (
                    <span
                      className={`absolute left-[13px] top-7 h-full w-0.5 ${done ? "bg-[var(--color-success)]" : "bg-[var(--color-hairline)]"}`}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span
                    className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                      done
                        ? "bg-[var(--color-success)] text-white"
                        : current
                          ? "bg-[var(--color-primary)] text-white"
                          : "bg-[var(--color-surface-sunken)] text-[var(--color-ink-muted)]"
                    }`}
                  >
                    {done ? <CheckIcon /> : <span className="h-2 w-2 rounded-full bg-current" />}
                  </span>
                  <div className={`flex flex-1 flex-col ${isLast ? "pb-0" : "pb-6"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm font-bold ${done || current ? "text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}`}>
                        {STEP_LABEL[step]}
                      </span>
                      {timestamp ? (
                        <span className="text-xs tabular-nums text-[var(--color-ink-muted)]">{formatTime(timestamp)}</span>
                      ) : null}
                    </div>
                    <span className="text-xs text-[var(--color-ink-muted)]">{STEP_DESCRIPTION[step]}</span>
                  </div>
                </div>
              );
            })}
          </Card>
        )}

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-bold text-[var(--color-ink)]">Items</h2>
          <ul className="flex flex-col gap-2.5 text-sm">
            {order.items.map((item, i) => (
              <li key={i} className="flex flex-col">
                <div className="flex justify-between gap-2">
                  <span className="text-[var(--color-ink)]">
                    {item.quantity}× {item.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-[var(--color-ink-muted)]">
                    {money((item.unitPriceCents + item.options.reduce((s, o) => s + o.priceDeltaCents, 0)) * item.quantity, currency)}
                  </span>
                </div>
                {item.options.length > 0 ? (
                  <p className="text-xs text-[var(--color-ink-muted)]">{item.options.map((o) => o.choice).join(", ")}</p>
                ) : null}
                {item.lineNote ? <p className="text-xs italic text-[var(--color-ink-muted)]">&ldquo;{item.lineNote}&rdquo;</p> : null}
              </li>
            ))}
          </ul>
          {order.customerNote ? (
            <p className="mt-3 rounded-lg bg-[var(--color-surface-sunken)] px-3 py-2 text-xs italic text-[var(--color-ink-muted)]">
              &ldquo;{order.customerNote}&rdquo;
            </p>
          ) : null}
          <dl className="mt-4 flex flex-col gap-1.5 border-t border-[var(--color-hairline)] pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--color-ink-muted)]">Subtotal</dt>
              <dd className="tabular-nums text-[var(--color-ink)]">{money(order.subtotalCents, currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--color-ink-muted)]">Tax</dt>
              <dd className="tabular-nums text-[var(--color-ink)]">{money(order.taxCents, currency)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--color-ink-muted)]">Service charge</dt>
              <dd className="tabular-nums text-[var(--color-ink)]">{money(order.serviceChargeCents, currency)}</dd>
            </div>
            <div className="flex justify-between pt-1 text-base font-bold">
              <dt className="text-[var(--color-ink)]">Total</dt>
              <dd className="tabular-nums text-[var(--color-primary)]">{money(order.totalCents, currency)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <CustomerBottomNav />
    </div>
  );
}
