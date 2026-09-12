import { getAdminMenu } from "@/app/actions/menuAdmin";
import { requireActiveMembership } from "@/lib/auth/session";
import { MenuManager } from "@/components/staff/MenuManager";

/**
 * Readable by any active staff member (RLS's staff-select policies have
 * no role restriction); write operations are gated inside
 * app/actions/menuAdmin.ts per action — full edits require
 * can(role, "menu:write") (admin-only), while the availability toggle is
 * open to any active staff, mirroring the DB's own
 * enforce_menu_item_update_scope trigger. MenuManager receives `role` and
 * hides admin-only controls client-side as a UX nicety; the server
 * actions are the actual boundary regardless.
 */
export default async function StaffMenuPage() {
  const membership = await requireActiveMembership();
  const result = await getAdminMenu();

  if (!result.ok) {
    return <p className="text-sm text-red-700">{result.message}</p>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 font-display text-2xl font-semibold">Menu</h1>
      <p className="mb-6 text-sm text-[var(--color-charcoal-muted)]">Changes here are reflected on the customer menu immediately.</p>
      <MenuManager initial={result.data} role={membership.role} />
    </div>
  );
}
