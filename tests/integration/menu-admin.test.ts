import { describe, expect, it } from "vitest";
import { createTestRestaurant, sql, withRole } from "./db";

/**
 * RLS/DB layer behind app/actions/menuAdmin.ts. create-order.test.ts
 * already proves price/option snapshotting and availability enforcement
 * for the pre-seeded fixture item; this file is about the admin CRUD
 * paths themselves — categories, menu_items writes, option_groups/
 * option_choices, and the one thing RLS does NOT check on its own
 * (menu_items.category_id actually belonging to the same restaurant),
 * which is exactly why menuAdmin.ts adds its own belongs-to-restaurant
 * checks before every create/update that touches a foreign id.
 *
 * "Non-admin staff CAN toggle is_available but CANNOT change price" is
 * already covered by rls-permissions.test.ts — not repeated here.
 */

describe("menu admin — categories (§11 menu:write, admin-only)", () => {
  it("admin can create, rename, deactivate, and hard-delete an empty category", async () => {
    const fx = await createTestRestaurant();

    const [menu] = await sql`SELECT id FROM menus WHERE restaurant_id = ${fx.restaurantId} LIMIT 1`;

    const created = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        INSERT INTO categories (restaurant_id, menu_id, name, slug, sort_order)
        VALUES (${fx.restaurantId}::uuid, ${menu!.id}::uuid, 'Desserts', 'desserts', 0)
        RETURNING id, name, is_active
      `;
    });
    expect(created).toHaveLength(1);
    const categoryId = created[0]!.id as string;

    const renamed = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE categories SET name = 'Sweets' WHERE id = ${categoryId}::uuid RETURNING name`;
    });
    expect(renamed[0]?.name).toBe("Sweets");

    const deactivated = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE categories SET is_active = false WHERE id = ${categoryId}::uuid RETURNING is_active`;
    });
    expect(deactivated[0]?.is_active).toBe(false);

    const deleted = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`DELETE FROM categories WHERE id = ${categoryId}::uuid RETURNING id`;
    });
    expect(deleted).toHaveLength(1);
  });

  it("non-admin staff cannot create, update, or delete a category — RLS matches zero rows", async () => {
    const fx = await createTestRestaurant();
    const [menu] = await sql`SELECT id FROM menus WHERE restaurant_id = ${fx.restaurantId} LIMIT 1`;

    await expect(
      withRole("authenticated", fx.staffId, async (conn) => {
        return conn`
          INSERT INTO categories (restaurant_id, menu_id, name, slug, sort_order)
          VALUES (${fx.restaurantId}::uuid, ${menu!.id}::uuid, 'Desserts', 'desserts', 0)
        `;
      }),
    ).rejects.toThrow();

    const renamed = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`UPDATE categories SET name = 'Hijacked' WHERE id = ${fx.categoryId}::uuid RETURNING id`;
    });
    expect(renamed).toHaveLength(0);

    const deleted = await withRole("authenticated", fx.staffId, async (conn) => {
      return conn`DELETE FROM categories WHERE id = ${fx.categoryId}::uuid RETURNING id`;
    });
    expect(deleted).toHaveLength(0);
  });

  it("a category with menu items cannot be hard-deleted (ON DELETE RESTRICT) — the friendly-error path menuAdmin.ts catches", async () => {
    const fx = await createTestRestaurant();

    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`DELETE FROM categories WHERE id = ${fx.categoryId}::uuid`;
      }),
    ).rejects.toThrow(/violates foreign key constraint/);
  });

  it("category slugs are unique per restaurant — a duplicate insert fails with a unique violation, which menuAdmin.ts retries once with a suffix", async () => {
    const fx = await createTestRestaurant();
    const [menu] = await sql`SELECT id FROM menus WHERE restaurant_id = ${fx.restaurantId} LIMIT 1`;
    const [existing] = await sql`SELECT slug FROM categories WHERE id = ${fx.categoryId}`;

    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`
          INSERT INTO categories (restaurant_id, menu_id, name, slug, sort_order)
          VALUES (${fx.restaurantId}::uuid, ${menu!.id}::uuid, 'Mains 2', ${existing!.slug}, 1)
        `;
      }),
    ).rejects.toThrow(/duplicate key value/);
  });
});

describe("menu admin — menu items: cross-tenant category safety (not enforced by RLS itself)", () => {
  it("RLS alone does NOT stop an admin of restaurant A from inserting a menu_item whose category_id belongs to restaurant B — this is why menuAdmin.ts's categoryBelongsToRestaurant() check exists", async () => {
    const a = await createTestRestaurant();
    const b = await createTestRestaurant();

    // restaurant_id says A, but category_id points at B's category — RLS's
    // WITH CHECK only looks at NEW.restaurant_id, never cross-references
    // category_id's own restaurant, so this INSERT succeeds at the DB layer.
    const inserted = await withRole("authenticated", a.adminId, async (conn) => {
      return conn`
        INSERT INTO menu_items (restaurant_id, category_id, name, slug, price_cents)
        VALUES (${a.restaurantId}::uuid, ${b.categoryId}::uuid, 'Cross-tenant item', 'cross-tenant-item', 500)
        RETURNING id
      `;
    });
    expect(inserted).toHaveLength(1);
  });
});

describe("menu admin — option groups / option choices (§11 menu:write, admin-only)", () => {
  it("admin can create an option group and a choice on it; non-admin cannot", async () => {
    const fx = await createTestRestaurant();

    const group = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        INSERT INTO option_groups (restaurant_id, menu_item_id, name, selection_type, is_required, min_select, max_select, sort_order)
        VALUES (${fx.restaurantId}::uuid, ${fx.menuItemId}::uuid, 'Spice level', 'single', true, 1, 1, 0)
        RETURNING id
      `;
    });
    expect(group).toHaveLength(1);
    const groupId = group[0]!.id as string;

    const choice = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        INSERT INTO option_choices (restaurant_id, option_group_id, name, price_delta_cents)
        VALUES (${fx.restaurantId}::uuid, ${groupId}::uuid, 'Hot', 0)
        RETURNING id
      `;
    });
    expect(choice).toHaveLength(1);

    await expect(
      withRole("authenticated", fx.staffId, async (conn) => {
        return conn`
          INSERT INTO option_groups (restaurant_id, menu_item_id, name, selection_type, min_select, max_select)
          VALUES (${fx.restaurantId}::uuid, ${fx.menuItemId}::uuid, 'Should fail', 'single', 0, 1)
        `;
      }),
    ).rejects.toThrow();
  });

  it("the min<=max CHECK constraint rejects an invalid option group even for admin", async () => {
    const fx = await createTestRestaurant();

    await expect(
      withRole("authenticated", fx.adminId, async (conn) => {
        return conn`
          INSERT INTO option_groups (restaurant_id, menu_item_id, name, selection_type, min_select, max_select)
          VALUES (${fx.restaurantId}::uuid, ${fx.menuItemId}::uuid, 'Broken', 'single', 3, 1)
        `;
      }),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("deleting an option group cascades to delete its choices (ON DELETE CASCADE — always safe to hard-delete)", async () => {
    const fx = await createTestRestaurant();

    const [group] = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        INSERT INTO option_groups (restaurant_id, menu_item_id, name, selection_type, min_select, max_select)
        VALUES (${fx.restaurantId}::uuid, ${fx.menuItemId}::uuid, 'Toppings', 'multiple', 0, 3)
        RETURNING id
      `;
    });
    const [choice] = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        INSERT INTO option_choices (restaurant_id, option_group_id, name, price_delta_cents)
        VALUES (${fx.restaurantId}::uuid, ${group!.id}::uuid, 'Bacon', 200)
        RETURNING id
      `;
    });

    await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`DELETE FROM option_groups WHERE id = ${group!.id}::uuid`;
    });

    const remainingChoice = await sql`SELECT id FROM option_choices WHERE id = ${choice!.id}`;
    expect(remainingChoice).toHaveLength(0);
  });

  it("option_choices have no live FK guard — a choice already referenced by a historical order can still be hard-deleted, because order_item_options snapshots instead", async () => {
    const fx = await createTestRestaurant();

    await withRole("anon", null, async (conn) => {
      return conn`
        SELECT public.create_order(
          ${fx.tableId}::uuid,
          ${conn.json([{ menu_item_id: fx.menuItemId, quantity: 1, option_choice_ids: [fx.optionChoiceId] }])},
          NULL,
          ${"idem-" + crypto.randomUUID()}
        )
      `;
    });

    const deleted = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`DELETE FROM option_choices WHERE id = ${fx.optionChoiceId}::uuid RETURNING id`;
    });
    expect(deleted).toHaveLength(1);
  });
});

describe("menu admin — end-to-end: an admin-managed item still orders and snapshots correctly (regression safety)", () => {
  it("a freshly admin-created item + option choice can be ordered immediately, and the order snapshots the admin-set name/price even after the admin later changes them", async () => {
    const fx = await createTestRestaurant();

    const [item] = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        INSERT INTO menu_items (restaurant_id, category_id, name, slug, price_cents, is_featured, sort_order)
        VALUES (${fx.restaurantId}::uuid, ${fx.categoryId}::uuid, 'Truffle Fries', 'truffle-fries', 850, true, 1)
        RETURNING id
      `;
    });
    const [group] = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        INSERT INTO option_groups (restaurant_id, menu_item_id, name, selection_type, min_select, max_select)
        VALUES (${fx.restaurantId}::uuid, ${item!.id}::uuid, 'Sauce', 'single', 0, 1)
        RETURNING id
      `;
    });
    const [choice] = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        INSERT INTO option_choices (restaurant_id, option_group_id, name, price_delta_cents)
        VALUES (${fx.restaurantId}::uuid, ${group!.id}::uuid, 'Truffle aioli', 100)
        RETURNING id
      `;
    });

    const order = await withRole("anon", null, async (conn) => {
      const [row] = await conn`
        SELECT public.create_order(
          ${fx.tableId}::uuid,
          ${conn.json([{ menu_item_id: item!.id, quantity: 2, option_choice_ids: [choice!.id] }])},
          NULL,
          ${"idem-" + crypto.randomUUID()}
        ) AS result
      `;
      return row!.result as { order_id: string; total_cents: number };
    });

    // 2 * (850 + 100) = 1900, no tax/service charge configured on this fixture.
    expect(order.total_cents).toBe(1900);

    // Admin changes the price/name AFTER the order — the snapshot must not move.
    await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`UPDATE menu_items SET name = 'Truffle Fries (Large)', price_cents = 1500 WHERE id = ${item!.id}::uuid`;
    });

    const [orderItem] = await sql`
      SELECT name_snapshot, unit_price_cents_snapshot FROM order_items WHERE order_id = ${order.order_id}
    `;
    expect(orderItem!.name_snapshot).toBe("Truffle Fries");
    expect(orderItem!.unit_price_cents_snapshot).toBe(850);

    const [orderOption] = await sql`
      SELECT choice_name_snapshot, price_delta_cents_snapshot FROM order_item_options
      WHERE order_item_id = (SELECT id FROM order_items WHERE order_id = ${order.order_id})
    `;
    expect(orderOption!.choice_name_snapshot).toBe("Truffle aioli");
    expect(orderOption!.price_delta_cents_snapshot).toBe(100);
  });

  it("an admin-deactivated item (is_available=false) cannot be ordered, mirroring the pre-seeded fixture's own behavior", async () => {
    const fx = await createTestRestaurant();

    const [item] = await withRole("authenticated", fx.adminId, async (conn) => {
      return conn`
        INSERT INTO menu_items (restaurant_id, category_id, name, slug, price_cents, is_available)
        VALUES (${fx.restaurantId}::uuid, ${fx.categoryId}::uuid, 'Soup of the Day', 'soup-of-the-day', 600, false)
        RETURNING id
      `;
    });

    await expect(
      withRole("anon", null, async (conn) => {
        return conn`
          SELECT public.create_order(
            ${fx.tableId}::uuid,
            ${conn.json([{ menu_item_id: item!.id, quantity: 1 }])},
            NULL,
            ${"idem-" + crypto.randomUUID()}
          )
        `;
      }),
    ).rejects.toThrow(/MENU_ITEM_UNAVAILABLE/);
  });
});
