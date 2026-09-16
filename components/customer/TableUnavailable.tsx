const MESSAGES: Record<string, { title: string; body: string }> = {
  invalid_table: {
    title: "This QR code isn't valid",
    body: "The code doesn't match any table we know about. Please ask a member of staff for help.",
  },
  table_inactive: {
    title: "This table isn't in service right now",
    body: "Please ask a member of staff to seat you at an active table.",
  },
  default: {
    title: "We couldn't find your table",
    body: "Please scan the QR code on your table to start an order.",
  },
};

/** §23 screen 11 — invalid/expired/revoked QR tokens all land here, never a broken menu. */
export function TableUnavailable({ reason }: { reason?: string }) {
  const { title, body } = MESSAGES[reason ?? "default"] ?? MESSAGES.default!;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--color-canvas)] px-6 text-center">
      <h1 className="text-2xl font-semibold text-[var(--color-ink)]">{title}</h1>
      <p className="max-w-sm text-[var(--color-ink-muted)]">{body}</p>
    </main>
  );
}
