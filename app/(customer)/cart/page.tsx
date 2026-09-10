import { resolveCurrentTable } from "@/lib/customer/resolveTableContext";
import { TableUnavailable } from "@/components/customer/TableUnavailable";
import { CartProvider } from "@/components/customer/CartProvider";
import { CartView } from "@/components/customer/CartView";

export const dynamic = "force-dynamic";

export default async function CartPage({ searchParams }: { searchParams: Promise<{ table?: string }> }) {
  const { table } = await searchParams;
  const context = await resolveCurrentTable(table);

  if (!context) {
    return <TableUnavailable />;
  }

  return (
    <CartProvider tableId={context.tableId}>
      <CartView currency={context.currency} orderingEnabled={context.orderingEnabled} />
    </CartProvider>
  );
}
