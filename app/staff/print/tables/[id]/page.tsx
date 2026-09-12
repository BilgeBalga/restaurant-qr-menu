import { notFound } from "next/navigation";
import { requireActiveMembership } from "@/lib/auth/session";
import { can } from "@/lib/business/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTableQrForDisplay } from "@/app/actions/tablesAdmin";
import { PrintButton } from "@/components/staff/PrintButton";

/**
 * Deliberately sits outside app/staff/(app) — it inherits only the bare
 * app/staff/layout.tsx (background + font, no nav/header/sign-out), so
 * printing this page never drags the staff dashboard chrome along with
 * it. Admin-only: table_qr_tokens has a single admin-only RLS policy
 * with no staff-select policy at all, so a non-admin literally cannot
 * read a table's QR token regardless of what this page does — the
 * can() check below just turns that into a clear message instead of a
 * silent "no QR found."
 */
export default async function TableQrPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const membership = await requireActiveMembership();

  if (!can(membership.role, "tables:write")) {
    return <p className="p-6 text-sm text-red-700">You don&apos;t have permission to view this table&apos;s QR code.</p>;
  }

  const supabase = await createSupabaseServerClient();
  const { data: table } = await supabase
    .from("tables")
    .select("id, label")
    .eq("id", id)
    .eq("restaurant_id", membership.restaurantId)
    .maybeSingle();
  if (!table) notFound();

  const qrResult = await getTableQrForDisplay({ tableId: id });
  if (!qrResult.ok || !qrResult.data) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-700">
          This table doesn&apos;t have an active QR code. Generate one from the Tables page first.
        </p>
      </div>
    );
  }

  return (
    <>
      <style>{"@page { margin: 2cm; } @media print { html, body { background: #fff; } }"}</style>
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 py-16 text-center print:min-h-0 print:gap-8 print:py-0">
        <div className="print:hidden">
          <PrintButton />
        </div>
        <p className="text-sm font-medium uppercase tracking-wide text-[var(--color-bronze-strong)]">{membership.restaurantName}</p>
        <h1 className="font-display text-3xl font-semibold">Table {table.label}</h1>
        <div
          className="rounded-lg border border-[var(--color-border)] bg-white p-8"
          dangerouslySetInnerHTML={{ __html: qrResult.data.qrSvg }}
        />
        <p className="text-sm text-[var(--color-charcoal-muted)]">Scan to view the menu and order</p>
      </div>
    </>
  );
}
