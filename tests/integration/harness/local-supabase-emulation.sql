-- LOCAL TEST HARNESS ONLY — never run against a real Supabase project.
--
-- Supabase Cloud already provides the `anon`/`authenticated`/`service_role`
-- roles, the `auth` schema, and `auth.uid()` for real (backed by GoTrue).
-- This file exists only so db/migrations/0001_functions.sql and
-- 0002_rls_policies.sql — which reference those primitives — can be
-- applied and tested against a plain local Postgres instance, without
-- Docker/the Supabase CLI (unavailable in this environment; see the
-- Phase 2 report). It approximates the real primitives closely enough to
-- exercise our own RLS policies and SECURITY DEFINER functions honestly,
-- but it is NOT GoTrue and does NOT prove Supabase-specific behavior
-- (JWT issuance/verification, session refresh, etc.) — only Postgres-level
-- behavior, which is what Phase 2 is actually responsible for.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Real Supabase's auth.uid() reads the JWT `sub` claim PostgREST sets via
-- `SET LOCAL request.jwt.claims`. This reproduces that contract so tests
-- can impersonate a given staff user with `SELECT set_config('request.jwt.claim.sub', '<uuid>', false)`.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Mirrors what Supabase's platform bootstrapping does automatically for
-- every real project (not something our own app migrations do there).
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
