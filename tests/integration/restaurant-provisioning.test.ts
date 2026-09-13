import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, uniqueKey, withRole } from "./db";

/**
 * SaaS Phase 3 — db/migrations/0012_provision_restaurant.sql. Exercises
 * provision_restaurant() directly at the RPC level (the same "call the
 * SQL function, assert on the resulting rows" convention every other
 * RPC test file in this suite already uses) — app/actions/platformAdmin.ts's
 * own Auth-phase (findOrCreateStaffAuthUser) is already covered by its
 * own existing tests and isn't re-exercised here; these tests start from
 * an already-resolved owner staff_user_id, exactly what that action
 * hands the RPC in practice.
 */

async function createPlatformAdmin(): Promise<string> {
  const id = crypto.randomUUID();
  await sql`INSERT INTO auth.users (id, email) VALUES (${id}, ${"platform-admin-" + id + "@example.com"})`;
  await sql`INSERT INTO platform_admins (staff_user_id) VALUES (${id})`;
  return id;
}

async function createOwnerCandidate(label: string): Promise<{ id: string; email: string }> {
  const id = crypto.randomUUID();
  const email = `owner-${label}-${id}@example.com`;
  await sql`INSERT INTO auth.users (id, email) VALUES (${id}, ${email})`;
  return { id, email };
}

async function callProvisionRestaurant(
  callerId: string | null,
  args: { name: string; slug: string; ownerStaffUserId: string; timezone?: string; currency?: string; orderNumberPrefix?: string | null },
) {
  return withRole("authenticated", callerId, async (conn) => {
    const [row] = await conn`
      SELECT public.provision_restaurant(
        ${args.name}, ${args.slug}, ${args.timezone ?? "UTC"}, ${args.currency ?? "USD"},
        ${args.ownerStaffUserId}::uuid, ${args.orderNumberPrefix ?? null}
      ) AS result
    `;
    return row!.result as { restaurant_id: string; slug: string; created: boolean };
  });
}

describe("provision_restaurant — authorization", () => {
  it("rejects an unauthenticated (anon) caller, creating nothing", async () => {
    const owner = await createOwnerCandidate("anon");
    const slug = uniqueKey("slug-anon");

    await expect(
      withRole("anon", null, async (conn) => {
        return conn`SELECT public.provision_restaurant('X', ${slug}, 'UTC', 'USD', ${owner.id}::uuid, NULL)`;
      }),
    ).rejects.toThrow(/FORBIDDEN/);

    const rows = await sql`SELECT id FROM restaurants WHERE slug = ${slug}`;
    expect(rows).toHaveLength(0);
  });

  it("rejects a restaurant admin who is not a platform admin, creating nothing", async () => {
    const fx = await createTestRestaurant();
    const owner = await createOwnerCandidate("restaurantadmin");
    const slug = uniqueKey("slug-restaurantadmin");

    await expect(
      callProvisionRestaurant(fx.adminId, { name: "Should Not Exist", slug, ownerStaffUserId: owner.id }),
    ).rejects.toThrow(/FORBIDDEN/);

    const rows = await sql`SELECT id FROM restaurants WHERE slug = ${slug}`;
    expect(rows).toHaveLength(0);
  });

  it("allows a platform admin to provision a restaurant", async () => {
    const platformAdminId = await createPlatformAdmin();
    const owner = await createOwnerCandidate("happy");
    const slug = uniqueKey("slug-happy");

    const result = await callProvisionRestaurant(platformAdminId, { name: "Happy Place", slug, ownerStaffUserId: owner.id });

    expect(result.restaurant_id).toBeDefined();
    expect(result.slug).toBe(slug);
    expect(result.created).toBe(true);
  });
});

