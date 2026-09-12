"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveMembership } from "@/lib/auth/session";
import { can } from "@/lib/business/permissions";
import { logAuditEvent } from "@/lib/audit";
import { slugify } from "@/lib/business/slug";
import { AppError, toActionResult, type ActionResult } from "@/lib/errors";
import {
  createCategoryInputSchema,
  createMenuItemInputSchema,
  createOptionChoiceInputSchema,
  createOptionGroupInputSchema,
  deleteCategoryInputSchema,
  deleteMenuItemImageInputSchema,
  deleteMenuItemInputSchema,
  deleteOptionChoiceInputSchema,
  deleteOptionGroupInputSchema,
  menuItemImageFileSchema,
  reorderCategoryInputSchema,
  reorderMenuItemInputSchema,
  setMenuItemAvailabilityInputSchema,
  updateCategoryInputSchema,
  updateMenuItemInputSchema,
  updateOptionChoiceInputSchema,
  updateOptionGroupInputSchema,
  uploadMenuItemImageInputSchema,
  type CreateCategoryInput,
  type CreateMenuItemInput,
  type CreateOptionChoiceInput,
  type CreateOptionGroupInput,
  type UpdateCategoryInput,
  type UpdateMenuItemInput,
  type UpdateOptionChoiceInput,
  type UpdateOptionGroupInput,
} from "@/lib/validation/menu";
import {
  buildMenuItemImagePath,
  extractMenuImageObjectPath,
  MENU_IMAGES_BUCKET,
  type AllowedMenuImageMimeType,
} from "@/lib/storage/menuImages";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Admin-facing menu views — deliberately separate from app/actions/menu.ts's
 * CategoryView/MenuItemView (the public/customer read path). Those types
 * omit is_active and real sort_order values because anon never needs
 * them (RLS already filters anon to is_active rows); the admin screen
 * needs both, and must never share a type with — or risk changing the
 * shape of — the customer-facing read path.
 */
export interface AdminOptionChoiceView {
  id: string;
  name: string;
  priceDeltaCents: number;
  isAvailable: boolean;
  sortOrder: number;
}

export interface AdminOptionGroupView {
  id: string;
  menuItemId: string;
  name: string;
  selectionType: "single" | "multiple";
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  choices: AdminOptionChoiceView[];
}

export interface AdminMenuItemView {
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
  isActive: boolean;
  isAvailable: boolean;
  isFeatured: boolean;
  sortOrder: number;
  optionGroups: AdminOptionGroupView[];
}

export interface AdminCategoryView {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
  items: AdminMenuItemView[];
}

export interface AdminMenuView {
  currency: string;
  categories: AdminCategoryView[];
}

const byOrder = <T extends { sortOrder: number; id: string }>(a: T, b: T) =>
  a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);

/**
 * requireActiveMembership() re-derives restaurant_id from restaurant_staff
 * (never trusts the client), and RLS (categories_select_staff,
 * menu_items_select_staff, etc.) independently scopes every row here to
 * that restaurant. Unlike the public getMenu(), nothing is filtered on
 * is_active — RLS's staff-select policies have no such filter, so admin
 * sees everything, active and inactive alike, by design.
 */
export async function getAdminMenu(): Promise<ActionResult<AdminMenuView>> {
  const membership = await requireActiveMembership();
  const supabase = await createSupabaseServerClient();

  const [{ data: restaurant, error: restaurantError }, { data: categories, error: categoriesError }] = await Promise.all([
    supabase.from("restaurants").select("currency").eq("id", membership.restaurantId).single(),
    supabase
      .from("categories")
      .select(
        `id, name, slug, is_active, sort_order,
         menu_items (
           id, category_id, name, slug, description, short_description, price_cents, image_url,
           ingredients, allergens, is_active, is_available, is_featured, sort_order,
           option_groups (
             id, menu_item_id, name, selection_type, is_required, min_select, max_select, sort_order,
             option_choices ( id, name, price_delta_cents, is_available, sort_order )
           )
         )`,
      )
      .eq("restaurant_id", membership.restaurantId),
  ]);

  if (restaurantError || !restaurant) {
    return toActionResult(new AppError("NOT_FOUND", restaurantError?.message ?? "restaurant not found", "Couldn't load the menu."));
  }
  if (categoriesError) {
    return toActionResult(new AppError("INTERNAL", categoriesError.message, "Couldn't load the menu right now."));
  }

  type RawChoice = { id: string; name: string; price_delta_cents: number; is_available: boolean; sort_order: number };
  type RawGroup = {
    id: string;
    menu_item_id: string;
    name: string;
    selection_type: "single" | "multiple";
    is_required: boolean;
    min_select: number;
    max_select: number;
    sort_order: number;
    option_choices: RawChoice[] | null;
  };
  type RawItem = {
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
    is_active: boolean;
    is_available: boolean;
    is_featured: boolean;
    sort_order: number;
    option_groups: RawGroup[] | null;
  };
  type RawCategory = {
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
    sort_order: number;
    menu_items: RawItem[] | null;
  };

  const view: AdminCategoryView[] = ((categories as unknown as RawCategory[] | null) ?? [])
    .map((category): AdminCategoryView => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      isActive: category.is_active,
      sortOrder: category.sort_order,
      items: (category.menu_items ?? [])
        .map((item): AdminMenuItemView => ({
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
          isActive: item.is_active,
          isAvailable: item.is_available,
          isFeatured: item.is_featured,
          sortOrder: item.sort_order,
          optionGroups: (item.option_groups ?? [])
            .map((group): AdminOptionGroupView => ({
              id: group.id,
              menuItemId: group.menu_item_id,
              name: group.name,
              selectionType: group.selection_type,
              isRequired: group.is_required,
              minSelect: group.min_select,
              maxSelect: group.max_select,
              sortOrder: group.sort_order,
              choices: (group.option_choices ?? [])
                .map((choice): AdminOptionChoiceView => ({
                  id: choice.id,
                  name: choice.name,
                  priceDeltaCents: choice.price_delta_cents,
                  isAvailable: choice.is_available,
                  sortOrder: choice.sort_order,
                }))
                .sort(byOrder),
            }))
            .sort(byOrder),
        }))
        .sort(byOrder),
    }))
    .sort(byOrder);

  return { ok: true, data: { currency: restaurant.currency, categories: view } };
}

