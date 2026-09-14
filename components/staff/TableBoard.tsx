"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { listTableBoard, type TableBoardRow } from "@/app/actions/tables";
import { clearTable } from "@/app/actions/orders";
import {
  createTable,
  deleteTable,
  generateTableQrToken,
  getTableQrForDisplay,
  revokeTableQrToken,
  updateTable,
  type TableQrView,
} from "@/app/actions/tablesAdmin";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { startPollFallback } from "@/lib/realtime/pollFallback";
import type { TableStatus } from "@/lib/business/tableStatus";
import type { StaffRole } from "@/lib/business/orderStateMachine";
import { DownloadSvgButton } from "@/components/staff/DownloadSvgButton";

const STATUS_STYLE: Record<TableStatus, string> = {
  available: "bg-[var(--color-ivory-raised)] text-[var(--color-charcoal-muted)]",
  ordering: "bg-blue-50 text-blue-800",
  preparing: "bg-amber-50 text-amber-800",
  needs_attention: "bg-red-50 text-red-800",
};

const STATUS_LABEL: Record<TableStatus, string> = {
  available: "Available",
  ordering: "Ordering",
  preparing: "Preparing",
  needs_attention: "Needs attention",
};

const inputClass =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-ivory)] px-3 py-2 text-sm focus:border-[var(--color-bronze)] focus:outline-none";
const smallButtonClass = "rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-ivory)] disabled:opacity-40";

