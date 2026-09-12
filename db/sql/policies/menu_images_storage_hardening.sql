-- Defense-in-depth hardening for the menu-images bucket
-- (db/sql/policies/menu_images_storage.sql, already applied).
--
-- Bug: the bucket's own file_size_limit/allowed_mime_types were left at
-- their defaults (unlimited size, any content type) when the bucket was
-- created. MIME type and size are validated today, but ONLY in the app
-- layer (lib/validation/menu.ts's menuItemImageFileSchema, enforced in
-- app/actions/menuAdmin.ts's uploadMenuItemImage) — the Storage RLS
-- policies (menu_images_insert_admin etc.) only ever checked WHO may
-- write, never WHAT. Anyone with a valid admin session who called the
-- Storage API directly (bypassing the app's own form) could upload an
-- arbitrarily large file, or a non-image content type, to a
-- publicly-served bucket.
--
-- Fix: set the SAME limits at the Storage layer itself, so they hold
-- regardless of which client calls the API — mirrors
-- lib/storage/menuImages.ts's ALLOWED_MENU_IMAGE_MIME_TYPES /
-- MAX_MENU_IMAGE_BYTES exactly, so the two can't silently drift.
--
-- A plain UPDATE, not a migration — same hand-applied convention as the
-- original menu_images_storage.sql (Storage config lives outside
-- db/migrations/ on purpose; see that file's own header). Idempotent:
-- safe to run more than once. NOT applied automatically by this coding
-- pass — apply by hand against the real Supabase project (SQL editor, or
-- psql) when ready, the same way the original bucket setup was.

UPDATE storage.buckets
SET
  file_size_limit = 5242880, -- 5 * 1024 * 1024 bytes — MAX_MENU_IMAGE_BYTES
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'menu-images';
