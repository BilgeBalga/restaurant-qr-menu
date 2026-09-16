import type { ButtonHTMLAttributes } from "react";

/**
 * Semantic <button> only — this project's nav/routing links stay plain
 * <Link>/<a> elements (a link that navigates should never be a <button>,
 * and vice versa). Primary is reserved for the one conversion action on
 * a screen; secondary/ghost cover everything else. Sized for a
 * comfortable touch target (44px+) per the redesign's accessibility bar.
 */
type ButtonVariant = "primary" | "secondary" | "ghost";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-[var(--color-primary)] text-[var(--color-on-primary)] active:bg-[var(--color-primary-strong)]",
  secondary: "bg-[var(--color-surface-sunken)] text-[var(--color-ink)] active:bg-[var(--color-hairline)]",
  ghost: "bg-transparent text-[var(--color-ink-muted)] active:opacity-70",
};

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