/**
 * toActionResult()'s return type has no generic — it's the bare
 * { ok: false, ... } shape, assignable into any ActionResult<T>'s false
 * branch regardless of T. Typing this function's return as that (not
 * ActionResult<null>) is what makes `if (forbidden) return forbidden` at
 * each call site type-check no matter what T the caller returns.
 */
function requireMenuWrite(role: Parameters<typeof can>[0]): ReturnType<typeof toActionResult> | null {
  if (!can(role, "menu:write")) {
    return toActionResult(new AppError("FORBIDDEN", "role lacks menu:write", "You don't have permission to edit the menu."));
  }
  return null;
}

/** Every restaurant needs exactly one menus row to hang categories off of — this app doesn't manage multiple menus, so it's provisioned transparently rather than exposed as its own admin feature. */
async function getOrCreateDefaultMenuId(supabase: SupabaseServerClient, restaurantId: string): Promise<string | null> {
  const { data: existing } = await supabase.from("menus").select("id").eq("restaurant_id", restaurantId).limit(1).maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("menus")
    .insert({ restaurant_id: restaurantId, name: "Main Menu" })
    .select("id")
    .single();
  if (error || !created) return null;
  return created.id;
}

async function nextSortOrder(
  supabase: SupabaseServerClient,
  table: "categories" | "menu_items",
  filters: Record<string, string>,
): Promise<number> {
  let query = supabase.from(table).select("sort_order").order("sort_order", { ascending: false }).limit(1);
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value);
  }
  const { data } = await query;
  const highest = (data as { sort_order: number }[] | null)?.[0]?.sort_order;
  return highest === undefined ? 0 : highest + 1;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

function isForeignKeyViolation(error: { code?: string } | null): boolean {
  return error?.code === "23503";
}

// ============================================================
// Categories
// ============================================================

export async function createCategory(input: CreateCategoryInput): Promise<ActionResult<AdminCategoryView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = createCategoryInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Please check the category name."));
  }

  const supabase = await createSupabaseServerClient();
  const menuId = await getOrCreateDefaultMenuId(supabase, membership.restaurantId);
  if (!menuId) {
    return toActionResult(new AppError("INTERNAL", "could not resolve menus row", "Couldn't create the category. Please try again."));
  }

  const sortOrder = await nextSortOrder(supabase, "categories", { restaurant_id: membership.restaurantId });
  const baseSlug = slugify(parsed.data.name);

  for (const slug of [baseSlug, `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`]) {
    const { data, error } = await supabase
      .from("categories")
      .insert({
        restaurant_id: membership.restaurantId,
        menu_id: menuId,
        name: parsed.data.name,
        slug,
        sort_order: sortOrder,
      })
      .select("id, name, slug, is_active, sort_order")
      .single();

    if (!error && data) {
      await logAuditEvent(supabase, {
        restaurantId: membership.restaurantId,
        action: "menu.category.create",
        entityType: "categories",
        entityId: data.id,
        newValue: { name: data.name, slug: data.slug },
      });
      return { ok: true, data: { id: data.id, name: data.name, slug: data.slug, isActive: data.is_active, sortOrder: data.sort_order, items: [] } };
    }
    if (!isUniqueViolation(error)) {
      return toActionResult(new AppError("INTERNAL", error?.message ?? "insert failed", "Couldn't create the category. Please try again."));
    }
  }

  return toActionResult(new AppError("CONFLICT", "slug conflict persisted after retry", "Couldn't create the category. Please try again."));
}

