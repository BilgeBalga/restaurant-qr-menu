"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppError, toActionResult, type ActionResult } from "@/lib/errors";

/**
 * Public reads only — no auth required (§21 getMenu, §12 resolveTable).
 * RLS already restricts anon to is_active rows (§26); this module adds
 * no extra filtering on top of that, and deliberately does NOT filter on
 * is_available — a sold-out item still renders, just disabled (§19).
 */

export interface OptionChoiceView {
  id: string;
  name: string;
  priceDeltaCents: number;
  isAvailable: boolean;
}

export interface OptionGroupView {
  id: string;
  name: string;
  selectionType: "single" | "multiple";
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  choices: OptionChoiceView[];
}

export interface MenuItemView {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string | null;
  shortDescription: string | null;
  priceCents: number;
  imageUrl: string | null;
  ingredients: string[] | null;
  allergens: string[] | null;
  isAvailable: boolean;
  isFeatured: boolean;
  optionGroups: OptionGroupView[];
}

export interface CategoryView {
  id: string;
  name: string;
  slug: string;
  items: MenuItemView[];
}

export interface RestaurantView {
  id: string;
  name: string;
  currency: string;
  orderingEnabled: boolean;
}

interface RawOptionChoice {
  id: string;
  name: string;
  price_delta_cents: number;
  is_available: boolean;
  sort_order: number;
}

interface RawOptionGroup {
  id: string;
  name: string;
  selection_type: "single" | "multiple";
  is_required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  option_choices: RawOptionChoice[] | null;
}

interface RawMenuItem {
  id: string;
  category_id: string;
  name: string;
  slug: string;
  description: string | null;
  short_description: string | null;
  price_cents: number;
  image_url: string | null;
  ingredients: string[] | null;
  allergens: string[] | null;
  is_available: boolean;
  is_featured: boolean;
  sort_order: number;
  option_groups: RawOptionGroup[] | null;
}

interface RawCategory {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  menu_items: RawMenuItem[] | null;
}

const byOrder = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;

const MENU_ITEM_SELECT = `
  id, category_id, name, slug, description, short_description, price_cents, image_url,
  ingredients, allergens, is_available, is_featured, sort_order,
  option_groups (
    id, name, selection_type, is_required, min_select, max_select, sort_order,
    option_choices ( id, name, price_delta_cents, is_available, sort_order )
  )
`;

/** Shared by getMenu and getMenuItemById — one mapping path, not duplicated per caller. */
function mapRawMenuItem(item: RawMenuItem): MenuItemView {
  return {
    id: item.id,
    categoryId: item.category_id,
    name: item.name,
    slug: item.slug,
    description: item.description,
    shortDescription: item.short_description,
    priceCents: item.price_cents,
    imageUrl: item.image_url,
    ingredients: item.ingredients,
    allergens: item.allergens,
    isAvailable: item.is_available,
    isFeatured: item.is_featured,
    optionGroups: (item.option_groups ?? [])
      .slice()
      .sort(byOrder)
      .map((group): OptionGroupView => ({
        id: group.id,
        name: group.name,
        selectionType: group.selection_type,
        isRequired: group.is_required,
        minSelect: group.min_select,
        maxSelect: group.max_select,
        choices: (group.option_choices ?? [])
          .slice()
          .sort(byOrder)
          .map((choice): OptionChoiceView => ({
            id: choice.id,
            name: choice.name,
            priceDeltaCents: choice.price_delta_cents,
            isAvailable: choice.is_available,
          })),
      })),
  };
}

export async function getRestaurant(restaurantId: string): Promise<ActionResult<RestaurantView>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("restaurants")
    .select("id, name, currency, ordering_enabled")
    .eq("id", restaurantId)
    .single();

  if (error || !data) {
    return toActionResult(new AppError("NOT_FOUND", error?.message ?? "restaurant not found", "Restaurant not found."));
  }

  return {
    ok: true,
    data: { id: data.id, name: data.name, currency: data.currency, orderingEnabled: data.ordering_enabled },
  };
}

export async function getMenu(restaurantId: string): Promise<ActionResult<CategoryView[]>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("categories")
    .select(`id, name, slug, sort_order, menu_items ( ${MENU_ITEM_SELECT} )`)
    .eq("restaurant_id", restaurantId);

  if (error) {
    return toActionResult(new AppError("INTERNAL", error.message, "Couldn't load the menu right now."));
  }

  const categories = ((data as unknown as RawCategory[] | null) ?? [])
    .slice()
    .sort(byOrder)
    .map((category): CategoryView => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      items: (category.menu_items ?? []).slice().sort(byOrder).map(mapRawMenuItem),
    }));

  return { ok: true, data: categories };
}

export async function getMenuItemById(restaurantId: string, itemId: string): Promise<ActionResult<MenuItemView>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("menu_items")
    .select(MENU_ITEM_SELECT)
    .eq("restaurant_id", restaurantId)
    .eq("id", itemId)
    .single();

  if (error || !data) {
    return toActionResult(new AppError("NOT_FOUND", error?.message ?? "item not found", "That item isn't on the menu."));
  }

  return { ok: true, data: mapRawMenuItem(data as unknown as RawMenuItem) };
}

export interface ResolvedTable {
  tableId: string;
  tableLabel: string;
  tableActive: boolean;
  restaurantId: string;
  restaurantName: string;
  restaurantActive: boolean;
  orderingEnabled: boolean;
  currency: string;
}

/** §12: the QR landing route's only way to turn a token into a table — never a direct table read. */
export async function resolveTableByToken(token: string): Promise<ActionResult<ResolvedTable>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("resolve_table_by_token", { p_token: token });

  if (error || !data) {
    return toActionResult(new AppError("NOT_FOUND", error?.message ?? "invalid token", "This QR code isn't valid."));
  }

  const row = data as {
    table_id: string;
    table_label: string;
    table_active: boolean;
    restaurant_id: string;
    restaurant_name: string;
    restaurant_active: boolean;
    ordering_enabled: boolean;
    currency: string;
  };

  return {
    ok: true,
    data: {
      tableId: row.table_id,
      tableLabel: row.table_label,
      tableActive: row.table_active,
      restaurantId: row.restaurant_id,
      restaurantName: row.restaurant_name,
      restaurantActive: row.restaurant_active,
      orderingEnabled: row.ordering_enabled,
      currency: row.currency,
    },
  };
}
