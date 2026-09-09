/**
 * Real QR landing route per §12 — but table-token resolution needs the
 * Phase 2 schema (table_qr_tokens) and doesn't exist yet. This is an
 * honest placeholder, not a stand-in that pretends to work: it proves the
 * route/param wiring, and nothing more, until Phase 2 (schema) and Phase 4
 * (customer menu) land.
 */
export default async function TableEntryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold">Table lookup coming soon</h1>
      <p className="max-w-md text-[var(--color-charcoal-muted)]">
        This is the QR landing route for token <code className="font-mono text-sm">{token}</code>. Table
        and menu resolution ship in Phase 2 (database) and Phase 4 (customer menu).
      </p>
    </main>
  );
}