export async function updateCategory(input: UpdateCategoryInput): Promise<ActionResult<AdminCategoryView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = updateCategoryInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Please check the category details."));
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;

  if (Object.keys(patch).length === 0) {
    return toActionResult(new AppError("VALIDATION_ERROR", "no fields to update", "Nothing to save."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("categories")
    .update(patch)
    .eq("id", parsed.data.id)
    .eq("restaurant_id", membership.restaurantId)
    .select("id, name, slug, is_active, sort_order")
    .single();

  if (error || !data) {
    return toActionResult(new AppError("NOT_FOUND", error?.message ?? "category not found", "Couldn't find that category."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "menu.category.update",
    entityType: "categories",
    entityId: data.id,
    newValue: patch,
  });

  return { ok: true, data: { id: data.id, name: data.name, slug: data.slug, isActive: data.is_active, sortOrder: data.sort_order, items: [] } };
}

/**
 * Hard delete only if the category has no items — menu_items.category_id
 * is ON DELETE RESTRICT (lib/db/schema/menu.ts), so a category with items
 * fails at the DB with a foreign-key violation; caught here and turned
 * into a friendly "deactivate instead" message rather than a raw
 * Postgres error, mirroring the same is_active-vs-delete duality the
 * architecture already applies to menu items.
 */
export async function deleteCategory(input: { id: string }): Promise<ActionResult<null>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = deleteCategoryInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Invalid category."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("categories")
    .delete()
    .eq("id", parsed.data.id)
    .eq("restaurant_id", membership.restaurantId)
    .select("id, name")
    .single();

  if (error) {
    if (isForeignKeyViolation(error)) {
      return toActionResult(
        new AppError("CONFLICT", error.message, "This category still has menu items — move or delete them first, or deactivate the category instead."),
      );
    }
    return toActionResult(new AppError("NOT_FOUND", error.message, "Couldn't find that category."));
  }
  if (!data) {
    return toActionResult(new AppError("NOT_FOUND", "category not found", "Couldn't find that category."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "menu.category.delete",
    entityType: "categories",
    entityId: parsed.data.id,
    previousValue: { name: data.name },
  });

  return { ok: true, data: null };
}

export async function reorderCategory(input: { id: string; direction: "up" | "down" }): Promise<ActionResult<null>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = reorderCategoryInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Invalid category."));
  }

  const supabase = await createSupabaseServerClient();
  const { data: siblings, error } = await supabase
    .from("categories")
    .select("id, sort_order")
    .eq("restaurant_id", membership.restaurantId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (error || !siblings) {
    return toActionResult(new AppError("INTERNAL", error?.message ?? "list failed", "Couldn't reorder categories right now."));
  }

  return swapSortOrder(supabase, "categories", siblings as { id: string; sort_order: number }[], parsed.data.id, parsed.data.direction);
}

// ============================================================
// Shared reorder swap
// ============================================================

async function swapSortOrder(
  supabase: SupabaseServerClient,
  table: "categories" | "menu_items",
  siblings: { id: string; sort_order: number }[],
  id: string,
  direction: "up" | "down",
): Promise<ActionResult<null>> {
  const index = siblings.findIndex((row) => row.id === id);
  if (index === -1) {
    return toActionResult(new AppError("NOT_FOUND", "row not found among siblings", "Couldn't find that item."));
  }

  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= siblings.length) {
    return { ok: true, data: null }; // already first/last — nothing to do
  }

  const current = siblings[index]!;
  const neighbor = siblings[neighborIndex]!;

  const [a, b] = await Promise.all([
    supabase.from(table).update({ sort_order: neighbor.sort_order }).eq("id", current.id),
    supabase.from(table).update({ sort_order: current.sort_order }).eq("id", neighbor.id),
  ]);

  if (a.error || b.error) {
    return toActionResult(new AppError("INTERNAL", a.error?.message ?? b.error?.message ?? "reorder failed", "Couldn't reorder right now."));
  }

  return { ok: true, data: null };
}

// ============================================================
// Menu items
// ============================================================

/** Never trusts a client-supplied categoryId belongs to the caller's restaurant — this is the same check for every create/update that touches categoryId. */
async function categoryBelongsToRestaurant(supabase: SupabaseServerClient, categoryId: string, restaurantId: string): Promise<boolean> {
  const { data } = await supabase.from("categories").select("id").eq("id", categoryId).eq("restaurant_id", restaurantId).maybeSingle();
  return Boolean(data);
}

function mapMenuItemRow(row: {
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
  is_active: boolean;
  is_available: boolean;
  is_featured: boolean;
  sort_order: number;
}): AdminMenuItemView {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    shortDescription: row.short_description,
    priceCents: row.price_cents,
    imageUrl: row.image_url,
    ingredients: row.ingredients,
    allergens: row.allergens,
    isActive: row.is_active,
    isAvailable: row.is_available,
    isFeatured: row.is_featured,
    sortOrder: row.sort_order,
    optionGroups: [],
  };
}

const MENU_ITEM_COLUMNS =
  "id, category_id, name, slug, description, short_description, price_cents, image_url, ingredients, allergens, is_active, is_available, is_featured, sort_order";

