import { notFound } from "next/navigation";
import { getMenuItemById } from "@/app/actions/menu";
import { resolveCurrentTable } from "@/lib/customer/resolveTableContext";
import { TableUnavailable } from "@/components/customer/TableUnavailable";
import { CartProvider } from "@/components/customer/CartProvider";
import { ItemDetail } from "@/components/customer/ItemDetail";

export const dynamic = "force-dynamic";

export default async function MenuItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<{ table?: string }>;
}) {
  const { itemId } = await params;
  const { table } = await searchParams;
  const context = await resolveCurrentTable(table);

  if (!context) {
    return <TableUnavailable />;
  }

  // Scoped to context.restaurantId (server-resolved, never client-supplied) — can't fetch another restaurant's item.
  const itemResult = await getMenuItemById(context.restaurantId, itemId);
  if (!itemResult.ok) {
    notFound();
  }

  return (
    <CartProvider tableId={context.tableId}>
      <ItemDetail item={itemResult.data} currency={context.currency} tableId={context.tableId} />
    </CartProvider>
  );
}
