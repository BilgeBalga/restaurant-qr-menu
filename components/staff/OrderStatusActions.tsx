"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOrderStatus } from "@/app/actions/orders";
import { getAllowedTransitions, type OrderStatus, type StaffRole } from "@/lib/business/orderStateMachine";

const STATUS_LABEL: Record<OrderStatus, string> = {
  new: "New",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function OrderStatusActions({ orderId, status, role }: { orderId: string; status: OrderStatus; role: StaffRole }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const allowed = getAllowedTransitions(status, role);

  if (allowed.length === 0) {
    return <p className="text-sm text-[var(--color-charcoal-muted)]">This order is in a final state.</p>;
  }

  function move(next: OrderStatus) {
    setError(null);
    startTransition(async () => {
      const result = await setOrderStatus({ orderId, status: next });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {allowed.map((next) => (
          <button
            key={next}
            type="button"
            disabled={isPending}
            onClick={() => move(next)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-ivory-raised)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-ivory)] disabled:opacity-50"
          >
            {next === "cancelled" ? "Cancel order" : `Mark ${STATUS_LABEL[next]}`}
          </button>
        ))}
      </div>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