export async function createMenuItem(input: CreateMenuItemInput): Promise<ActionResult<AdminMenuItemView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = createMenuItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Please check the item's details."));
  }

  const supabase = await createSupabaseServerClient();
  const belongs = await categoryBelongsToRestaurant(supabase, parsed.data.categoryId, membership.restaurantId);
  if (!belongs) {
    return toActionResult(new AppError("NOT_FOUND", "category not found for restaurant", "Couldn't find that category."));
  }

  const sortOrder = await nextSortOrder(supabase, "menu_items", { category_id: parsed.data.categoryId });
  const baseSlug = slugify(parsed.data.name);

  for (const slug of [baseSlug, `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`]) {
    const { data, error } = await supabase
      .from("menu_items")
      .insert({
        restaurant_id: membership.restaurantId,
        category_id: parsed.data.categoryId,
        name: parsed.data.name,
        slug,
        description: parsed.data.description ?? null,
        short_description: parsed.data.shortDescription ?? null,
        price_cents: parsed.data.priceInput,
        image_url: parsed.data.imageUrl || null,
        ingredients: parsed.data.ingredients ?? null,
        allergens: parsed.data.allergens ?? null,
        is_featured: parsed.data.isFeatured,
        sort_order: sortOrder,
      })
      .select(MENU_ITEM_COLUMNS)
      .single();

    if (!error && data) {
      await logAuditEvent(supabase, {
        restaurantId: membership.restaurantId,
        action: "menu.item.create",
        entityType: "menu_items",
        entityId: data.id,
        newValue: { name: data.name, priceCents: data.price_cents, categoryId: data.category_id },
      });
      return { ok: true, data: mapMenuItemRow(data) };
    }
    if (!isUniqueViolation(error)) {
      return toActionResult(new AppError("INTERNAL", error?.message ?? "insert failed", "Couldn't create the item. Please try again."));
    }
  }

  return toActionResult(new AppError("CONFLICT", "slug conflict persisted after retry", "Couldn't create the item. Please try again."));
}

export async function updateMenuItem(input: UpdateMenuItemInput): Promise<ActionResult<AdminMenuItemView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = updateMenuItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Please check the item's details."));
  }

  const supabase = await createSupabaseServerClient();

  if (parsed.data.categoryId !== undefined) {
    const belongs = await categoryBelongsToRestaurant(supabase, parsed.data.categoryId, membership.restaurantId);
    if (!belongs) {
      return toActionResult(new AppError("NOT_FOUND", "category not found for restaurant", "Couldn't find that category."));
    }
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.categoryId !== undefined) patch.category_id = parsed.data.categoryId;
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.description !== undefined) patch.description = parsed.data.description || null;
  if (parsed.data.shortDescription !== undefined) patch.short_description = parsed.data.shortDescription || null;
  if (parsed.data.priceInput !== undefined) patch.price_cents = parsed.data.priceInput;
  if (parsed.data.imageUrl !== undefined) patch.image_url = parsed.data.imageUrl || null;
  if (parsed.data.ingredients !== undefined) patch.ingredients = parsed.data.ingredients;
  if (parsed.data.allergens !== undefined) patch.allergens = parsed.data.allergens;
  if (parsed.data.isActive !== undefined) patch.is_active = parsed.data.isActive;
  if (parsed.data.isAvailable !== undefined) patch.is_available = parsed.data.isAvailable;
  if (parsed.data.isFeatured !== undefined) patch.is_featured = parsed.data.isFeatured;

  if (Object.keys(patch).length === 0) {
    return toActionResult(new AppError("VALIDATION_ERROR", "no fields to update", "Nothing to save."));
  }

  const { data, error } = await supabase
    .from("menu_items")
    .update(patch)
    .eq("id", parsed.data.id)
    .eq("restaurant_id", membership.restaurantId)
    .select(MENU_ITEM_COLUMNS)
    .single();

  if (error || !data) {
    return toActionResult(new AppError("NOT_FOUND", error?.message ?? "item not found", "Couldn't find that item."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "menu.item.update",
    entityType: "menu_items",
    entityId: data.id,
    newValue: patch,
  });

  return { ok: true, data: mapMenuItemRow(data) };
}

/**
 * Upload (or replace) a menu item's image. Admin-only (§Image Support),
 * uploading through the normal RLS-scoped server client — never the
 * service-role client: the Storage RLS policies in
 * db/storage/menu_images_bucket.sql already re-derive "is this caller
 * actually an admin of this object's restaurant" server-side from
 * staff_role_for(), the exact same guarantee menu_items_insert_admin
 * gives the table itself, so no elevated credential is needed here.
 *
 * Takes FormData (not a plain object) because that's how a browser File
 * crosses a Server Action boundary. Order of operations matters for
 * failure safety: the OLD row (and its image_url) is read before any
 * write, the NEW file is uploaded to a fresh random path (never
 * overwriting anything), then menu_items is updated — only after that
 * succeeds is the OLD Storage object (if any) removed, so a failure
 * partway through never leaves menu_items pointing at a deleted object.
 * A failure to update menu_items after a successful upload instead rolls
 * back the newly-uploaded object, so a failed save never leaves an
 * orphan behind either.
 */
