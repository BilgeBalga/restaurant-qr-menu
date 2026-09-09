import postgres from "postgres";

/**
 * Connects as the Postgres superuser (matches the local test harness —
 * see tests/integration/harness/). Fixture setup below runs unrestricted
 * on this connection; role-scoped assertions use `withRole`, which
 * reserves a dedicated session so SET ROLE / the auth.uid() GUC never
 * leaks across tests sharing the pool.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/tableside_test";

export const sql = postgres(TEST_DATABASE_URL, { max: 10 });

export type PgRole = "anon" | "authenticated" | "service_role";

/**
 * Runs `fn` on a dedicated reserved connection with ROLE and the
 * auth.uid()-backing GUC set for its duration, then resets both before
 * releasing the connection back to the pool. `staffUserId: null` leaves
 * auth.uid() NULL, matching an anon/unauthenticated caller.
 */
export async function withRole<T>(
  role: PgRole,
  staffUserId: string | null,
  fn: (conn: postgres.ReservedSql) => Promise<T>,
): Promise<T> {
  const conn = await sql.reserve();
  try {
    await conn.unsafe(`SET ROLE ${role}`);
    await conn`SELECT set_config('request.jwt.claim.sub', ${staffUserId ?? ""}, false)`;
    return await fn(conn);
  } finally {
    await conn.unsafe("RESET ROLE");
    conn.release();
  }
}

let restaurantCounter = 0;

/** A full, self-contained fixture: restaurant + settings + table + QR token + menu + admin/staff logins. */
export async function createTestRestaurant(overrides?: { taxRate?: string; serviceChargeRate?: string }) {
  restaurantCounter += 1;
  const suffix = `${Date.now()}_${restaurantCounter}`;

  const [restaurant] = await sql`
    INSERT INTO restaurants (name, slug)
    VALUES (${"Test Restaurant " + suffix}, ${"test-restaurant-" + suffix})
    RETURNING id
  `;
  const restaurantId: string = restaurant!.id;

  await sql`
    INSERT INTO restaurant_settings (restaurant_id, tax_rate, service_charge_rate, order_number_prefix)
    VALUES (${restaurantId}, ${overrides?.taxRate ?? "0"}, ${overrides?.serviceChargeRate ?? "0"}, 'T')
  `;

  const [menu] = await sql`
    INSERT INTO menus (restaurant_id, name) VALUES (${restaurantId}, 'Main Menu') RETURNING id
  `;
  const [category] = await sql`
    INSERT INTO categories (restaurant_id, menu_id, name, slug)
    VALUES (${restaurantId}, ${menu!.id}, 'Mains', ${"mains-" + suffix})
    RETURNING id
  `;
  const [menuItem] = await sql`
    INSERT INTO menu_items (restaurant_id, category_id, name, slug, price_cents)
    VALUES (${restaurantId}, ${category!.id}, 'Classic Burger', ${"classic-burger-" + suffix}, 1200)
    RETURNING id
  `;
  const [optionGroup] = await sql`
    INSERT INTO option_groups (restaurant_id, menu_item_id, name, selection_type, min_select, max_select)
    VALUES (${restaurantId}, ${menuItem!.id}, 'Extras', 'multiple', 0, 2)
    RETURNING id
  `;
  const [optionChoice] = await sql`
    INSERT INTO option_choices (restaurant_id, option_group_id, name, price_delta_cents)
    VALUES (${restaurantId}, ${optionGroup!.id}, 'Extra cheese', 150)
    RETURNING id
  `;

  const [table] = await sql`
    INSERT INTO tables (restaurant_id, label) VALUES (${restaurantId}, ${"Table " + suffix}) RETURNING id
  `;
  const token = `test-token-${suffix}-${Math.random().toString(36).slice(2)}`;
  await sql`
    INSERT INTO table_qr_tokens (restaurant_id, table_id, token) VALUES (${restaurantId}, ${table!.id}, ${token})
  `;

  const adminId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  await sql`INSERT INTO auth.users (id, email) VALUES (${adminId}, ${"admin-" + suffix + "@example.com"})`;
  await sql`INSERT INTO auth.users (id, email) VALUES (${staffId}, ${"staff-" + suffix + "@example.com"})`;
  // handle_new_auth_user() already mirrors these into staff_users via trigger.
  await sql`
    INSERT INTO restaurant_staff (restaurant_id, staff_user_id, role) VALUES (${restaurantId}, ${adminId}, 'admin')
  `;
  await sql`
    INSERT INTO restaurant_staff (restaurant_id, staff_user_id, role) VALUES (${restaurantId}, ${staffId}, 'staff')
  `;

  return {
    restaurantId,
    tableId: table!.id as string,
    qrToken: token,
    menuItemId: menuItem!.id as string,
    optionGroupId: optionGroup!.id as string,
    optionChoiceId: optionChoice!.id as string,
    categoryId: category!.id as string,
    adminId,
    staffId,
  };
}

export async function closeTestDb() {
  await sql.end({ timeout: 5 });
}
