import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrderDetail } from "@/app/actions/orders";
import { requireActiveMembership } from "@/lib/auth/session";
import { OrderStatusActions } from "@/components/staff/OrderStatusActions";
import { formatMoney } from "@/lib/format/money";

export default async function StaffOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const membership = await requireActiveMembership();
  const result = await getOrderDetail(id);

  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <p className="text-sm text-red-700">{result.message}</p>;
  }

  const order = result.data;
  const money = (cents: number) => formatMoney(cents, order.currency);
  const backHref = from === "history" ? "/staff/history" : "/staff/orders";
  const backLabel = from === "history" ? "← Back to history" : "← Back to orders";

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={backHref} className="text-sm text-[var(--color-charcoal-muted)] hover:underline">
        {backLabel}
      </Link>

      <div className="mt-3 flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-semibold">Order #{order.orderNumber}</h1>
        <span className="text-sm text-[var(--color-charcoal-muted)]">Table {order.tableLabel}</span>
      </div>

      <div className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)] p-5">
        <OrderStatusActions orderId={order.id} status={order.status} role={membership.role} />
      </div>

      <div className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)] p-5">
        <h2 className="mb-3 font-semibold">Items</h2>
        <ul className="space-y-3">
          {order.items.map((item, i) => (
            <li key={i}>
              <div className="flex justify-between text-sm">
                <span>
                  {item.quantity}× {item.name}
                </span>
              </div>
              {item.lineNote ? <p className="text-xs italic text-[var(--color-charcoal-muted)]">Note: {item.lineNote}</p> : null}
              {order.optionsByItemIndex[i]!.length > 0 ? (
                <ul className="mt-1 ml-4 text-xs text-[var(--color-charcoal-muted)]">
                  {order.optionsByItemIndex[i]!.map((opt, j) => (
                    <li key={j}>
                      {opt.group}: {opt.choice}
                      {opt.priceDeltaCents !== 0 ? ` (${opt.priceDeltaCents > 0 ? "+" : ""}${money(opt.priceDeltaCents)})` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        {order.customerNote ? (
          <p className="mt-4 rounded bg-[var(--color-ivory)] px-3 py-2 text-sm italic">&ldquo;{order.customerNote}&rdquo;</p>
        ) : null}
        <dl className="mt-4 space-y-1 border-t border-[var(--color-border)] pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--color-charcoal-muted)]">Subtotal</dt>
            <dd>{money(order.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-charcoal-muted)]">Tax</dt>
            <dd>{money(order.taxCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-charcoal-muted)]">Service charge</dt>
            <dd>{money(order.serviceChargeCents)}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>Total</dt>
            <dd>{money(order.totalCents)}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)] p-5">
        <h2 className="mb-3 font-semibold">Status timeline</h2>
        <ol className="space-y-2 text-sm">
          {order.statusHistory.map((entry, i) => (
            <li key={i} className="flex justify-between">
              <span>
                {entry.previousStatus ? `${entry.previousStatus} → ${entry.newStatus}` : `Created (${entry.newStatus})`}
              </span>
              <span className="text-[var(--color-charcoal-muted)]">{new Date(entry.createdAt).toLocaleTimeString()}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
