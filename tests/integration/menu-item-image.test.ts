import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, uniqueKey, withRole } from "./db";

/**
 * RLS/DB layer behind app/actions/menuAdmin.ts's uploadMenuItemImage /
 * deleteMenuItemImage — specifically the menu_items.image_url column,
 * which those actions write exactly like updateMenuItem already does
 * (same table, same admin-only trigger, same RLS).
 *
 * What this file deliberately does NOT test: the actual Supabase Storage
 * upload/remove calls. The local integration test harness
 * (tests/integration/harness/) is a bare Postgres instance with no
 * `storage` schema and no real GoTrue/Storage server — see
 * db/sql/policies/menu_images_storage.sql's own note, and
 * tests/unit/auth/adminUsers.test.ts for the same reasoning already
 * applied to the Supabase Auth Admin API in Staff Management. Faking
 * Storage's behavior here would not be an integration test of anything
 * real. The path-generation/validation logic that WOULD feed those calls
 * is unit-tested in tests/unit/storage/menuImages.test.ts and
 * tests/unit/validation/menu.test.ts instead.
 */

describe("menu item image — admin can update image_url for their own restaurant", () => {
  it("admin can set, replace, and clear image_url on their own menu item", async () => {
    const fx = await createTestRestaurant();
    const url1 = `https://project-ref.supabase.co/storage/v1/object/public/menu-images/${fx.restaurantId}/${fx.menuItemId}/${uniqueKey("a")}.jpg`;
    const url2 = `https://project-ref.supabase.co/storage/v1/object/public/menu-images/${fx.restaurantId}/${fx.menuItemId}/${uniqueKey("b")}.jpg`;

    const set = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE menu_items SET image_url = ${url1} WHERE id = ${fx.menuItemId}::uuid RETURNING image_url`;
    });
    expect(set[0]?.image_url).toBe(url1);

    const replaced = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE menu_items SET image_url = ${url2} WHERE id = ${fx.menuItemId}::uuid RETURNING image_url`;
    });
    expect(replaced[0]?.image_url).toBe(url2);

    const cleared = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE menu_items SET image_url = NULL WHERE id = ${fx.menuItemId}::uuid RETURNING image_url`;
    });
    expect(cleared[0]?.image_url).toBeNull();
  });
});

describe("menu item image — non-admin staff cannot update image_url", () => {
  it("is rejected by the enforce_menu_item_update_scope trigger, exactly like any other admin-only column", async () => {
    const fx = await createTestRestaurant();
    const url = `https://project-ref.supabase.co/storage/v1/object/public/menu-images/${fx.restaurantId}/${fx.menuItemId}/${uniqueKey("c")}.jpg`;

    await expect(
      withRole("authenticated", fx.staffId, async (conn) => {
        return conn`UPDATE menu_items SET image_url = ${url} WHERE id = ${fx.menuItemId}::uuid`;
      }),
    ).rejects.toThrow(/FORBIDDEN: only admin may edit this field/);

    const [row] = await sql`SELECT image_url FROM menu_items WHERE id = ${fx.menuItemId}`;
    expect(row!.image_url).toBeNull();
  });

  it("non-admin staff toggling is_available in the SAME statement is still rejected once image_url is also touched", async () => {
    const fx = await createTestRestaurant();
    const url = `https://project-ref.supabase.co/storage/v1/object/public/menu-images/${fx.restaurantId}/${fx.menuItemId}/${uniqueKey("d")}.jpg`;

    await expect(
      withRole("authenticated", fx.staffId, async (conn) => {
        return conn`UPDATE menu_items SET is_available = false, image_url = ${url} WHERE id = ${fx.menuItemId}::uuid`;
      }),
    ).rejects.toThrow(/FORBIDDEN/);
  });
});

describe("menu item image — tenant isolation", () => {
  it("an admin of restaurant A cannot set image_url on restaurant B's menu item", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    const url = `https://project-ref.supabase.co/storage/v1/object/public/menu-images/${b.restaurantId}/${b.menuItemId}/${uniqueKey("e")}.jpg`;

    const updated = await withRole("authenticated", a.adminId, async (conn) => {
      return conn`UPDATE menu_items SET image_url = ${url} WHERE id = ${b.menuItemId}::uuid RETURNING id`;
    });
    expect(updated).toHaveLength(0); // RLS (menu_items_update_staff, is_staff_of) matches zero rows, not an error

    const [row] = await sql`SELECT image_url FROM menu_items WHERE id = ${b.menuItemId}`;
    expect(row!.image_url).toBeNull();
  });

  it("an admin of restaurant A cannot read restaurant B's menu item at all (staff SELECT), image_url included", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();
    const url = `https://project-ref.supabase.co/storage/v1/object/public/menu-images/${b.restaurantId}/${b.menuItemId}/${uniqueKey("f")}.jpg`;
    // Set via B's own admin — enforce_menu_item_update_scope fires for every
    // caller (including a raw superuser connection with no auth.uid()), so
    // fixture setup for an admin-only column must go through withRole too.
    await withRole("authenticated", b.adminId, async (conn) => {
      return conn`UPDATE menu_items SET image_url = ${url} WHERE id = ${b.menuItemId}::uuid`;
    });

    const visibleToA = await withRole("authenticated", a.adminId, async (conn) => {
      return conn`SELECT id, image_url FROM menu_items WHERE id = ${b.menuItemId}::uuid`;
    });
    expect(visibleToA).toHaveLength(0);
  });
});

describe("menu item image — existing anonymous customer access is unaffected", () => {
  it("anon sees image_url for an active item, exactly as it already sees name/price", async () => {
    const fx = await createTestRestaurant();
    const url = `https://project-ref.supabase.co/storage/v1/object/public/menu-images/${fx.restaurantId}/${fx.menuItemId}/${uniqueKey("g")}.jpg`;
    await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE menu_items SET image_url = ${url} WHERE id = ${fx.menuItemId}::uuid`;
    });

    const rows = await withRole("anon", null, async (conn) => {
      return conn`SELECT image_url FROM menu_items WHERE id = ${fx.menuItemId}::uuid`;
    });
    expect(rows[0]?.image_url).toBe(url);
  });

  it("anon sees null image_url for an item that has never had a photo uploaded — no broken image, just no image", async () => {
    const fx = await createTestRestaurant();

    const rows = await withRole("anon", null, async (conn) => {
      return conn`SELECT image_url FROM menu_items WHERE id = ${fx.menuItemId}::uuid`;
    });
    expect(rows[0]?.image_url).toBeNull();
  });

  it("anon cannot see image_url (or the row at all) for a soft-deleted (is_active=false) item — unchanged by this feature", async () => {
    const fx = await createTestRestaurant();
    const url = `https://project-ref.supabase.co/storage/v1/object/public/menu-images/${fx.restaurantId}/${fx.menuItemId}/${uniqueKey("h")}.jpg`;
    await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE menu_items SET image_url = ${url}, is_active = false WHERE id = ${fx.menuItemId}::uuid`;
    });

    const rows = await withRole("anon", null, async (conn) => {
      return conn`SELECT id FROM menu_items WHERE id = ${fx.menuItemId}::uuid`;
    });
    expect(rows).toHaveLength(0);
  });
});
