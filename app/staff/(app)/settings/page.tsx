import { getRestaurantSettings } from "@/app/actions/settings";
import { requireAdminMembership } from "@/lib/auth/session";
import { SettingsForm } from "@/components/staff/SettingsForm";

/**
 * Admin-only (§11 settings:write) — requireAdminMembership() redirects
 * anyone else to /staff/dashboard?error=forbidden before this ever reads
 * a row, on top of the RLS UPDATE policies that would independently
 * reject a non-admin write regardless.
 */
export default async function StaffSettingsPage() {
  await requireAdminMembership();
  const result = await getRestaurantSettings();

  if (!result.ok) {
    return <p className="text-sm text-red-700">{result.message}</p>;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 font-display text-2xl font-semibold">Restaurant settings</h1>
      <p className="mb-6 text-sm text-[var(--color-charcoal-muted)]">
        Changes here affect the customer menu, checkout, and this dashboard immediately.
      </p>
      <SettingsForm initial={result.data} />
    </div>
  );
}
