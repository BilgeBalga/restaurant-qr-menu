"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { listTableBoard, type TableBoardRow } from "@/app/actions/tables";
import { clearTable } from "@/app/actions/orders";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { TableStatus } from "@/lib/business/tableStatus";

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

/** §18: table status is derived server-side (listTableBoard); this component just re-fetches on any relevant realtime change. */
export function TableBoard({ initialTables, restaurantId }: { initialTables: TableBoardRow[]; restaurantId: string }) {
  const [tables, setTables] = useState(initialTables);
  const [, startTransition] = useTransition();

  const refetch = useCallback(async () => {
    const result = await listTableBoard();
    if (result.ok) setTables(result.data);
  }, []);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantId, refetch]);

  function handleClear(tableId: string) {
    startTransition(async () => {
      await clearTable(tableId);
      await refetch();
    });
  }

  return (
    <div>
      <h1 className="mb-4 font-display text-2xl font-semibold">Tables</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tables.map((table) => (
          <div key={table.tableId} className={`rounded-lg p-4 ${STATUS_STYLE[table.status]}`}>
            <div className="text-lg font-semibold">{table.label}</div>
            <div className="text-sm">{STATUS_LABEL[table.status]}</div>
            {table.activeOrderCount > 0 ? <div className="text-xs">{table.activeOrderCount} active order(s)</div> : null}
            {table.status === "available" ? null : (
              <button
                type="button"
                onClick={() => handleClear(table.tableId)}
                className="mt-2 rounded border border-current px-2 py-0.5 text-xs"
              >
                Clear table
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