export async function uploadMenuItemImage(formData: FormData): Promise<ActionResult<AdminMenuItemView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const idParsed = uploadMenuItemImageInputSchema.safeParse({ menuItemId: formData.get("menuItemId") });
  if (!idParsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", idParsed.error.message, "Couldn't tell which item this image belongs to."));
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return toActionResult(new AppError("VALIDATION_ERROR", "missing file", "Please choose an image to upload."));
  }

  const fileParsed = menuItemImageFileSchema.safeParse({ type: file.type, size: file.size });
  if (!fileParsed.success) {
    return toActionResult(
      new AppError("VALIDATION_ERROR", fileParsed.error.message, fileParsed.error.issues[0]?.message ?? "That file isn't a usable image."),
    );
  }
  // Safe: menuItemImageFileSchema.type just verified membership in this exact union.
  const mimeType = fileParsed.data.type as AllowedMenuImageMimeType;

  const supabase = await createSupabaseServerClient();

  const { data: currentRow, error: currentRowError } = await supabase
    .from("menu_items")
    .select("id, image_url")
    .eq("id", idParsed.data.menuItemId)
    .eq("restaurant_id", membership.restaurantId)
    .maybeSingle();

  if (currentRowError) {
    return toActionResult(new AppError("INTERNAL", currentRowError.message, "Couldn't upload this image. Please try again."));
  }
  if (!currentRow) {
    return toActionResult(new AppError("NOT_FOUND", "menu item not found for restaurant", "Couldn't find that menu item."));
  }
  const previousImageUrl = currentRow.image_url as string | null;

  const path = buildMenuItemImagePath(membership.restaurantId, idParsed.data.menuItemId, mimeType);
  const { error: uploadError } = await supabase.storage.from(MENU_IMAGES_BUCKET).upload(path, file, {
    contentType: mimeType,
    upsert: false,
  });
  if (uploadError) {
    return toActionResult(new AppError("INTERNAL", uploadError.message, "Couldn't upload that image. Please try again."));
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(MENU_IMAGES_BUCKET).getPublicUrl(path);

  const { data: updated, error: updateError } = await supabase
    .from("menu_items")
    .update({ image_url: publicUrl })
    .eq("id", idParsed.data.menuItemId)
    .eq("restaurant_id", membership.restaurantId)
    .select(MENU_ITEM_COLUMNS)
    .single();

  if (updateError || !updated) {
    // Never leave an orphaned object behind for a save that didn't take.
    await supabase.storage.from(MENU_IMAGES_BUCKET).remove([path]);
    return toActionResult(
      new AppError("INTERNAL", updateError?.message ?? "update failed", "Uploaded the image, but couldn't save it. Please try again."),
    );
  }

  // Replacing an existing image: now that menu_items points at the new
  // object, clean up the old one — but only if it's actually a
  // menu-images object under THIS restaurant (never a legacy pasted URL,
  // and never another restaurant's object, even in principle).
  const previousPath = previousImageUrl ? extractMenuImageObjectPath(previousImageUrl) : null;
  if (previousPath && previousPath.startsWith(`${membership.restaurantId}/`)) {
    const { error: removeError } = await supabase.storage.from(MENU_IMAGES_BUCKET).remove([previousPath]);
    if (removeError) console.error("Failed to remove replaced menu item image:", removeError);
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: previousImageUrl ? "menu_item.image.replace" : "menu_item.image.upload",
    entityType: "menu_items",
    entityId: idParsed.data.menuItemId,
    previousValue: { imageUrl: previousImageUrl },
    newValue: { imageUrl: publicUrl },
  });

  return { ok: true, data: mapMenuItemRow(updated) };
}

/**
 * Removes a menu item's image — admin-only. menu_items is updated first
 * (image_url set to null) and the Storage object removed only after that
 * succeeds: if Storage removal fails or the object is already gone, the
 * database is still left in the correct state (no image), which matters
 * more than leaving a harmless orphaned object behind — the reverse
 * ordering would risk a broken image link surviving a failed DB write.
 */
