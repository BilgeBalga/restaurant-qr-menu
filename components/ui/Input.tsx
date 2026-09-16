import type { InputHTMLAttributes } from "react";

/** 48px-tall text input with the redesign's focus-ring treatment — search boxes, forms in later stages. */
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-12 w-full rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] px-4 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] transition-colors focus:border-[var(--color-primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-primary)]/15 ${className}`}
    />
  );
}