describe("provision_restaurant — resulting state", () => {
  it("the resulting restaurant is active", async () => {
    const platformAdminId = await createPlatformAdmin();
    const owner = await createOwnerCandidate("active");
    const slug = uniqueKey("slug-active");

    const result = await callProvisionRestaurant(platformAdminId, { name: "Active Place", slug, ownerStaffUserId: owner.id });

    const [row] = await sql`SELECT status FROM restaurants WHERE id = ${result.restaurant_id}`;
    expect(row!.status).toBe("active");
  });

  it("restaurant_settings exists for the new restaurant, with the requested order number prefix", async () => {
    const platformAdminId = await createPlatformAdmin();
    const owner = await createOwnerCandidate("settings");
    const slug = uniqueKey("slug-settings");

    const result = await callProvisionRestaurant(platformAdminId, {
      name: "Settings Place",
      slug,
      ownerStaffUserId: owner.id,
      orderNumberPrefix: "S",
    });

    const [row] = await sql`SELECT order_number_prefix, tax_rate, service_charge_rate FROM restaurant_settings WHERE restaurant_id = ${result.restaurant_id}`;
    expect(row!.order_number_prefix).toBe("S");
    expect(Number(row!.tax_rate)).toBe(0);
    expect(Number(row!.service_charge_rate)).toBe(0);
  });

  it("restaurant_settings falls back to prefix 'A' when none is given (matches the column's own default)", async () => {
    const platformAdminId = await createPlatformAdmin();
    const owner = await createOwnerCandidate("defaultprefix");
    const slug = uniqueKey("slug-defaultprefix");

    const result = await callProvisionRestaurant(platformAdminId, { name: "Default Prefix Place", slug, ownerStaffUserId: owner.id });

    const [row] = await sql`SELECT order_number_prefix FROM restaurant_settings WHERE restaurant_id = ${result.restaurant_id}`;
    expect(row!.order_number_prefix).toBe("A");
  });

  it("the owner's restaurant_staff membership exists with role admin and is active", async () => {
    const platformAdminId = await createPlatformAdmin();
    const owner = await createOwnerCandidate("membership");
    const slug = uniqueKey("slug-membership");

    const result = await callProvisionRestaurant(platformAdminId, { name: "Membership Place", slug, ownerStaffUserId: owner.id });

    const [row] = await sql`SELECT role, is_active FROM restaurant_staff WHERE restaurant_id = ${result.restaurant_id} AND staff_user_id = ${owner.id}`;
    expect(row!.role).toBe("admin");
    expect(row!.is_active).toBe(true);
  });

  it("owner_staff_user_id on the restaurant matches the resolved owner", async () => {
    const platformAdminId = await createPlatformAdmin();
    const owner = await createOwnerCandidate("ownerptr");
    const slug = uniqueKey("slug-ownerptr");

    const result = await callProvisionRestaurant(platformAdminId, { name: "Owner Pointer Place", slug, ownerStaffUserId: owner.id });

    const [row] = await sql`SELECT owner_staff_user_id FROM restaurants WHERE id = ${result.restaurant_id}`;
    expect(row!.owner_staff_user_id).toBe(owner.id);
  });
});

describe("provision_restaurant — tenant isolation", () => {
  it("provisioning a new restaurant never touches an existing restaurant's staff or settings", async () => {
    const platformAdminId = await createPlatformAdmin();
    const existing = await createTestRestaurant();
    const owner = await createOwnerCandidate("isolated");
    const slug = uniqueKey("slug-isolated");

    const result = await callProvisionRestaurant(platformAdminId, { name: "Isolated Place", slug, ownerStaffUserId: owner.id });

    expect(result.restaurant_id).not.toBe(existing.restaurantId);

    const [existingStaffCount] = await sql`SELECT count(*)::int AS count FROM restaurant_staff WHERE restaurant_id = ${existing.restaurantId}`;
    expect(existingStaffCount!.count).toBe(2); // unchanged: fixture's own admin + staff

    const ownerAtExisting = await sql`SELECT id FROM restaurant_staff WHERE restaurant_id = ${existing.restaurantId} AND staff_user_id = ${owner.id}`;
    expect(ownerAtExisting).toHaveLength(0); // the new owner is not staff anywhere else
  });
});

