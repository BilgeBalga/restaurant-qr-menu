"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-[var(--color-bronze)] px-4 py-2 text-sm font-medium text-white"
    >
      Print
    </button>
  );
}
