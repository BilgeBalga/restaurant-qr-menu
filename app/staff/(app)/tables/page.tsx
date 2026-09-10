import { listTableBoard } from "@/app/actions/tables";
import { TableBoard } from "@/components/staff/TableBoard";
import { requireActiveMembership } from "@/lib/auth/session";

export default async function StaffTablesPage() {
  const membership = await requireActiveMembership();
  const result = await listTableBoard();

  if (!result.ok) {
    return <p className="text-sm text-red-700">{result.message}</p>;
  }

  return <TableBoard initialTables={result.data} restaurantId={membership.restaurantId} />;
}