/** §18: table status is derived server-side (listTableBoard); this component just re-fetches on any relevant realtime change. */
export function TableBoard({
  initialTables,
  restaurantId,
  role,
}: {
  initialTables: TableBoardRow[];
  restaurantId: string;
  role: StaffRole;
}) {
  const isAdmin = role === "admin";
  const [tables, setTables] = useState(initialTables);
  const [managingTableId, setManagingTableId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [connectionState, setConnectionState] = useState<"connected" | "reconnecting">("connected");

  // Guards refetch() against setting state after unmount — refetch can be
  // triggered by a realtime event, the poll fallback, or a manual action
  // handler (handleClear, NewTableForm, TableManagePanel), any of which
  // could still be in flight when the staff member navigates away.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    const result = await listTableBoard();
    if (!mountedRef.current) return;
    if (result.ok) setTables(result.data);
  }, []);

  /**
   * §16 realtime pattern (same as OrdersBoard/OrderTracker): postgres_changes
   * on orders + table_sessions, RLS-scoped by restaurant_id, treated purely
   * as an invalidation signal — table status/active-order-count is always
   * re-derived server-side by listTableBoard, never computed here, so a
   * missed/duplicate/out-of-order event is harmless. A watchdog
   * (lib/realtime/pollFallback.ts) starts a 15s poll only while the channel
   * is actually disconnected, and — since a restaurant tablet may stay on
   * this screen for a long shift — an explicit refetch also fires the
   * moment the channel reconnects, so a change that landed during the drop
   * surfaces immediately instead of waiting for the next poll tick or the
   * next live event.
   */
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let wasConnected = true; // initial data is fresh from the server render — first SUBSCRIBED isn't a "reconnect"

    const fallback = startPollFallback({ onPoll: () => void refetch() });

    const channel = supabase
      .channel(`staff-tables-${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${restaurantId}` }, () =>
        void refetch(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "table_sessions", filter: `restaurant_id=eq.${restaurantId}` },
        () => void refetch(),
      )
      .subscribe((status) => {
        const isConnected = status === "SUBSCRIBED";
        fallback.setConnected(isConnected);
        setConnectionState(isConnected ? "connected" : "reconnecting");
        if (isConnected && !wasConnected) void refetch();
        wasConnected = isConnected;
      });

    return () => {
      fallback.stop();
      supabase.removeChannel(channel);
    };
  }, [restaurantId, refetch]);

  /**
   * §Phase 6 audit P1-1: clear_table is a manual override that closes the
   * table's open session unconditionally, even with non-terminal orders
   * still attached — intentional (§18), but the UI gave no warning about
   * that consequence, unlike every other destructive action here (delete
   * table/category/item/staff, revoke QR all confirm). Closing a session
   * with active orders still on it makes those orders drop out of this
   * board's active-order count (listTableBoard only reads the currently
   * OPEN session's orders) even though they remain fully live and
   * actionable on the separate Orders board — easy to click by accident
   * otherwise.
   */
  function handleClear(table: TableBoardRow) {
    if (table.activeOrderCount > 0) {
      const noun = table.activeOrderCount === 1 ? "order" : "orders";
      const confirmed = window.confirm(
        `Table "${table.label}" has ${table.activeOrderCount} active ${noun} that haven't been completed yet. Clear the table anyway? The order(s) will remain on the Orders board, but this table will stop showing them as active.`,
      );
      if (!confirmed) return;
    }

    startTransition(async () => {
      await clearTable(table.tableId);
      await refetch();
    });
  }

  const managingTable = tables.find((t) => t.tableId === managingTableId) ?? null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold">Tables</h1>
        {connectionState === "reconnecting" ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            Reconnecting… showing last known state, refreshing every 15s
          </span>
        ) : null}
        {isAdmin ? (
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="rounded-md bg-[var(--color-bronze)] px-3 py-1.5 text-sm font-medium text-white"
          >
            {creating ? "Cancel" : "+ New table"}
          </button>
        ) : null}
      </div>

      {isAdmin && creating ? (
        <NewTableForm
          onCreated={() => {
            setCreating(false);
            void refetch();
          }}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tables.map((table) => (
          <div
            key={table.tableId}
            className={`rounded-lg p-4 ${table.isActive ? STATUS_STYLE[table.status] : "bg-[var(--color-ivory-raised)] text-[var(--color-charcoal-muted)] opacity-70"}`}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span className={`text-lg font-semibold ${table.isActive ? "" : "italic"}`}>{table.label}</span>
              {!table.isActive ? <span className="text-xs font-medium uppercase">Inactive</span> : null}
            </div>
            <div className="text-sm">{table.isActive ? STATUS_LABEL[table.status] : "Not in service"}</div>
            {table.activeOrderCount > 0 ? <div className="text-xs">{table.activeOrderCount} active order(s)</div> : null}
            {isAdmin ? (
              <div className="mt-1 text-xs">
                {table.qr ? (
                  <span className="text-emerald-700">QR active</span>
                ) : (
                  <span className="text-[var(--color-charcoal-muted)]">No QR</span>
                )}
              </div>
            ) : null}

            <div className="mt-2 flex flex-wrap gap-1.5">
              {table.isActive && table.status !== "available" ? (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleClear(table)}
                  className="rounded border border-current px-2 py-0.5 text-xs disabled:opacity-40"
                >
                  Clear table
                </button>
              ) : null}
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => setManagingTableId(table.tableId)}
                  className="rounded border border-current px-2 py-0.5 text-xs"
                >
                  Manage
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {isAdmin && managingTable ? (
        <TableManagePanel
          table={managingTable}
          onClose={() => setManagingTableId(null)}
          onChanged={() => void refetch()}
          onDeleted={() => {
            setManagingTableId(null);
            void refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function NewTableForm({ onCreated }: { onCreated: () => void }) {
  const [label, setLabel] = useState("");
  const [seats, setSeats] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createTable({ label, seats: seats.trim() ? Number(seats) : undefined });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setLabel("");
      setSeats("");
      onCreated();
    });
  }

  return (
    <div className="mb-4 flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-[var(--color-border)] p-3">
      <div className="flex-1">
        <label className="text-xs text-[var(--color-charcoal-muted)]">Table name/number</label>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. 12" className={inputClass} />
      </div>
      <div className="w-24">
        <label className="text-xs text-[var(--color-charcoal-muted)]">Seats</label>
        <input type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} className={inputClass} />
      </div>
      <button type="button" disabled={isPending || !label.trim()} onClick={handleCreate} className={smallButtonClass}>
        Create
      </button>
      {error ? <p className="w-full text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

function TableManagePanel({
  table,
  onClose,
  onChanged,
  onDeleted,
}: {
  table: TableBoardRow;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [label, setLabel] = useState(table.label);
  const [seats, setSeats] = useState(table.seats ? String(table.seats) : "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function flash(message: string) {
    setNotice(message);
    setError(null);
  }
  function fail(message: string) {
    setError(message);
    setNotice(null);
  }

  function handleSaveDetails() {
    startTransition(async () => {
      const result = await updateTable({ id: table.tableId, label, seats: seats.trim() ? Number(seats) : null });
      if (!result.ok) {
        fail(result.message);
        return;
      }
      flash("Saved.");
      onChanged();
    });
  }

  function handleToggleActive() {
    startTransition(async () => {
      const result = await updateTable({ id: table.tableId, isActive: !table.isActive });
      if (!result.ok) {
        fail(result.message);
        return;
      }
      flash(result.data.isActive ? "Table activated." : "Table deactivated — its QR will no longer accept new orders.");
      onChanged();
    });
  }

  function handleDelete() {
    if (!window.confirm(`Delete table "${table.label}"? This can't be undone.`)) return;
    startTransition(async () => {
      const result = await deleteTable({ id: table.tableId });
      if (!result.ok) {
        fail(result.message);
        return;
      }
      onDeleted();
    });
  }

  return (
    <div className="mt-6 rounded-lg border border-[var(--color-bronze)] bg-[var(--color-ivory-raised)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Manage table {table.label}</h2>
        <button type="button" onClick={onClose} className={smallButtonClass}>
          Close
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
        <div>
          <label className="text-xs text-[var(--color-charcoal-muted)]">Name/number</label>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="text-xs text-[var(--color-charcoal-muted)]">Seats</label>
          <input type="number" min={1} value={seats} onChange={(e) => setSeats(e.target.value)} className={inputClass} />
        </div>
        <div className="flex items-end">
          <button type="button" disabled={isPending || !label.trim()} onClick={handleSaveDetails} className={smallButtonClass}>
            Save
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={isPending} onClick={handleToggleActive} className={smallButtonClass}>
          {table.isActive ? "Deactivate table" : "Activate table"}
        </button>
        <button type="button" disabled={isPending} onClick={handleDelete} className={`${smallButtonClass} text-red-700`}>
          Delete table
        </button>
      </div>
      {table.activeOrderCount > 0 ? (
        <p className="mt-2 text-xs text-[var(--color-charcoal-muted)]">
          This table has {table.activeOrderCount} active order(s). Deactivating only blocks new orders — it won&apos;t affect the current
          session.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {notice && !error ? (
        <p role="status" className="mt-3 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}

      <div className="mt-5 border-t border-[var(--color-border)] pt-4">
        <QrPanel tableId={table.tableId} tableLabel={table.label} onError={fail} onNotice={flash} />
      </div>
    </div>
  );
}

function QrPanel({
  tableId,
  tableLabel,
  onError,
  onNotice,
}: {
  tableId: string;
  tableLabel: string;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [qr, setQr] = useState<TableQrView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Refs, not deps, for onError/onNotice: they're plain closures recreated
  // every render of the parent, and this effect must fire once per
  // tableId — not on every parent re-render those closures' identity
  // changes with (which would otherwise refetch every time an error or
  // notice is shown).
  const onErrorRef = useRef(onError);
  const onNoticeRef = useRef(onNotice);
  useEffect(() => {
    onErrorRef.current = onError;
    onNoticeRef.current = onNotice;
  }, [onError, onNotice]);

  useEffect(() => {
    startTransition(async () => {
      const result = await getTableQrForDisplay({ tableId });
      if (!result.ok) {
        onErrorRef.current(result.message);
        return;
      }
      setQr(result.data);
      setLoaded(true);
    });
  }, [tableId]);

  function handleGenerateOrRotate() {
    startTransition(async () => {
      const result = await generateTableQrToken({ tableId });
      if (!result.ok) {
        onError(result.message);
        return;
      }
      setQr(result.data);
      onNotice(qr ? "QR rotated — the old code no longer works." : "QR generated.");
    });
  }

  function handleRevoke() {
    if (!window.confirm("Revoke this table's QR code? The current code will stop working immediately.")) return;
    startTransition(async () => {
      const result = await revokeTableQrToken({ tableId });
      if (!result.ok) {
        onError(result.message);
        return;
      }
      setQr(null);
      onNotice("QR revoked.");
    });
  }

  function handleCopyUrl() {
    if (!qr) return;
    void navigator.clipboard.writeText(qr.qrUrl);
    onNotice("Customer URL copied.");
  }

  if (!loaded) {
    return <p className="text-sm text-[var(--color-charcoal-muted)]">Loading QR status…</p>;
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">QR code</h3>
      {qr ? (
        <div className="flex flex-wrap items-start gap-4">
          <div className="rounded-md border border-[var(--color-border)] bg-white p-3" dangerouslySetInnerHTML={{ __html: qr.qrSvg }} />
          <div className="flex flex-col gap-2">
            <p className="text-xs text-emerald-700">Active — generated {new Date(qr.createdAt).toLocaleString()}</p>
            <div className="flex max-w-xs items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-ivory)] px-2 py-1.5 text-xs">
              <span className="flex-1 truncate">{qr.qrUrl}</span>
              <button type="button" onClick={handleCopyUrl} className="shrink-0 font-medium text-[var(--color-bronze-strong)] hover:underline">
                Copy
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={isPending} onClick={handleGenerateOrRotate} className={smallButtonClass}>
                Rotate QR
              </button>
              <button type="button" disabled={isPending} onClick={handleRevoke} className={`${smallButtonClass} text-red-700`}>
                Revoke
              </button>
              <DownloadSvgButton svg={qr.qrSvg} filename={`table-${tableLabel}-qr.svg`} className={smallButtonClass} />
              <Link href={`/staff/print/tables/${tableId}`} target="_blank" className={smallButtonClass}>
                Print view
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <p className="mb-2 text-sm text-[var(--color-charcoal-muted)]">This table doesn&apos;t have an active QR code yet.</p>
          <button type="button" disabled={isPending} onClick={handleGenerateOrRotate} className={smallButtonClass}>
            Generate QR
          </button>
        </div>
      )}
    </div>
  );
}
