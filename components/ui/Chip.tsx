/**
 * Pill-shaped label — status badges (sold out, featured), category/filter
 * pills, and small counters. Two render modes: a static `<span>` (status
 * display, not interactive) or, when `href`/`onClick` is given, a real
 * `<a>`/`<button>` so keyboard and screen-reader users get a proper
 * interactive element rather than a styled `<span>` with a click handler
 * bolted on.
 */
type ChipTone = "neutral" | "primary" | "success" | "warning" | "muted";

const TONE_CLASSES: Record<ChipTone, string> = {
  neutral: "bg-[var(--color-surface-sunken)] text-[var(--color-ink)]",
  primary: "bg-[var(--color-primary)] text-[var(--color-on-primary)]",
  success: "bg-[var(--color-success-bg)] text-[var(--color-success)] border border-[var(--color-success-border)]",
  warning: "bg-[var(--color-warning-bg)] text-[var(--color-warning)] border border-[var(--color-warning-border)]",
  muted: "bg-[var(--color-muted-bg)] text-[var(--color-muted)] border border-[var(--color-muted-border)]",
};

const BASE_CLASSES =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold leading-none";

interface ChipBaseProps {
  tone?: ChipTone;
  className?: string;
  children: React.ReactNode;
}

export function Chip({ tone = "neutral", className = "", children }: ChipBaseProps) {
  return <span className={`${BASE_CLASSES} ${TONE_CLASSES[tone]} ${className}`}>{children}</span>;
}

export function ChipLink({
  tone = "neutral",
  className = "",
  children,
  href,
  active = false,
}: ChipBaseProps & { href: string; active?: boolean }) {
  return (
    <a
      href={href}
      className={`${BASE_CLASSES} shrink-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${
        active ? TONE_CLASSES.primary : TONE_CLASSES[tone]
      } ${className}`}
    >
      {children}
    </a>
  );
}
