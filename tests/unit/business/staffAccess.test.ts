import { describe, expect, it } from "vitest";
import { wouldLeaveNoActiveAdmin, type StaffMembershipSummary } from "@/lib/business/staffAccess";

function roster(...members: StaffMembershipSummary[]): StaffMembershipSummary[] {
  return members;
}

describe("wouldLeaveNoActiveAdmin", () => {
  it("blocks demoting the sole active admin to a non-admin role", () => {
    const members = roster({ id: "a1", role: "admin", isActive: true }, { id: "s1", role: "staff", isActive: true });
    expect(wouldLeaveNoActiveAdmin(members, "a1", { role: "staff" })).toBe(true);
  });

  it("allows demoting an admin when another active admin remains", () => {
    const members = roster(
      { id: "a1", role: "admin", isActive: true },
      { id: "a2", role: "admin", isActive: true },
      { id: "s1", role: "staff", isActive: true },
    );
    expect(wouldLeaveNoActiveAdmin(members, "a1", { role: "staff" })).toBe(false);
  });

  it("blocks deactivating the sole active admin", () => {
    const members = roster({ id: "a1", role: "admin", isActive: true }, { id: "s1", role: "staff", isActive: true });
    expect(wouldLeaveNoActiveAdmin(members, "a1", { isActive: false })).toBe(true);
  });

  it("allows deactivating an admin when another active admin remains", () => {
    const members = roster({ id: "a1", role: "admin", isActive: true }, { id: "a2", role: "admin", isActive: true });
    expect(wouldLeaveNoActiveAdmin(members, "a1", { isActive: false })).toBe(false);
  });

  it("an inactive admin never counts toward the 'still have an admin' guarantee", () => {
    // a2 is admin but already inactive — deactivating the only ACTIVE admin (a1) must still be blocked.
    const members = roster({ id: "a1", role: "admin", isActive: true }, { id: "a2", role: "admin", isActive: false });
    expect(wouldLeaveNoActiveAdmin(members, "a1", { isActive: false })).toBe(true);
  });

  it("reactivating a previously-inactive admin is always allowed (never reduces the admin count)", () => {
    const members = roster({ id: "a1", role: "admin", isActive: true }, { id: "a2", role: "admin", isActive: false });
    expect(wouldLeaveNoActiveAdmin(members, "a2", { isActive: true })).toBe(false);
  });

  it("changing a non-admin's role or status never triggers the guarantee, regardless of the rest of the roster", () => {
    const members = roster({ id: "a1", role: "admin", isActive: true }, { id: "s1", role: "staff", isActive: true });
    expect(wouldLeaveNoActiveAdmin(members, "s1", { role: "kitchen" })).toBe(false);
    expect(wouldLeaveNoActiveAdmin(members, "s1", { isActive: false })).toBe(false);
  });

  it("promoting a staff member to admin is always allowed", () => {
    const members = roster({ id: "a1", role: "admin", isActive: false }, { id: "s1", role: "staff", isActive: true });
    // a1 is an inactive admin, so right now there are zero active admins already —
    // promoting s1 fixes that, and must never be blocked.
    expect(wouldLeaveNoActiveAdmin(members, "s1", { role: "admin" })).toBe(false);
  });

  it("a no-op change (re-selecting the same role) reflects the roster's real current state", () => {
    const members = roster({ id: "a1", role: "admin", isActive: true });
    expect(wouldLeaveNoActiveAdmin(members, "a1", { role: "admin" })).toBe(false);
    expect(wouldLeaveNoActiveAdmin(members, "a1", { isActive: true })).toBe(false);
  });

  it("an empty roster has no active admin by definition", () => {
    expect(wouldLeaveNoActiveAdmin([], "missing", { role: "admin" })).toBe(true);
  });
});
