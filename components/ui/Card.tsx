/**
 * The white, softly-elevated surface used throughout the redesign — menu
 * item rows, the welcome banner, sticky bars all build on this. Plain
 * presentational wrapper, no behavior.
 */
export function Card({
  className = "",
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: React.ReactNode;
  as?: "div" | "section" | "article";
}) {
  return (
    <Tag
      className={`rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[0_1px_3px_rgba(17,24,39,0.04),0_1px_2px_rgba(17,24,39,0.02)] ${className}`}
    >
      {children}
    </Tag>
  );
}
