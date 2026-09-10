import { notFound } from "next/navigation";
import { getOrderByToken } from "@/app/actions/orders";
import { OrderTracker } from "@/components/customer/OrderTracker";

// The access token is the only authorization — never statically cached (§13/§16).
export const dynamic = "force-dynamic";

export default async function OrderTrackingPage({ params }: { params: Promise<{ accessToken: string }> }) {
  const { accessToken } = await params;
  const result = await getOrderByToken(accessToken);

  if (!result.ok) {
    notFound();
  }

  return <OrderTracker accessToken={accessToken} initialOrder={result.data} />;
}
