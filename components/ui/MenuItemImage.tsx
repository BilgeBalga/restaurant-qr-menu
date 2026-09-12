/**
 * Shared image-or-fallback presentation for a menu item, used by both
 * MenuBrowser.tsx's card grid (small, fixed-size thumbnail) and
 * ItemDetail.tsx (a larger aspect-ratio hero) — one place for the
 * "no photo yet" treatment so the two don't drift.
 *
 * Plain `<img>`, not next/image: this project has no `sharp` dependency
 * and no existing image-optimization pipeline, and Supabase Storage
 * already serves a capped-size (5MB), already-reasonably-sized static
 * file directly — next/image's main value (on-demand resizing/format
 * negotiation) would add a new production dependency and config surface
 * for little benefit at this MVP's scale. `loading="lazy"` plus the
 * caller's own fixed-size/aspect-ratio wrapper class gets most of the
 * same layout-stability and off-screen-deferral benefit for free.
 */
export function MenuItemImage({
  name,
  imageUrl,
  className = "",
  monogramClassName = "text-lg",
}: {
  name: string;
  imageUrl: string | null;
  className?: string;
  monogramClassName?: string;
}) {
  return (
    <div className={`overflow-hidden bg-[var(--color-ivory)] ${className}`}>
      {imageUrl ? (
        <img src={imageUrl} alt={name} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className={`font-display font-semibold text-[var(--color-bronze)] ${monogramClassName}`} aria-hidden="true">
            {name.trim().charAt(0).toUpperCase() || "?"}
          </span>
        </div>
      )}
    </div>
  );
}
