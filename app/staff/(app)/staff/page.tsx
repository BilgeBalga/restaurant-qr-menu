import { listStaffMembers } from "@/app/actions/staffAdmin";
import { requireAdminMembership } from "@/lib/auth/session";
import { StaffManager } from "@/components/staff/StaffManager";

/**
 * Admin-only (§11 staff:manage) — requireAdminMembership() redirects
 * anyone else to /staff/dashboard?error=forbidden before this ever reads
 * a row, on top of restaurant_staff_write_admin at the RLS layer, which
 * would independently reject a non-admin write regardless.
 */
export default async function StaffManagementPage() {
  await requireAdminMembership();
  const result = await listStaffMembers();

  if (!result.ok) {
    return <p className="text-sm text-red-700">{result.message}</p>;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <StaffManager initialMembers={result.data} />
    </div>
  );
}
