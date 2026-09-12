/**
 * Pure slug generation for admin-created categories/menu items — both
 * have a unique(restaurant_id, slug) index, so this doesn't have to
 * guarantee uniqueness on its own; app/actions/menuAdmin.ts retries once
 * with a short random suffix if the DB reports a conflict.
 */
export function slugify(name: string): string {
  // Strip combining diacritics left behind by NFKD (e.g. "café" -> "cafe")
  // via codepoint range rather than a \u-escaped regex, which is easy to
  // mistype into literal combining characters.
  const withoutDiacritics = Array.from(name.normalize("NFKD"))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x0300 || code > 0x036f;
    })
    .join("");

  const slug = withoutDiacritics
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "item";
}
