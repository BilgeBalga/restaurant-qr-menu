import { z } from "zod";
import { parseMoneyDeltaToCents, parseMoneyToCents } from "@/lib/format/money";
import { ALLOWED_MENU_IMAGE_MIME_TYPES, MAX_MENU_IMAGE_BYTES } from "@/lib/storage/menuImages";

/**
 * Shape only, not authority — same convention as lib/validation/order.ts
 * and lib/validation/settings.ts. RLS (menu_items_insert_admin,
 * option_groups_write_admin, etc. — db/migrations/0002_rls_policies.sql)
 * and the enforce_menu_item_update_scope trigger (0001) are the real
 * guarantee; this exists to reject a malformed request with a clear
 * message before it reaches the database.
 *
 * Prices are typed as strings here on purpose — the admin form works in
 * "12.50", not cents — and turned into integer cents via a
 * .transform() that goes through lib/format/money.ts's string-splitting
 * parser, never float multiplication.
 */

const nameSchema = z.string().trim().min(1, "Name is required").max(120, "Keep it under 120 characters");
const descriptionSchema = z.string().trim().max(2000).optional();
const shortDescriptionSchema = z.string().trim().max(200).optional();
const sortOrderDirectionSchema = z.enum(["up", "down"]);

function priceSchema(fieldLabel: string) {
  return z.string().transform((value, ctx) => {
    const cents = parseMoneyToCents(value);
    if (cents === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Enter a valid, non-negative ${fieldLabel} (e.g. 12.50)` });
      return z.NEVER;
    }
    return cents;
  });
}

function priceDeltaSchema() {
  return z.string().transform((value, ctx) => {
    const cents = parseMoneyDeltaToCents(value);
    if (cents === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid price adjustment (e.g. 1.50 or -1.50)" });
      return z.NEVER;
    }
    return cents;
  });
}

/** A comma-separated ingredients/allergens field, already split into an array by the form before validation. */
const tagListSchema = z.array(z.string().trim().min(1).max(60)).max(30).optional();

const imageUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .refine((value) => !value || z.string().url().safeParse(value).success, "Enter a valid image URL");

export const createCategoryInputSchema = z.object({
  name: nameSchema,
});

export const updateCategoryInputSchema = z.object({
  id: z.string().uuid(),
  name: nameSchema.optional(),
  isActive: z.boolean().optional(),
});

export const deleteCategoryInputSchema = z.object({
  id: z.string().uuid(),
});

export const reorderCategoryInputSchema = z.object({
  id: z.string().uuid(),
  direction: sortOrderDirectionSchema,
});

export const createMenuItemInputSchema = z.object({
  categoryId: z.string().uuid(),
  name: nameSchema,
  description: descriptionSchema,
  shortDescription: shortDescriptionSchema,
  priceInput: priceSchema("price"),
  imageUrl: imageUrlSchema,
  ingredients: tagListSchema,
  allergens: tagListSchema,
  isFeatured: z.boolean().default(false),
});

export const updateMenuItemInputSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid().optional(),
  name: nameSchema.optional(),
  description: descriptionSchema,
  shortDescription: shortDescriptionSchema,
  priceInput: priceSchema("price").optional(),
  imageUrl: imageUrlSchema,
  ingredients: tagListSchema,
  allergens: tagListSchema,
  isActive: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});

export const deleteMenuItemInputSchema = z.object({
  id: z.string().uuid(),
});

export const uploadMenuItemImageInputSchema = z.object({
  menuItemId: z.string().uuid(),
});

/**
 * Validates the uploaded File's actual browser-reported `type`/`size` —
 * never a filename or its extension, which is trivially spoofable (a
 * renamed .svg would otherwise sail through a naive extension check).
 * `.refine()` over `z.enum()` here only to keep the same error-message
 * style as imageUrlSchema above; app/actions/menuAdmin.ts's upload action
 * re-narrows `type` to AllowedMenuImageMimeType after this passes, same
 * as SettingsForm.tsx's own "safe because the UI already constrains it"
 * cast.
 */
export const menuItemImageFileSchema = z.object({
  type: z
    .string()
    .refine((type) => (ALLOWED_MENU_IMAGE_MIME_TYPES as readonly string[]).includes(type), "Please upload a JPEG, PNG, or WebP image."),
  size: z
    .number()
    .int()
    .positive("The selected file is empty.")
    .max(MAX_MENU_IMAGE_BYTES, "Images must be 5MB or smaller."),
});

export const deleteMenuItemImageInputSchema = z.object({
  id: z.string().uuid(),
});

export const setMenuItemAvailabilityInputSchema = z.object({
  id: z.string().uuid(),
  isAvailable: z.boolean(),
});

export const reorderMenuItemInputSchema = z.object({
  id: z.string().uuid(),
  direction: sortOrderDirectionSchema,
});

const optionGroupShapeSchema = z.object({
  name: nameSchema,
  selectionType: z.enum(["single", "multiple"]),
  isRequired: z.boolean(),
  minSelect: z.number().int().min(0, "Must be 0 or greater"),
  maxSelect: z.number().int().min(0, "Must be 0 or greater"),
});

/** Mirrors the option_groups_max_select_gte_min CHECK constraint (db/migrations/0000_init_schema.sql). */
function refineMinMax<T extends { minSelect: number; maxSelect: number }>(schema: z.ZodType<T>) {
  return schema.refine((value) => value.maxSelect >= value.minSelect, {
    message: "Max selections must be greater than or equal to min selections",
    path: ["maxSelect"],
  });
}

export const createOptionGroupInputSchema = refineMinMax(
  optionGroupShapeSchema.extend({ menuItemId: z.string().uuid() }),
);

/**
 * A true partial — no `.default()` on minSelect/maxSelect. Filling in a
 * default for a field the admin didn't touch would make
 * app/actions/menuAdmin.ts write that default over the existing value.
 * min<=max for whatever the *merged* row ends up as is left to the
 * option_groups_max_select_gte_min CHECK constraint, which is the real
 * guarantee regardless.
 */
export const updateOptionGroupInputSchema = optionGroupShapeSchema.partial().extend({
  id: z.string().uuid(),
});

export const deleteOptionGroupInputSchema = z.object({
  id: z.string().uuid(),
});

export const createOptionChoiceInputSchema = z.object({
  optionGroupId: z.string().uuid(),
  name: nameSchema,
  priceDeltaInput: priceDeltaSchema(),
  isAvailable: z.boolean().default(true),
});

export const updateOptionChoiceInputSchema = z.object({
  id: z.string().uuid(),
  name: nameSchema.optional(),
  priceDeltaInput: priceDeltaSchema().optional(),
  isAvailable: z.boolean().optional(),
});

export const deleteOptionChoiceInputSchema = z.object({
  id: z.string().uuid(),
});

export type CreateCategoryInput = z.infer<typeof createCategoryInputSchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategoryInputSchema>;

// z.input, not z.infer/z.output, for every schema with a price .transform() —
// callers (the server action's own parameter type, and every client
// component calling it) pass the pre-transform shape (a decimal STRING);
// z.infer would give the post-transform shape (integer cents), which is
// only what parsed.data looks like *inside* the action after safeParse.
export type CreateMenuItemInput = z.input<typeof createMenuItemInputSchema>;
export type UpdateMenuItemInput = z.input<typeof updateMenuItemInputSchema>;
export type CreateOptionGroupInput = z.infer<typeof createOptionGroupInputSchema>;
export type UpdateOptionGroupInput = z.infer<typeof updateOptionGroupInputSchema>;
export type CreateOptionChoiceInput = z.input<typeof createOptionChoiceInputSchema>;
export type UpdateOptionChoiceInput = z.input<typeof updateOptionChoiceInputSchema>;
export type MenuItemImageFileInput = z.infer<typeof menuItemImageFileSchema>;
