import { describe, expect, it } from "vitest";
import {
  createCategoryInputSchema,
  createMenuItemInputSchema,
  createOptionChoiceInputSchema,
  createOptionGroupInputSchema,
  menuItemImageFileSchema,
  updateMenuItemInputSchema,
  updateOptionGroupInputSchema,
} from "@/lib/validation/menu";
import { MAX_MENU_IMAGE_BYTES } from "@/lib/storage/menuImages";

describe("createCategoryInputSchema", () => {
  it("accepts a valid name", () => {
    expect(createCategoryInputSchema.safeParse({ name: "Starters" }).success).toBe(true);
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(createCategoryInputSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createCategoryInputSchema.safeParse({ name: "   " }).success).toBe(false);
  });
});

const validItem = {
  categoryId: "11111111-1111-4111-8111-111111111111",
  name: "Classic Burger",
  priceInput: "12.50",
  isFeatured: false,
};

describe("createMenuItemInputSchema", () => {
  it("accepts a valid item and parses the price into integer cents", () => {
    const result = createMenuItemInputSchema.safeParse(validItem);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priceInput).toBe(1250);
  });

  it("rejects a negative price", () => {
    expect(createMenuItemInputSchema.safeParse({ ...validItem, priceInput: "-1" }).success).toBe(false);
  });

  it("rejects a malformed price", () => {
    expect(createMenuItemInputSchema.safeParse({ ...validItem, priceInput: "not-a-price" }).success).toBe(false);
    expect(createMenuItemInputSchema.safeParse({ ...validItem, priceInput: "12.999" }).success).toBe(false);
  });

  it("rejects an invalid categoryId", () => {
    expect(createMenuItemInputSchema.safeParse({ ...validItem, categoryId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(createMenuItemInputSchema.safeParse({ ...validItem, name: "" }).success).toBe(false);
  });

  it("accepts ingredients/allergens arrays and rejects an empty-string entry", () => {
    expect(createMenuItemInputSchema.safeParse({ ...validItem, ingredients: ["beef", "cheese"] }).success).toBe(true);
    expect(createMenuItemInputSchema.safeParse({ ...validItem, ingredients: [""] }).success).toBe(false);
  });

  it("rejects a malformed image URL but accepts an empty one (meaning: no image)", () => {
    expect(createMenuItemInputSchema.safeParse({ ...validItem, imageUrl: "not a url" }).success).toBe(false);
    expect(createMenuItemInputSchema.safeParse({ ...validItem, imageUrl: "" }).success).toBe(true);
    expect(createMenuItemInputSchema.safeParse({ ...validItem, imageUrl: "https://example.com/x.jpg" }).success).toBe(true);
  });
});

describe("updateMenuItemInputSchema", () => {
  it("is a true partial — omitted fields stay undefined, not defaulted", () => {
    const result = updateMenuItemInputSchema.safeParse({ id: validItem.categoryId, isAvailable: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isAvailable).toBe(false);
      expect(result.data.name).toBeUndefined();
      expect(result.data.priceInput).toBeUndefined();
    }
  });
});

const validGroup = {
  menuItemId: "11111111-1111-4111-8111-111111111111",
  name: "Size",
  selectionType: "single" as const,
  isRequired: true,
  minSelect: 1,
  maxSelect: 1,
};

describe("createOptionGroupInputSchema", () => {
  it("accepts a valid group", () => {
    expect(createOptionGroupInputSchema.safeParse(validGroup).success).toBe(true);
  });

  it("rejects maxSelect below minSelect (mirrors the DB CHECK constraint)", () => {
    const result = createOptionGroupInputSchema.safeParse({ ...validGroup, minSelect: 2, maxSelect: 1 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative minSelect", () => {
    expect(createOptionGroupInputSchema.safeParse({ ...validGroup, minSelect: -1 }).success).toBe(false);
  });

  it("rejects an invalid selectionType", () => {
    expect(createOptionGroupInputSchema.safeParse({ ...validGroup, selectionType: "many" }).success).toBe(false);
  });
});

describe("updateOptionGroupInputSchema", () => {
  it("is a true partial — does not silently default minSelect/maxSelect for an unrelated field change", () => {
    const result = updateOptionGroupInputSchema.safeParse({ id: validGroup.menuItemId, name: "Renamed" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minSelect).toBeUndefined();
      expect(result.data.maxSelect).toBeUndefined();
    }
  });
});

describe("createOptionChoiceInputSchema", () => {
  it("accepts a positive price delta and parses it into cents", () => {
    const result = createOptionChoiceInputSchema.safeParse({
      optionGroupId: validGroup.menuItemId,
      name: "Extra cheese",
      priceDeltaInput: "1.50",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priceDeltaInput).toBe(150);
  });

  it("accepts a negative price delta (a discount choice)", () => {
    const result = createOptionChoiceInputSchema.safeParse({
      optionGroupId: validGroup.menuItemId,
      name: "No cheese",
      priceDeltaInput: "-1.00",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priceDeltaInput).toBe(-100);
  });

  it("defaults isAvailable to true when omitted", () => {
    const result = createOptionChoiceInputSchema.safeParse({
      optionGroupId: validGroup.menuItemId,
      name: "Extra cheese",
      priceDeltaInput: "0",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isAvailable).toBe(true);
  });
});

describe("menuItemImageFileSchema", () => {
  it("accepts every allowed MIME type at a valid size", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(menuItemImageFileSchema.safeParse({ type, size: 1024 }).success).toBe(true);
    }
  });

  it("rejects SVG specifically (a real XSS vector if served back with an image content-type)", () => {
    expect(menuItemImageFileSchema.safeParse({ type: "image/svg+xml", size: 1024 }).success).toBe(false);
  });

  it("rejects GIF", () => {
    expect(menuItemImageFileSchema.safeParse({ type: "image/gif", size: 1024 }).success).toBe(false);
  });

  it("rejects every other MIME type, including non-image types", () => {
    for (const type of ["application/pdf", "text/html", "video/mp4", "image/bmp", "image/tiff", ""]) {
      expect(menuItemImageFileSchema.safeParse({ type, size: 1024 }).success).toBe(false);
    }
  });

  it("accepts a file exactly at the 5MB limit", () => {
    expect(menuItemImageFileSchema.safeParse({ type: "image/jpeg", size: MAX_MENU_IMAGE_BYTES }).success).toBe(true);
  });

  it("rejects a file one byte over the 5MB limit", () => {
    expect(menuItemImageFileSchema.safeParse({ type: "image/jpeg", size: MAX_MENU_IMAGE_BYTES + 1 }).success).toBe(false);
  });

  it("rejects a zero-byte or negative size", () => {
    expect(menuItemImageFileSchema.safeParse({ type: "image/jpeg", size: 0 }).success).toBe(false);
    expect(menuItemImageFileSchema.safeParse({ type: "image/jpeg", size: -100 }).success).toBe(false);
  });

  it("rejects a non-integer size", () => {
    expect(menuItemImageFileSchema.safeParse({ type: "image/jpeg", size: 1024.5 }).success).toBe(false);
  });
});
