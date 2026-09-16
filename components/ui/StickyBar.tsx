/**
 * A fixed-to-viewport-bottom, blurred bar respecting the safe-area inset —
 * the floating cart action and the customer bottom nav both dock this
 * way. `offset` lets one sticky bar stack above another (the cart bar
 * floats just above the bottom nav, matching the Stitch reference).
 */
export function StickyBar({
  className = "",
  offsetClassName = "bottom-0",
  children,
}: {
  className?: string;
  /** Tailwind bottom-* class controlling how far up from the viewport base this bar sits — lets a second bar dock above another. */
  offsetClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`fixed inset-x-0 z-40 ${offsetClassName} ${className}`}>
      <div className="mx-auto w-full max-w-[480px] px-4">{children}</div>
    </div>
  );
}