export async function deleteMenuItemImage(input: { id: string }): Promise<ActionResult<AdminMenuItemView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = deleteMenuItemImageInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Invalid menu item."));
  }

  const supabase = await createSupabaseServerClient();

  const { data: currentRow, error: currentRowError } = await supabase
    .from("menu_items")
    .select("id, image_url")
    .eq("id", parsed.data.id)
    .eq("restaurant_id", membership.restaurantId)
    .maybeSingle();

  if (currentRowError) {
    return toActionResult(new AppError("INTERNAL", currentRowError.message, "Couldn't remove this image. Please try again."));
  }
  if (!currentRow) {
    return toActionResult(new AppError("NOT_FOUND", "menu item not found for restaurant", "Couldn't find that menu item."));
  }
  const currentImageUrl = currentRow.image_url as string | null;
  if (!currentImageUrl) {
    return toActionResult(new AppError("VALIDATION_ERROR", "no image to remove", "This item doesn't have an image to remove."));
  }

  const { data: updated, error: updateError } = await supabase
    .from("menu_items")
    .update({ image_url: null })
    .eq("id", parsed.data.id)
    .eq("restaurant_id", membership.restaurantId)
    .select(MENU_ITEM_COLUMNS)
    .single();

  if (updateError || !updated) {
    return toActionResult(new AppError("INTERNAL", updateError?.message ?? "update failed", "Couldn't remove this image. Please try again."));
  }

  const path = extractMenuImageObjectPath(currentImageUrl);
  if (path && path.startsWith(`${membership.restaurantId}/`)) {
    // A missing/already-deleted object is not an error worth failing this action over —
    // menu_items.image_url is already correctly cleared, which is the guarantee that matters.
    const { error: removeError } = await supabase.storage.from(MENU_IMAGES_BUCKET).remove([path]);
    if (removeError) console.error("Failed to remove deleted menu item image:", removeError);
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "menu_item.image.delete",
    entityType: "menu_items",
    entityId: parsed.data.id,
    previousValue: { imageUrl: currentImageUrl },
    newValue: { imageUrl: null },
  });

  return { ok: true, data: mapMenuItemRow(updated) };
}

/**
 * Any active staff member, not just admin — mirrors the DB's own
 * enforce_menu_item_update_scope trigger (db/migrations/0001_functions.sql),
 * which already lets a non-admin change exactly this one column. This
 * action only ever sends { is_available }, so it stays within the
 * trigger's allowance regardless of role.
 */
export async function setMenuItemAvailability(input: { id: string; isAvailable: boolean }): Promise<ActionResult<{ id: string; isAvailable: boolean }>> {
  const membership = await requireActiveMembership();

  const parsed = setMenuItemAvailabilityInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Invalid request."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("menu_items")
    .update({ is_available: parsed.data.isAvailable })
    .eq("id", parsed.data.id)
    .eq("restaurant_id", membership.restaurantId)
    .select("id, name, is_available")
    .single();

  if (error || !data) {
    return toActionResult(new AppError("NOT_FOUND", error?.message ?? "item not found", "Couldn't find that item."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "menu.item.availability",
    entityType: "menu_items",
    entityId: data.id,
    newValue: { name: data.name, isAvailable: data.is_available },
  });

  return { ok: true, data: { id: data.id, isAvailable: data.is_available } };
}

/**
 * Hard delete only if the item was never ordered — order_items.menu_item_id
 * is ON DELETE RESTRICT (§7's documented "price history" decision), so
 * this fails with a foreign-key violation for any item that appears in
 * even one historical order; caught and turned into a friendly
 * "deactivate instead" message.
 *
 * Bug fix: a never-ordered item can still have had an image uploaded to
 * it — nothing previously cleaned up that Storage object when the row
 * itself was deleted (deleteMenuItemImage/uploadMenuItemImage only ever
 * run when the item still exists), leaving it orphaned forever. Removed
 * only after the row delete succeeds, and only when the URL is actually a
 * menu-images object under this restaurant — same guard as
 * deleteMenuItemImage/uploadMenuItemImage. A failed Storage removal is
 * logged but never fails or reverts the delete itself; the row is already
 * gone, and that's the guarantee that matters.
 */
export async function deleteMenuItem(input: { id: string }): Promise<ActionResult<null>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = deleteMenuItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Invalid item."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("menu_items")
    .delete()
    .eq("id", parsed.data.id)
    .eq("restaurant_id", membership.restaurantId)
    .select("id, name, image_url")
    .single();

  if (error) {
    if (isForeignKeyViolation(error)) {
      return toActionResult(
        new AppError("CONFLICT", error.message, "This item has already been ordered — deactivate it instead of deleting it."),
      );
    }
    return toActionResult(new AppError("NOT_FOUND", error.message, "Couldn't find that item."));
  }
  if (!data) {
    return toActionResult(new AppError("NOT_FOUND", "item not found", "Couldn't find that item."));
  }

  const imagePath = data.image_url ? extractMenuImageObjectPath(data.image_url) : null;
  if (imagePath && imagePath.startsWith(`${membership.restaurantId}/`)) {
    const { error: removeError } = await supabase.storage.from(MENU_IMAGES_BUCKET).remove([imagePath]);
    if (removeError) console.error("Failed to remove deleted menu item's image:", removeError);
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "menu.item.delete",
    entityType: "menu_items",
    entityId: parsed.data.id,
    previousValue: { name: data.name },
  });

  return { ok: true, data: null };
}

