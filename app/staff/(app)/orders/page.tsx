import { listActiveOrders } from "@/app/actions/orders";
import { requireActiveMembership } from "@/lib/auth/session";
import { OrdersBoard } from "@/components/staff/OrdersBoard";

export default async function StaffOrdersPage() {
  const membership = await requireActiveMembership();
  const result = await listActiveOrders();

  if (!result.ok) {
    return <p className="text-sm text-red-700">{result.message}</p>;
  }

  return <OrdersBoard initialOrders={result.data} restaurantId={membership.restaurantId} role={membership.role} />;
}
