#!/usr/bin/env node
/**
 * Development/demo seed — deliberately separate from any production
 * tooling. Reads SEED_DATABASE_URL (defaults to the local test harness
 * from tests/integration/harness/), NEVER the app's own DATABASE_URL —
 * so running `npm run db:seed` can never touch the real Supabase project
 * by accident. Pointing this at anything else requires an explicit,
 * deliberate override plus a second confirmation flag (see below).
 *
 * Idempotent: keyed on a fixed slug, skips (reports, doesn't duplicate
 * or overwrite) if the demo restaurant already exists.
 */
import postgres from "postgres";

const LOCAL_DEFAULT = "postgres://postgres@127.0.0.1:54329/tableside_test";
const targetUrl = process.env.SEED_DATABASE_URL ?? LOCAL_DEFAULT;

const looksLocal = /127\.0\.0\.1|localhost/.test(targetUrl);
if (!looksLocal && process.env.SEED_ALLOW_REMOTE !== "true") {
  console.error(
    "Refusing to seed a non-local database.\n" +
      `Target: ${targetUrl.replace(/:[^:@]+@/, ":***@")}\n` +
      "If this is genuinely intentional, re-run with SEED_ALLOW_REMOTE=true.\n" +
      "This script never reads DATABASE_URL — only SEED_DATABASE_URL — precisely so seeding the real project always requires a separate, deliberate step.",
  );
  process.exit(1);
}

const sql = postgres(targetUrl, { max: 1 });

const RESTAURANT_SLUG = "demo-bistro";

