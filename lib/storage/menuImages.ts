/**
 * Pure helpers for the menu-images Storage bucket (Image Support feature)
 * — no DB/network I/O, isomorphic on purpose (same convention as
 * lib/business/*.ts and lib/format/money.ts): the admin upload form needs
 * the same MIME/size constants client-side for instant feedback that
 * app/actions/menuAdmin.ts enforces server-side, and duplicating the
 * numbers in two places would let them drift.
 *
 * See db/storage/menu_images_bucket.sql for why the bucket/RLS policies
 * themselves are a hand-applied SQL file, not a Drizzle migration.
 */

export const MENU_IMAGES_BUCKET = "menu-images";

/** SVG and GIF are deliberately excluded — SVG can carry embedded scripts (a real XSS vector once served back with an image content-type), GIF isn't worth the complexity for a menu-photo MVP. */
export const ALLOWED_MENU_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedMenuImageMimeType = (typeof ALLOWED_MENU_IMAGE_MIME_TYPES)[number];

export const MAX_MENU_IMAGE_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<AllowedMenuImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isAllowedMenuImageMimeType(type: string): type is AllowedMenuImageMimeType {
  return (ALLOWED_MENU_IMAGE_MIME_TYPES as readonly string[]).includes(type);
}

/**
 * {restaurantId}/{menuItemId}/{random}.{ext} — restaurantId leads so the
 * Storage RLS policies (db/storage/menu_images_bucket.sql) can extract it
 * via storage.foldername(name)[1] and check staff_role_for() against it,
 * the same tenant-scoping shape as every table-level RLS policy in this
 * project. The random component means every upload gets a fresh object
 * key, so replacing an image is never blocked by an existing object at
 * the same path and never risks serving a stale cached copy of the old
 * one from the same URL.
 */
export function buildMenuItemImagePath(restaurantId: string, menuItemId: string, mimeType: AllowedMenuImageMimeType): string {
  return `${restaurantId}/${menuItemId}/${crypto.randomUUID()}.${EXTENSION_BY_MIME[mimeType]}`;
}

/**
 * The inverse of `.storage.from(bucket).getPublicUrl(path)` for this one
 * bucket — given a full public Storage URL, returns just the object path
 * (restaurantId/menuItemId/file) so it can be passed to `.remove([path])`.
 * Returns null for anything that isn't a menu-images object — notably a
 * URL an admin pasted by hand before this feature existed (the old
 * free-text "Image URL" field), which must never be treated as a Storage
 * path to delete.
 */
export function extractMenuImageObjectPath(imageUrl: string): string | null {
  const marker = `/object/public/${MENU_IMAGES_BUCKET}/`;
  const index = imageUrl.indexOf(marker);
  if (index === -1) return null;
  const path = imageUrl.slice(index + marker.length).split(/[?#]/)[0];
  return path ? decodeURIComponent(path) : null;
}
