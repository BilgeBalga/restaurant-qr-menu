import { getMenu } from "@/app/actions/menu";
import { resolveCurrentTable } from "@/lib/customer/resolveTableContext";
import { TableUnavailable } from "@/components/customer/TableUnavailable";
import { TableCookieSync } from "@/components/customer/TableCookieSync";
import { CartProvider } from "@/components/customer/CartProvider";
import { MenuBrowser } from "@/components/customer/MenuBrowser";

// Table-scoped and cookie-dependent — never statically cached (§10).
export const dynamic = "force-dynamic";

export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; error?: string }>;
}) {
  const { table, error } = await searchParams;
  const context = await resolveCurrentTable(table);

  if (!context) {
    return <TableUnavailable reason={error} />;
  }

  const menuResult = await getMenu(context.restaurantId);
  if (!menuResult.ok) {
    return <TableUnavailable />;
  }

  return (
    <>
      {context.freshToken ? <TableCookieSync token={context.freshToken} /> : null}
      <CartProvider tableId={context.tableId}>
        <MenuBrowser
          restaurantName={context.restaurantName}
          tableLabel={context.tableLabel}
          currency={context.currency}
          orderingEnabled={context.orderingEnabled}
          categories={menuResult.data}
        />
      </CartProvider>
    </>
  );
}