describe("provision_restaurant — idempotency and concurrency", () => {
  it("retrying with the same slug returns the same restaurant, created: false, and does not duplicate any row", async () => {
    const platformAdminId = await createPlatformAdmin();
    const owner = await createOwnerCandidate("retry");
    const slug = uniqueKey("slug-retry");

    const first = await callProvisionRestaurant(platformAdminId, { name: "Retry Place", slug, ownerStaffUserId: owner.id });
    const second = await callProvisionRestaurant(platformAdminId, { name: "Retry Place", slug, ownerStaffUserId: owner.id });

    expect(second.restaurant_id).toBe(first.restaurant_id);
    expect(second.created).toBe(false);

    const [restaurantCount] = await sql`SELECT count(*)::int AS count FROM restaurants WHERE slug = ${slug}`;
    expect(restaurantCount!.count).toBe(1);

    const [settingsCount] = await sql`SELECT count(*)::int AS count FROM restaurant_settings WHERE restaurant_id = ${first.restaurant_id}`;
    expect(settingsCount!.count).toBe(1);

    const [membershipCount] = await sql`SELECT count(*)::int AS count FROM restaurant_staff WHERE restaurant_id = ${first.restaurant_id}`;
    expect(membershipCount!.count).toBe(1);
  });

  it("retrying with a DIFFERENT owner grants that owner too, as a co-admin, without reassigning owner_staff_user_id away from the first", async () => {
    const platformAdminId = await createPlatformAdmin();
    const firstOwner = await createOwnerCandidate("coowner1");
    const secondOwner = await createOwnerCandidate("coowner2");
    const slug = uniqueKey("slug-coowner");

    const first = await callProvisionRestaurant(platformAdminId, { name: "Co Place", slug, ownerStaffUserId: firstOwner.id });
    await callProvisionRestaurant(platformAdminId, { name: "Co Place", slug, ownerStaffUserId: secondOwner.id });

    const admins = await sql`SELECT staff_user_id, role FROM restaurant_staff WHERE restaurant_id = ${first.restaurant_id}`;
    expect(admins).toHaveLength(2);
    expect(admins.every((a) => a.role === "admin")).toBe(true);

    const [restaurant] = await sql`SELECT owner_staff_user_id FROM restaurants WHERE id = ${first.restaurant_id}`;
    expect(restaurant!.owner_staff_user_id).toBe(firstOwner.id); // sticky to whoever first activated it
  });

  it("two concurrent provisioning calls with the same slug (double-click) result in exactly one restaurant, not two", async () => {
    const platformAdminId = await createPlatformAdmin();
    const owner = await createOwnerCandidate("race");
    const slug = uniqueKey("slug-race");

    const results = await Promise.all([
      callProvisionRestaurant(platformAdminId, { name: "Race Place", slug, ownerStaffUserId: owner.id }),
      callProvisionRestaurant(platformAdminId, { name: "Race Place", slug, ownerStaffUserId: owner.id }),
    ]);

    expect(results[0]!.restaurant_id).toBe(results[1]!.restaurant_id);
    expect(results.map((r) => r.created).sort()).toEqual([false, true]); // exactly one call actually created it

    const [countRow] = await sql`SELECT count(*)::int AS count FROM restaurants WHERE slug = ${slug}`;
    expect(countRow!.count).toBe(1);
  });
});

describe("provision_restaurant — failure safety", () => {
  it("a failed provisioning attempt (owner id with no matching staff_users row) leaves no restaurant row at all — full rollback, never a partially active one", async () => {
    const platformAdminId = await createPlatformAdmin();
    const bogusOwnerId = crypto.randomUUID(); // deliberately never inserted into staff_users
    const slug = uniqueKey("slug-failure");

    await expect(
      callProvisionRestaurant(platformAdminId, { name: "Should Not Exist", slug, ownerStaffUserId: bogusOwnerId }),
    ).rejects.toThrow(/foreign key|violates/i);

    const restaurantRows = await sql`SELECT id FROM restaurants WHERE slug = ${slug}`;
    expect(restaurantRows).toHaveLength(0);
  });

  it("retrying after a failure with a valid owner succeeds normally (the failed attempt left nothing to conflict with)", async () => {
    const platformAdminId = await createPlatformAdmin();
    const bogusOwnerId = crypto.randomUUID();
    const slug = uniqueKey("slug-retry-after-failure");

    await expect(
      callProvisionRestaurant(platformAdminId, { name: "Retry After Failure", slug, ownerStaffUserId: bogusOwnerId }),
    ).rejects.toThrow(/foreign key|violates/i);

    const realOwner = await createOwnerCandidate("retryafterfailure");
    const result = await callProvisionRestaurant(platformAdminId, { name: "Retry After Failure", slug, ownerStaffUserId: realOwner.id });

    expect(result.created).toBe(true);
    const [countRow] = await sql`SELECT count(*)::int AS count FROM restaurants WHERE slug = ${slug}`;
    expect(countRow!.count).toBe(1);
  });
});

describe("provision_restaurant — existing restaurant creation is unaffected", () => {
  it("a restaurant created via the old direct-insert path (db/seed/seed.mjs's own pattern) still defaults to active and works normally", async () => {
    const fx = await createTestRestaurant(); // uses the same raw INSERT pattern seed.mjs uses — unchanged by this phase
    const [row] = await sql`SELECT status FROM restaurants WHERE id = ${fx.restaurantId}`;
    expect(row!.status).toBe("active");
  });
});