export async function reorderMenuItem(input: { id: string; direction: "up" | "down" }): Promise<ActionResult<null>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = reorderMenuItemInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Invalid item."));
  }

  const supabase = await createSupabaseServerClient();
  const { data: target } = await supabase
    .from("menu_items")
    .select("category_id")
    .eq("id", parsed.data.id)
    .eq("restaurant_id", membership.restaurantId)
    .maybeSingle();

  if (!target) {
    return toActionResult(new AppError("NOT_FOUND", "item not found", "Couldn't find that item."));
  }

  const { data: siblings, error } = await supabase
    .from("menu_items")
    .select("id, sort_order")
    .eq("category_id", target.category_id)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (error || !siblings) {
    return toActionResult(new AppError("INTERNAL", error?.message ?? "list failed", "Couldn't reorder items right now."));
  }

  return swapSortOrder(supabase, "menu_items", siblings as { id: string; sort_order: number }[], parsed.data.id, parsed.data.direction);
}

// ============================================================
// Option groups
// ============================================================

/** Never trusts a client-supplied menuItemId belongs to the caller's restaurant. */
async function menuItemBelongsToRestaurant(supabase: SupabaseServerClient, menuItemId: string, restaurantId: string): Promise<boolean> {
  const { data } = await supabase.from("menu_items").select("id").eq("id", menuItemId).eq("restaurant_id", restaurantId).maybeSingle();
  return Boolean(data);
}

function mapOptionGroupRow(row: {
  id: string;
  menu_item_id: string;
  name: string;
  selection_type: "single" | "multiple";
  is_required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
}): AdminOptionGroupView {
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    name: row.name,
    selectionType: row.selection_type,
    isRequired: row.is_required,
    minSelect: row.min_select,
    maxSelect: row.max_select,
    sortOrder: row.sort_order,
    choices: [],
  };
}

const OPTION_GROUP_COLUMNS = "id, menu_item_id, name, selection_type, is_required, min_select, max_select, sort_order";

