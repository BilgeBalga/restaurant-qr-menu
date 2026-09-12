import { describe, expect, it, vi } from "vitest";
import { findOrCreateStaffAuthUser, type StaffAuthAdminClient } from "@/lib/auth/adminUsers";

/**
 * findOrCreateStaffAuthUser calls the real Supabase Admin (GoTrue) API,
 * which the local integration test harness (tests/integration/harness/) —
 * a bare Postgres instance, no GoTrue server — cannot provide (see its own
 * comment: "Not Docker, not the Supabase CLI... both were unavailable").
 * So the branching logic itself (found / not-found-then-create / either
 * kind of failure) is unit-tested here against a small stub implementing
 * exactly StaffAuthAdminClient — the minimal interface the function
 * actually depends on — rather than left completely uncovered.
 */
function makeAdminClient(opts: {
  existing?: { id: string } | null;
  lookupError?: { message: string } | null;
  createUser?: StaffAuthAdminClient["auth"]["admin"]["createUser"];
}) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: opts.existing ?? null, error: opts.lookupError ?? null });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const createUser =
    opts.createUser ?? vi.fn().mockResolvedValue({ data: { user: { id: "brand-new-id" } }, error: null });
  const client: StaffAuthAdminClient = { from, auth: { admin: { createUser } } };
  return { client, from, select, eq, maybeSingle, createUser };
}

describe("findOrCreateStaffAuthUser", () => {
  it("returns the existing user without calling createUser when staff_users already has that email", async () => {
    const { client, createUser, from, select, eq } = makeAdminClient({ existing: { id: "existing-id" } });

    const result = await findOrCreateStaffAuthUser(client, "someone@example.com");

    expect(result).toEqual({ ok: true, data: { id: "existing-id", created: false, temporaryPassword: null } });
    expect(createUser).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith("staff_users");
    expect(select).toHaveBeenCalledWith("id");
    expect(eq).toHaveBeenCalledWith("email", "someone@example.com");
  });

  it("surfaces a lookup error without attempting to create a user", async () => {
    const { client, createUser } = makeAdminClient({ lookupError: { message: "connection reset" } });

    const result = await findOrCreateStaffAuthUser(client, "someone@example.com");

    expect(result).toEqual({ ok: false, error: "connection reset" });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("creates a new Auth user with a generated temporary password when none exists yet", async () => {
    const createUser = vi.fn().mockResolvedValue({ data: { user: { id: "brand-new-id" } }, error: null });
    const { client } = makeAdminClient({ existing: null, createUser });

    const result = await findOrCreateStaffAuthUser(client, "new.hire@example.com");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.data.id).toBe("brand-new-id");
    expect(result.data.created).toBe(true);
    expect(typeof result.data.temporaryPassword).toBe("string");
    expect(result.data.temporaryPassword!.length).toBeGreaterThanOrEqual(24);

    expect(createUser).toHaveBeenCalledTimes(1);
    const callArg = createUser.mock.calls[0]![0] as { email: string; password: string; email_confirm: boolean };
    expect(callArg.email).toBe("new.hire@example.com");
    expect(callArg.email_confirm).toBe(true);
    expect(callArg.password).toBe(result.data.temporaryPassword);
  });

  it("generates a different temporary password on each call (never reused)", async () => {
    const { client: clientA } = makeAdminClient({ existing: null });
    const { client: clientB } = makeAdminClient({ existing: null });

    const a = await findOrCreateStaffAuthUser(clientA, "a@example.com");
    const b = await findOrCreateStaffAuthUser(clientB, "b@example.com");

    if (!a.ok || !b.ok) throw new Error("expected ok results");
    expect(a.data.temporaryPassword).not.toBe(b.data.temporaryPassword);
  });

  it("surfaces a createUser error", async () => {
    const createUser = vi.fn().mockResolvedValue({ data: null, error: { message: "email already registered" } });
    const { client } = makeAdminClient({ existing: null, createUser });

    const result = await findOrCreateStaffAuthUser(client, "new.hire@example.com");

    expect(result).toEqual({ ok: false, error: "email already registered" });
  });

  it("surfaces a fallback error if createUser reports no error but also no user", async () => {
    const createUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
    const { client } = makeAdminClient({ existing: null, createUser });

    const result = await findOrCreateStaffAuthUser(client, "new.hire@example.com");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure result");
    expect(result.error).toBe("failed to create auth user");
  });
});
