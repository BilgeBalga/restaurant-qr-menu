"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { listActiveOrders, setOrderStatus, type OrderCardView } from "@/app/actions/orders";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getAllowedTransitions, type OrderStatus, type StaffRole } from "@/lib/business/orderStateMachine";

const COLUMNS: { status: OrderStatus; label: string }[] = [
  { status: "new", label: "New" },
  { status: "preparing", label: "Preparing" },
  { status: "ready", label: "Ready" },
];

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "New",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

function useElapsedTicker() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
}

function elapsedMinutes(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000);
}

function urgencyClass(status: OrderStatus, createdAt: string): string {
  if (status === "ready") return "border-l-4 border-l-[var(--color-bronze)]";
  const minutes = elapsedMinutes(createdAt);
  if (minutes >= 20) return "border-l-4 border-l-red-500";
  if (minutes >= 12) return "border-l-4 border-l-amber-500";
  return "border-l-4 border-l-transparent";
}

interface OrderCardProps {
  order: OrderCardView;
  role: StaffRole;
  onChanged: () => void;
}

function OrderCard({ order, role, onChanged }: OrderCardProps) {
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const allowed = getAllowedTransitions(order.status, role);

  function move(next: OrderStatus) {
    setActionError(null);
    startTransition(async () => {
      const result = await setOrderStatus({ orderId: order.id, status: next });
      if (!result.ok) {
        setActionError(result.message);
        return;
      }
      onChanged();
    });
  }

  return (
    <div className={`rounded-lg bg-[var(--color-ivory-raised)] p-4 shadow-sm ${urgencyClass(order.status, order.createdAt)}`}>
      <div className="flex items-baseline justify-between gap-2">
        <Link href={`/staff/orders/${order.id}`} className="font-semibold hover:underline">
          #{order.orderNumber}
        </Link>
        <span className="text-xs text-[var(--color-charcoal-muted)]">{elapsedMinutes(order.createdAt)}m ago</span>
      </div>
      <div className="text-sm text-[var(--color-charcoal-muted)]">Table {order.tableLabel}</div>
      <ul className="mt-2 space-y-0.5 text-sm">
        {order.items.map((item, i) => (
          <li key={i}>
            {item.quantity}× {item.name}
            {item.lineNote ? <span className="text-[var(--color-charcoal-muted)]"> — {item.lineNote}</span> : null}
          </li>
        ))}
      </ul>
      {order.customerNote ? (
        <p className="mt-2 rounded bg-[var(--color-ivory)] px-2 py-1 text-xs italic text-[var(--color-charcoal-muted)]">
          &ldquo;{order.customerNote}&rdquo;
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {allowed.map((next) => (
          <button
            key={next}
            type="button"
            disabled={isPending}
            onClick={() => move(next)}
            className="rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium hover:bg-[var(--color-ivory)] disabled:opacity-50"
          >
            {next === "cancelled" ? "Cancel" : `Mark ${STATUS_LABEL[next]}`}
          </button>
        ))}
      </div>
      {actionError ? <p className="mt-2 text-xs text-red-700">{actionError}</p> : null}
    </div>
  );
}

/**
 * §16: Supabase Realtime Postgres Changes on `orders`, RLS-scoped
 * automatically for the authenticated role — no separate realtime
 * permission system. Realtime is treated as an invalidation signal
 * ("something changed, go refetch"), never the payload of record — this
 * makes duplicate/out-of-order events harmless and means a payload
 * missing joined table/item data is never a problem. Falls back to a
 * 15s poll only while the channel is actually disconnected (§16
 * reliability table), not as a permanent parallel mechanism.
 */
export function OrdersBoard({
  initialOrders,
  restaurantId,
  role,
}: {
  initialOrders: OrderCardView[];
  restaurantId: string;
  role: StaffRole;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [connectionState, setConnectionState] = useState<"connected" | "reconnecting">("connected");
  const [loadError, setLoadError] = useState<string | null>(null);
  useElapsedTicker();

  const refetch = useCallback(async () => {
    const result = await listActiveOrders();
    if (result.ok) {
      setOrders(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.message);
    }
  }, []);

  // A new-order chime is part of §16's design but no audio asset exists in
  // this repo yet — tracked as a known limitation rather than faked here.
  const previousIds = useRef(new Set(initialOrders.map((o) => o.id)));
  const [hasUnseenNew, setHasUnseenNew] = useState(false);

  useEffect(() => {
    const newlyArrived = orders.some((o) => o.status === "new" && !previousIds.current.has(o.id));
    if (newlyArrived) setHasUnseenNew(true);
    previousIds.current = new Set(orders.map((o) => o.id));
  }, [orders]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`staff-orders-${restaurantId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` },
        () => {
          void refetch();
        },
      )
      .subscribe((status) => {
        setConnectionState(status === "SUBSCRIBED" ? "connected" : "reconnecting");
      });

    let pollId: ReturnType<typeof setInterval> | null = null;
    const watchdog = setInterval(() => {
      setConnectionState((current) => {
        if (current === "reconnecting" && !pollId) {
          pollId = setInterval(() => void refetch(), 15_000);
        }
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
  }, [restaurantId, refetch]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold">
          Orders
          {hasUnseenNew ? (
            <button
              type="button"
              onClick={() => setHasUnseenNew(false)}
              className="h-2.5 w-2.5 rounded-full bg-[var(--color-bronze)]"
              aria-label="New order arrived"
              title="New order arrived"
            />
          ) : null}
        </h1>
        {connectionState === "reconnecting" ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            Reconnecting… showing last known state, refreshing every 15s
          </span>
        ) : null}
      </div>
      {loadError ? <p className="mb-4 text-sm text-red-700">{loadError}</p> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        {COLUMNS.map((column) => {
          const columnOrders = orders.filter((o) => o.status === column.status);
          return (
            <div key={column.status} className="rounded-lg bg-[var(--color-surface-alt,transparent)] p-2">
              <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-charcoal-muted)]">
                {column.label}
                <span className="rounded-full bg-[var(--color-border)] px-2 text-xs font-normal text-[var(--color-charcoal)]">
                  {columnOrders.length}
                </span>
              </h2>
              <div className="flex flex-col gap-3">
                {columnOrders.length === 0 ? (
                  <p className="px-1 text-sm text-[var(--color-charcoal-muted)]">Nothing here.</p>
                ) : (
                  columnOrders.map((order) => <OrderCard key={order.id} order={order} role={role} onChanged={refetch} />)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
