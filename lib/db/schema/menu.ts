import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { restaurants } from "./core";
import { optionSelectionTypeEnum } from "./enums";

/**
 * Menu hierarchy (§4/§7 of the brief): restaurant → menu → categories →
 * items → option groups → option choices. Variants and add-ons are both
 * modeled as option_groups/option_choices (§7's "why options replace
 * separate variants/add-ons tables" decision) — one editor, one pricing
 * path, instead of four tables.
 */

export const menus = pgTable("menus", {
  id: uuid("id").primaryKey().defaultRandom(),
  restaurantId: uuid("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    menuId: uuid("menu_id")
      .notNull()
      .references(() => menus.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [uniqueIndex("categories_restaurant_slug_unique").on(table.restaurantId, table.slug)],
);

/**
 * `isActive` (soft-delete, hidden entirely) is distinct from
 * `isAvailable` (86'd/sold-out, shown disabled) — §19's business rule
 * needs both, even though §7's original column list only wrote out
 * `is_available`. Added here to make the schema actually match the
 * documented behavior ("unavailable items render visibly disabled, never
 * hidden" vs. "delete only if never ordered, otherwise disable").
 */
export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    shortDescription: text("short_description"),
    priceCents: integer("price_cents").notNull(),
    imageUrl: text("image_url"),
    ingredients: text("ingredients").array(),
    allergens: text("allergens").array(),
    prepTimeMinutes: integer("prep_time_minutes"),
    isActive: boolean("is_active").notNull().default(true),
    isAvailable: boolean("is_available").notNull().default(true),
    isFeatured: boolean("is_featured").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("menu_items_restaurant_slug_unique").on(table.restaurantId, table.slug),
    // NOT unique — every available item in a category needs this index, not at most one.
    index("menu_items_category_available_idx")
      .on(table.categoryId)
      .where(sql`${table.isAvailable} = true`),
    check("menu_items_price_non_negative", sql`${table.priceCents} >= 0`),
    check(
      "menu_items_prep_time_non_negative",
      sql`${table.prepTimeMinutes} IS NULL OR ${table.prepTimeMinutes} >= 0`,
    ),
  ],
);

export const optionGroups = pgTable(
  "option_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "restrict" }),
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    selectionType: optionSelectionTypeEnum("selection_type").notNull(),
    isRequired: boolean("is_required").notNull().default(false),
    minSelect: integer("min_select").notNull().default(0),
    maxSelect: integer("max_select").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    check("option_groups_min_select_non_negative", sql`${table.minSelect} >= 0`),
    check("option_groups_max_select_gte_min", sql`${table.maxSelect} >= ${table.minSelect}`),
  ],
);

export const optionChoices = pgTable("option_choices", {
  id: uuid("id").primaryKey().defaultRandom(),
  restaurantId: uuid("restaurant_id")
    .notNull()
    .references(() => restaurants.id, { onDelete: "restrict" }),
  optionGroupId: uuid("option_group_id")
    .notNull()
    .references(() => optionGroups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  priceDeltaCents: integer("price_delta_cents").notNull().default(0),
  isAvailable: boolean("is_available").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});