async function main() {
  const [existing] = await sql`SELECT id FROM restaurants WHERE slug = ${RESTAURANT_SLUG}`;
  if (existing) {
    console.log(`Demo restaurant already exists (id=${existing.id}) — skipping, not duplicating.`);
    await sql.end();
    return;
  }

  const [restaurant] = await sql`
    INSERT INTO restaurants (name, slug, timezone, currency)
    VALUES ('The Ivory Bistro', ${RESTAURANT_SLUG}, 'Europe/Berlin', 'EUR')
    RETURNING id
  `;
  const restaurantId = restaurant.id;

  await sql`
    INSERT INTO restaurant_settings (restaurant_id, tax_rate, service_charge_rate, order_number_prefix)
    VALUES (${restaurantId}, 0.19, 0.00, 'B')
  `;

  const [menu] = await sql`INSERT INTO menus (restaurant_id, name) VALUES (${restaurantId}, 'Main Menu') RETURNING id`;

  const [starters] = await sql`
    INSERT INTO categories (restaurant_id, menu_id, name, slug, sort_order) VALUES (${restaurantId}, ${menu.id}, 'Starters', 'starters', 0) RETURNING id
  `;
  const [mains] = await sql`
    INSERT INTO categories (restaurant_id, menu_id, name, slug, sort_order) VALUES (${restaurantId}, ${menu.id}, 'Mains', 'mains', 1) RETURNING id
  `;
  const [drinks] = await sql`
    INSERT INTO categories (restaurant_id, menu_id, name, slug, sort_order) VALUES (${restaurantId}, ${menu.id}, 'Drinks', 'drinks', 2) RETURNING id
  `;

  const items = [
    {
      category: starters.id,
      name: "Burrata & Heirloom Tomato",
      slug: "burrata-heirloom-tomato",
      description: "Creamy burrata, heirloom tomatoes, basil oil, aged balsamic.",
      short: "Burrata, heirloom tomato, basil oil",
      price: 1400,
      ingredients: ["burrata", "heirloom tomato", "basil", "olive oil", "balsamic"],
      allergens: ["dairy"],
      featured: true,
      available: true,
      groups: [],
    },
    {
      category: starters.id,
      name: "Charred Octopus",
      slug: "charred-octopus",
      description: "Spanish octopus, smoked paprika, confit potato, salsa verde.",
      short: "Octopus, smoked paprika, confit potato",
      price: 1800,
      ingredients: ["octopus", "potato", "paprika", "parsley", "garlic"],
      allergens: ["shellfish"],
      featured: false,
      available: false,
      groups: [],
    },
    {
      category: mains.id,
      name: "Classic Burger",
      slug: "classic-burger",
      description: "Dry-aged beef, aged cheddar, house pickles, bronze bun.",
      short: "Dry-aged beef, aged cheddar, house pickles",
      price: 1900,
      ingredients: ["beef", "cheddar", "pickles", "brioche bun"],
      allergens: ["gluten", "dairy"],
      featured: true,
      available: true,
      groups: [
        {
          name: "Size",
          selectionType: "single",
          required: true,
          min: 1,
          max: 1,
          choices: [
            { name: "Regular", delta: 0 },
            { name: "Large (+150g)", delta: 400 },
          ],
        },
        {
          name: "Extras",
          selectionType: "multiple",
          required: false,
          min: 0,
          max: 3,
          choices: [
            { name: "Extra cheddar", delta: 150 },
            { name: "Bacon", delta: 250 },
            { name: "Fried egg", delta: 200 },
          ],
        },
      ],
    },
    {
      category: mains.id,
      name: "Wild Mushroom Risotto",
      slug: "wild-mushroom-risotto",
      description: "Carnaroli rice, wild mushrooms, aged parmesan, truffle oil.",
      short: "Carnaroli rice, wild mushrooms, truffle oil",
      price: 2100,
      ingredients: ["carnaroli rice", "mushroom", "parmesan", "truffle oil"],
      allergens: ["dairy"],
      featured: false,
      available: true,
      groups: [],
    },
    {
      category: drinks.id,
      name: "Cola",
      slug: "cola",
      description: "330ml bottle.",
      short: "330ml bottle",
      price: 450,
      ingredients: [],
      allergens: [],
      featured: false,
      available: true,
      groups: [],
    },
    {
      category: drinks.id,
      name: "House Red Wine",
      slug: "house-red-wine",
      description: "175ml glass, Rioja Crianza.",
      short: "175ml glass, Rioja Crianza",
      price: 850,
      ingredients: [],
      allergens: ["sulphites"],
      featured: false,
      available: true,
      groups: [],
    },
  ];

  for (const [index, item] of items.entries()) {
    const [row] = await sql`
      INSERT INTO menu_items (
        restaurant_id, category_id, name, slug, description, short_description,
        price_cents, ingredients, allergens, is_available, is_featured, sort_order
      ) VALUES (
        ${restaurantId}, ${item.category}, ${item.name}, ${item.slug}, ${item.description}, ${item.short},
        ${item.price}, ${item.ingredients}, ${item.allergens}, ${item.available}, ${item.featured}, ${index}
      ) RETURNING id
    `;

    for (const [groupIndex, group] of item.groups.entries()) {
      const [groupRow] = await sql`
        INSERT INTO option_groups (restaurant_id, menu_item_id, name, selection_type, is_required, min_select, max_select, sort_order)
        VALUES (${restaurantId}, ${row.id}, ${group.name}, ${group.selectionType}, ${group.required}, ${group.min}, ${group.max}, ${groupIndex})
        RETURNING id
      `;
      for (const [choiceIndex, choice] of group.choices.entries()) {
        await sql`
          INSERT INTO option_choices (restaurant_id, option_group_id, name, price_delta_cents, sort_order)
          VALUES (${restaurantId}, ${groupRow.id}, ${choice.name}, ${choice.delta}, ${choiceIndex})
        `;
      }
    }
  }

  const tableLabels = ["1", "2", "3", "4", "Patio 1", "Patio 2"];
  const tokens = [];
  for (const label of tableLabels) {
    const [table] = await sql`INSERT INTO tables (restaurant_id, label) VALUES (${restaurantId}, ${label}) RETURNING id`;
    const token = `demo-${RESTAURANT_SLUG}-${label.toLowerCase().replace(/\s+/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;
    await sql`INSERT INTO table_qr_tokens (restaurant_id, table_id, token) VALUES (${restaurantId}, ${table.id}, ${token})`;
    tokens.push({ label, token });
  }

  console.log(`Seeded restaurant "${RESTAURANT_SLUG}" (id=${restaurantId}) with ${items.length} menu items and ${tableLabels.length} tables.`);
  console.log("Table QR tokens (for local /t/[token] testing):");
  for (const { label, token } of tokens) {
    console.log(`  Table ${label}: /t/${token}`);
  }
  console.log(
    "\nNo staff/admin auth.users row is created here — Supabase Auth accounts are provisioned separately (Settings → Authentication in the dashboard, or supabase.auth.admin.createUser), then linked via a restaurant_staff row pointing at that user's id and this restaurant_id.",
  );

  await sql.end();
}

main().catch(async (error) => {
  console.error(error);
  await sql.end();
  process.exit(1);
});
