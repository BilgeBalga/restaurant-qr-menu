/**
 * Drizzle schema — intentionally empty in Phase 1.
 *
 * The full schema (restaurants, tables, table_sessions, orders, ... — §7 of
 * the architecture, including the six critical-review fixes: denormalized
 * restaurant_id on child tables, the partial-unique open-session index,
 * idempotency_key, etc.) is Phase 2's deliverable, applied as reviewed
 * Drizzle migrations against a real Supabase Postgres project.
 *
 * This file exists now so drizzle-kit and the migration pipeline are wired
 * and provably working before any real tables are defined.
 */
export {};
