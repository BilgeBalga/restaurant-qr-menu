import { describe, expect, it } from "vitest";
import { addStaffMemberInputSchema, setStaffActiveInputSchema, updateStaffRoleInputSchema } from "@/lib/validation/staff";

const id = "11111111-1111-4111-8111-111111111111";

describe("addStaffMemberInputSchema", () => {
  it("accepts a valid email and role, normalizing email to lowercase and trimmed", () => {
    const result = addStaffMemberInputSchema.parse({ email: "  New.Hire@Example.com  ", role: "staff" });
    expect(result).toEqual({ email: "new.hire@example.com", role: "staff" });
  });

  it("accepts every role in the existing enum", () => {
    for (const role of ["admin", "manager", "staff", "kitchen"]) {
      expect(addStaffMemberInputSchema.safeParse({ email: "a@b.com", role }).success).toBe(true);
    }
  });

  it("rejects a malformed email", () => {
    expect(addStaffMemberInputSchema.safeParse({ email: "not-an-email", role: "staff" }).success).toBe(false);
    expect(addStaffMemberInputSchema.safeParse({ email: "", role: "staff" }).success).toBe(false);
  });

  it("rejects a role outside the existing enum", () => {
    expect(addStaffMemberInputSchema.safeParse({ email: "a@b.com", role: "owner" }).success).toBe(false);
  });

  it("rejects an absurdly long email", () => {
    const longEmail = "a".repeat(250) + "@example.com";
    expect(addStaffMemberInputSchema.safeParse({ email: longEmail, role: "staff" }).success).toBe(false);
  });
});

describe("updateStaffRoleInputSchema", () => {
  it("accepts a valid membershipId and role", () => {
    expect(updateStaffRoleInputSchema.safeParse({ membershipId: id, role: "manager" }).success).toBe(true);
  });

  it("rejects a non-uuid membershipId", () => {
    expect(updateStaffRoleInputSchema.safeParse({ membershipId: "not-a-uuid", role: "manager" }).success).toBe(false);
  });

  it("rejects an invalid role", () => {
    expect(updateStaffRoleInputSchema.safeParse({ membershipId: id, role: "superadmin" }).success).toBe(false);
  });
});

describe("setStaffActiveInputSchema", () => {
  it("accepts a valid membershipId and boolean isActive", () => {
    expect(setStaffActiveInputSchema.safeParse({ membershipId: id, isActive: true }).success).toBe(true);
    expect(setStaffActiveInputSchema.safeParse({ membershipId: id, isActive: false }).success).toBe(true);
  });

  it("rejects a non-boolean isActive", () => {
    expect(setStaffActiveInputSchema.safeParse({ membershipId: id, isActive: "true" }).success).toBe(false);
  });
});
