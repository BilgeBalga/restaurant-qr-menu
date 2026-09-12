-- Menu item image Storage bucket + RLS policies (Image Support feature).
--
-- NOT part of db/migrations/ on purpose, and this directory (db/sql/,
-- already scaffolded with empty functions/ and policies/ subfolders
-- before this feature) is never read by drizzle-kit migrate — see
-- drizzle.config.ts's `out: "./db/migrations"`. Supabase Storage's own
-- schema (storage.buckets, storage.objects, storage.foldername()) is
-- provided by Supabase itself in every real project, the same way `auth`
-- is — but unlike `auth`, the local integration test harness
-- (tests/integration/harness/local-supabase-emulation.sql) does not
-- emulate it, and doing so just to make this file "apply" locally would
-- mean faking Storage's actual enforcement semantics and calling that an
-- integration test, which this project's testing conventions explicitly
-- avoid (see tests/integration/staff-admin.test.ts's own note about the
-- Auth Admin API for the same reasoning applied to a different Supabase
-- subsystem).
--
-- Apply this ONCE, by hand, against the real Supabase project (SQL
-- editor, or `psql`/the CLI if that project manages its own migrations
-- that way) — never automatically, and never against production without
-- deliberately choosing to.
--
-- Mirrors this project's existing RLS conventions exactly:
--   - reuses public.staff_role_for(uuid) (db/migrations/0001_functions.sql)
--     unchanged — the same admin check every table-level admin-write
--     policy already uses, just applied to a restaurant_id parsed out of
--     the object's path instead of a row's column.
--   - narrow, single-purpose policies per operation, like
--     db/migrations/0002_rls_policies.sql's menu_items_insert_admin /
--     menu_items_update_staff / menu_items_delete_admin.
--   - public bucket + public SELECT: active menu data (name, price,
--     description) is already fully public via menu_items_select_anon's
--     row-level RLS, so a public-read image bucket is consistent with
--     that, not a new exposure.
--
-- Path convention: {restaurantId}/{menuItemId}/{random}.{ext} — see
-- lib/storage/menuImages.ts's buildMenuItemImagePath(). storage.foldername(name)
-- splits the object key on '/' and returns the folder segments as a
-- text[]; segment [1] is always the restaurantId under this convention.

insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

-- ============================================================
-- storage.objects, scoped to the menu-images bucket only — these
-- policies say nothing about any other bucket that may exist.
-- ============================================================

create policy "menu_images_select_public"
  on storage.objects for select
  to public
  using (bucket_id = 'menu-images');

create policy "menu_images_insert_admin"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'menu-images'
    and public.staff_role_for((storage.foldername(name))[1]::uuid) = 'admin'
  );

create policy "menu_images_update_admin"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'menu-images'
    and public.staff_role_for((storage.foldername(name))[1]::uuid) = 'admin'
  )
  with check (
    bucket_id = 'menu-images'
    and public.staff_role_for((storage.foldername(name))[1]::uuid) = 'admin'
  );

create policy "menu_images_delete_admin"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'menu-images'
    and public.staff_role_for((storage.foldername(name))[1]::uuid) = 'admin'
  );