export async function createOptionGroup(input: CreateOptionGroupInput): Promise<ActionResult<AdminOptionGroupView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = createOptionGroupInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Please check the option group's details."));
  }

  const supabase = await createSupabaseServerClient();
  const belongs = await menuItemBelongsToRestaurant(supabase, parsed.data.menuItemId, membership.restaurantId);
  if (!belongs) {
    return toActionResult(new AppError("NOT_FOUND", "menu item not found for restaurant", "Couldn't find that menu item."));
  }

  const { data: existingGroups } = await supabase
    .from("option_groups")
    .select("sort_order")
    .eq("menu_item_id", parsed.data.menuItemId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const highestGroupSort = (existingGroups as { sort_order: number }[] | null)?.[0]?.sort_order;
  const groupSortOrder = highestGroupSort === undefined ? 0 : highestGroupSort + 1;

  const { data, error } = await supabase
    .from("option_groups")
    .insert({
      restaurant_id: membership.restaurantId,
      menu_item_id: parsed.data.menuItemId,
      name: parsed.data.name,
      selection_type: parsed.data.selectionType,
      is_required: parsed.data.isRequired,
      min_select: parsed.data.minSelect,
      max_select: parsed.data.maxSelect,
      sort_order: groupSortOrder,
    })
    .select(OPTION_GROUP_COLUMNS)
    .single();

  if (error || !data) {
    return toActionResult(new AppError("INTERNAL", error?.message ?? "insert failed", "Couldn't create the option group. Please try again."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "menu.option_group.create",
    entityType: "option_groups",
    entityId: data.id,
    newValue: { name: data.name, menuItemId: data.menu_item_id },
  });

  return { ok: true, data: mapOptionGroupRow(data) };
}

export async function updateOptionGroup(input: UpdateOptionGroupInput): Promise<ActionResult<AdminOptionGroupView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = updateOptionGroupInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Please check the option group's details."));
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.selectionType !== undefined) patch.selection_type = parsed.data.selectionType;
  if (parsed.data.isRequired !== undefined) patch.is_required = parsed.data.isRequired;
  if (parsed.data.minSelect !== undefined) patch.min_select = parsed.data.minSelect;
  if (parsed.data.maxSelect !== undefined) patch.max_select = parsed.data.maxSelect;

  if (Object.keys(patch).length === 0) {
    return toActionResult(new AppError("VALIDATION_ERROR", "no fields to update", "Nothing to save."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("option_groups")
    .update(patch)
    .eq("id", parsed.data.id)
    .eq("restaurant_id", membership.restaurantId)
    .select(OPTION_GROUP_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23514") {
      return toActionResult(
        new AppError("VALIDATION_ERROR", error.message, "Max selections must be greater than or equal to min selections."),
      );
    }
    return toActionResult(new AppError("NOT_FOUND", error.message, "Couldn't find that option group."));
  }
  if (!data) {
    return toActionResult(new AppError("NOT_FOUND", "option group not found", "Couldn't find that option group."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "menu.option_group.update",
    entityType: "option_groups",
    entityId: data.id,
    newValue: patch,
  });

  return { ok: true, data: mapOptionGroupRow(data) };
}

/** option_choices.option_group_id is ON DELETE CASCADE — no live FK guards its removal, so a hard delete is always safe here (unlike categories/menu items). */
export async function deleteOptionGroup(input: { id: string }): Promise<ActionResult<null>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = deleteOptionGroupInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Invalid option group."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("option_groups")
    .delete()
    .eq("id", parsed.data.id)
    .eq("restaurant_id", membership.restaurantId)
    .select("id, name")
    .single();

  if (error || !data) {
    return toActionResult(new AppError("NOT_FOUND", error?.message ?? "option group not found", "Couldn't find that option group."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "menu.option_group.delete",
    entityType: "option_groups",
    entityId: parsed.data.id,
    previousValue: { name: data.name },
  });

  return { ok: true, data: null };
}

// ============================================================
// Option choices
// ============================================================

function mapOptionChoiceRow(row: { id: string; name: string; price_delta_cents: number; is_available: boolean; sort_order: number }): AdminOptionChoiceView {
  return {
    id: row.id,
    name: row.name,
    priceDeltaCents: row.price_delta_cents,
    isAvailable: row.is_available,
    sortOrder: row.sort_order,
  };
}

const OPTION_CHOICE_COLUMNS = "id, name, price_delta_cents, is_available, sort_order";

async function optionGroupBelongsToRestaurant(supabase: SupabaseServerClient, optionGroupId: string, restaurantId: string): Promise<boolean> {
  const { data } = await supabase.from("option_groups").select("id").eq("id", optionGroupId).eq("restaurant_id", restaurantId).maybeSingle();
  return Boolean(data);
}

export async function createOptionChoice(input: CreateOptionChoiceInput): Promise<ActionResult<AdminOptionChoiceView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = createOptionChoiceInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Please check the choice's details."));
  }

  const supabase = await createSupabaseServerClient();
  const belongs = await optionGroupBelongsToRestaurant(supabase, parsed.data.optionGroupId, membership.restaurantId);
  if (!belongs) {
    return toActionResult(new AppError("NOT_FOUND", "option group not found for restaurant", "Couldn't find that option group."));
  }

  const { data: existing } = await supabase
    .from("option_choices")
    .select("sort_order")
    .eq("option_group_id", parsed.data.optionGroupId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const highest = (existing as { sort_order: number }[] | null)?.[0]?.sort_order;
  const sortOrder = highest === undefined ? 0 : highest + 1;

  const { data, error } = await supabase
    .from("option_choices")
    .insert({
      restaurant_id: membership.restaurantId,
      option_group_id: parsed.data.optionGroupId,
      name: parsed.data.name,
      price_delta_cents: parsed.data.priceDeltaInput,
      is_available: parsed.data.isAvailable,
      sort_order: sortOrder,
    })
    .select(OPTION_CHOICE_COLUMNS)
    .single();

  if (error || !data) {
    return toActionResult(new AppError("INTERNAL", error?.message ?? "insert failed", "Couldn't create the option. Please try again."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "menu.option_choice.create",
    entityType: "option_choices",
    entityId: data.id,
    newValue: { name: data.name, priceDeltaCents: data.price_delta_cents },
  });

  return { ok: true, data: mapOptionChoiceRow(data) };
}

export async function updateOptionChoice(input: UpdateOptionChoiceInput): Promise<ActionResult<AdminOptionChoiceView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = updateOptionChoiceInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Please check the choice's details."));
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.priceDeltaInput !== undefined) patch.price_delta_cents = parsed.data.priceDeltaInput;
  if (parsed.data.isAvailable !== undefined) patch.is_available = parsed.data.isAvailable;

  if (Object.keys(patch).length === 0) {
    return toActionResult(new AppError("VALIDATION_ERROR", "no fields to update", "Nothing to save."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("option_choices")
    .update(patch)
    .eq("id", parsed.data.id)
    .eq("restaurant_id", membership.restaurantId)
    .select(OPTION_CHOICE_COLUMNS)
    .single();

  if (error || !data) {
    return toActionResult(new AppError("NOT_FOUND", error?.message ?? "option choice not found", "Couldn't find that option."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "menu.option_choice.update",
    entityType: "option_choices",
    entityId: data.id,
    newValue: patch,
  });

  return { ok: true, data: mapOptionChoiceRow(data) };
}

/** No live FK guards option_choices at all (order_item_options snapshots name/price instead) — always safe to hard-delete. */
export async function deleteOptionChoice(input: { id: string }): Promise<ActionResult<null>> {
  const membership = await requireActiveMembership();
  const forbidden = requireMenuWrite(membership.role);
  if (forbidden) return forbidden;

  const parsed = deleteOptionChoiceInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Invalid option."));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("option_choices")
    .delete()
    .eq("id", parsed.data.id)
    .eq("restaurant_id", membership.restaurantId)
    .select("id, name")
    .single();

  if (error || !data) {
    return toActionResult(new AppError("NOT_FOUND", error?.message ?? "option choice not found", "Couldn't find that option."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "menu.option_choice.delete",
    entityType: "option_choices",
    entityId: parsed.data.id,
    previousValue: { name: data.name },
  });

  return { ok: true, data: null };
}
