import Link from "next/link";
import { listAuditLog, type AuditLogRow } from "@/app/actions/audit";
import { requireAdminMembership } from "@/lib/auth/session";
import type { AuditLogFiltersInput } from "@/lib/validation/audit";

// Filter/pagination state lives entirely in the URL — never statically cached (§10, same reasoning as every other staff screen).
export const dynamic = "force-dynamic";

const RANGE_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
] as const;

const selectClass =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-ivory)] px-3 py-2 text-sm focus:border-[var(--color-bronze)] focus:outline-none";
const labelClass = "text-xs font-medium uppercase tracking-wide text-[var(--color-charcoal-muted)]";

/** Builds a `/staff/audit?...` href from the current filters plus any overrides (used by pagination links). */
function auditHref(current: AuditLogFiltersInput, overrides: Partial<AuditLogFiltersInput>): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  if (merged.range && merged.range !== "all") params.set("range", merged.range);
  if (merged.action) params.set("action", merged.action);
  if (merged.entityType) params.set("entityType", merged.entityType);
  if (merged.actorStaffId) params.set("actorStaffId", merged.actorStaffId);
  if (merged.page && String(merged.page) !== "1") params.set("page", String(merged.page));
  const qs = params.toString();
  return qs ? `/staff/audit?${qs}` : "/staff/audit";
}

/** actor_staff_id is null only for a genuinely deleted staff_users row (ON DELETE SET NULL) — never for a merely deactivated membership, whose staff_users row (and email) always stays around. */
function actorLabel(row: AuditLogRow): string {
  if (!row.actorEmail) return "System";
  return row.actorFullName && row.actorFullName.trim() ? `${row.actorFullName} (${row.actorEmail})` : row.actorEmail;
}

export default async function StaffAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<AuditLogFiltersInput>;
}) {
  // Belt-and-suspenders with the RPC-independent RLS/action-layer checks:
  // redirects a non-admin away before this page ever reads a row.
  await requireAdminMembership();

  const query = await searchParams;
  const result = await listAuditLog(query);

  if (!result.ok) {
    return <p className="text-sm text-red-700">{result.message}</p>;
  }

  const { logs, actorOptions, page, totalCount, totalPages } = result.data;

  return (
    <div>
      <h1 className="mb-4 font-display text-2xl font-semibold">Audit Log</h1>

      <form
        method="GET"
        className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)] p-4 sm:grid-cols-4 sm:items-end"
      >
        <div className="space-y-1">
          <label htmlFor="audit-range" className={labelClass}>
            Date range
          </label>
          <select id="audit-range" name="range" defaultValue={query.range ?? "all"} className={selectClass}>
            {RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="audit-actor" className={labelClass}>
            Staff member
          </label>
          <select id="audit-actor" name="actorStaffId" defaultValue={query.actorStaffId ?? ""} className={selectClass}>
            <option value="">Everyone</option>
            {actorOptions.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.fullName.trim() ? `${actor.fullName} (${actor.email})` : actor.email}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="audit-action" className={labelClass}>
            Action contains
          </label>
          <input
            id="audit-action"
            name="action"
            type="text"
            defaultValue={query.action ?? ""}
            placeholder="e.g. menu, staff, table.qr"
            className={selectClass}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="audit-entity-type" className={labelClass}>
            Entity contains
          </label>
          <input
            id="audit-entity-type"
            name="entityType"
            type="text"
            defaultValue={query.entityType ?? ""}
            placeholder="e.g. menu_items, tables"
            className={selectClass}
          />
        </div>

        <div className="col-span-2 flex gap-2 sm:col-span-4">
          <button
            type="submit"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-charcoal)] px-4 py-2 text-sm font-medium text-[var(--color-ivory)] hover:opacity-90"
          >
            Filter
          </button>
          <Link
            href="/staff/audit"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-ivory)]"
          >
            Clear
          </Link>
        </div>
      </form>

      {logs.length === 0 ? (
        <p className="text-sm text-[var(--color-charcoal-muted)]">No audit events match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-charcoal-muted)]">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Staff member</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Entity</th>
                <th className="px-4 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((entry) => (
                <tr key={entry.id} className="border-b border-[var(--color-border)] align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-[var(--color-charcoal-muted)]">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">{actorLabel(entry)}</td>
                  <td className="px-4 py-3 font-mono text-xs">{entry.action}</td>
                  <td className="px-4 py-3">
                    <div>{entry.entityType}</div>
                    <div className="font-mono text-xs text-[var(--color-charcoal-muted)]" title={entry.entityId}>
                      {entry.entityId.slice(0, 8)}…
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {entry.previousValue || entry.newValue ? (
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-[var(--color-bronze-strong)]">View</summary>
                        <pre className="mt-2 max-w-xs overflow-x-auto whitespace-pre-wrap break-words rounded bg-[var(--color-ivory)] p-2 text-xs">
                          {JSON.stringify({ previous: entry.previousValue, new: entry.newValue }, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      <span className="text-xs text-[var(--color-charcoal-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalCount > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--color-charcoal-muted)]">
          <span>
            Page {page} of {totalPages} &middot; {totalCount} event{totalCount === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <Link
              href={auditHref(query, { page: Math.max(1, page - 1) })}
              aria-disabled={page <= 1}
              className={`rounded-md border border-[var(--color-border)] px-3 py-1.5 ${
                page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-[var(--color-ivory)]"
              }`}
            >
              Previous
            </Link>
            <Link
              href={auditHref(query, { page: Math.min(totalPages, page + 1) })}
              aria-disabled={page >= totalPages}
              className={`rounded-md border border-[var(--color-border)] px-3 py-1.5 ${
                page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-[var(--color-ivory)]"
              }`}
            >
              Next
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
