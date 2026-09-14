-- menu-images Storage bucket + RLS policies (Menu Item Image Support).
--
-- §Phase 6 audit P1-2 — this file did not exist in the repository even
-- though lib/storage/menuImages.ts already referenced it by name as the
-- source of truth. The bucket and its policies were applied by hand to
-- the real Supabase project at some point and never committed; this file
-- reconstructs that exact live state (captured directly from production
-- via `select * from storage.buckets` / `pg_policies` during the audit)
-- so it's reproducible for a new environment, disaster recovery, or a
-- second production instance.
--
-- Hand-applied, not a Drizzle migration: storage.buckets/storage.objects
-- are Supabase-managed system tables, not part of this project's own
-- schema — db:migrate only ever runs against public.*. Apply this once,
-- by hand, against a fresh Supabase project the same way the original
-- production bucket was created. Written to be safely re-runnable
-- (ON CONFLICT / DROP POLICY IF EXISTS) in case it's ever re-applied to
-- an environment that already has some of this in place.
--
-- Object path convention: {restaurantId}/{menuItemId}/{random}.{ext}
-- (lib/storage/menuImages.ts buildMenuItemImagePath) — restaurantId leads
-- so storage.foldername(name)[1] extracts it for staff_role_for(), the
-- same tenant-scoping shape as every table-level RLS policy in this
-- project. Public bucket + public SELECT policy: menu photos are
-- customer-facing, same visibility as the menu items they belong to;
-- INSERT/UPDATE/DELETE are admin-only, mirroring menu_items' own
-- admin-only write policies for the column that carries the image URL.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('menu-images', 'menu-images', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "menu_images_select_public" ON storage.objects;
CREATE POLICY "menu_images_select_public" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'menu-images');

DROP POLICY IF EXISTS "menu_images_insert_admin" ON storage.objects;
CREATE POLICY "menu_images_insert_admin" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'menu-images'
    AND public.staff_role_for((storage.foldername(name))[1]::uuid) = 'admin'
  );

DROP POLICY IF EXISTS "menu_images_update_admin" ON storage.objects;
CREATE POLICY "menu_images_update_admin" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'menu-images'
    AND public.staff_role_for((storage.foldername(name))[1]::uuid) = 'admin'
  )
  WITH CHECK (
    bucket_id = 'menu-images'
    AND public.staff_role_for((storage.foldername(name))[1]::uuid) = 'admin'
  );

DROP POLICY IF EXISTS "menu_images_delete_admin" ON storage.objects;
CREATE POLICY "menu_images_delete_admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'menu-images'
    AND public.staff_role_for((storage.foldername(name))[1]::uuid) = 'admin'
  );
