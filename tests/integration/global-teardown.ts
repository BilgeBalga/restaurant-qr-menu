/**
 * `sql` in ./db is a module-level singleton pool shared across every test
 * file. Closing it in a per-file/per-describe `afterAll` tears it down
 * for whichever files/blocks haven't run yet — this runs exactly once,
 * after the entire suite finishes, instead.
 */
export default async function setup() {
  return async function teardown() {
    const { closeTestDb } = await import("./db");
    await closeTestDb();
  };
}
