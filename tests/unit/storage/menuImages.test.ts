import { describe, expect, it } from "vitest";
import {
  ALLOWED_MENU_IMAGE_MIME_TYPES,
  MENU_IMAGES_BUCKET,
  buildMenuItemImagePath,
  extractMenuImageObjectPath,
  isAllowedMenuImageMimeType,
} from "@/lib/storage/menuImages";

const restaurantId = "11111111-1111-4111-8111-111111111111";
const menuItemId = "22222222-2222-4222-8222-222222222222";

describe("isAllowedMenuImageMimeType", () => {
  it("accepts exactly the three supported types", () => {
    expect(ALLOWED_MENU_IMAGE_MIME_TYPES).toEqual(["image/jpeg", "image/png", "image/webp"]);
    for (const type of ALLOWED_MENU_IMAGE_MIME_TYPES) {
      expect(isAllowedMenuImageMimeType(type)).toBe(true);
    }
  });

  it("rejects SVG, GIF, and other types", () => {
    expect(isAllowedMenuImageMimeType("image/svg+xml")).toBe(false);
    expect(isAllowedMenuImageMimeType("image/gif")).toBe(false);
    expect(isAllowedMenuImageMimeType("application/pdf")).toBe(false);
    expect(isAllowedMenuImageMimeType("")).toBe(false);
  });
});

describe("buildMenuItemImagePath", () => {
  it("leads with the restaurantId then the menuItemId, matching the Storage RLS policies' storage.foldername(name)[1] convention", () => {
    const path = buildMenuItemImagePath(restaurantId, menuItemId, "image/jpeg");
    expect(path.startsWith(`${restaurantId}/${menuItemId}/`)).toBe(true);
  });

  it("maps each allowed MIME type to its matching, unambiguous extension", () => {
    expect(buildMenuItemImagePath(restaurantId, menuItemId, "image/jpeg")).toMatch(/\.jpg$/);
    expect(buildMenuItemImagePath(restaurantId, menuItemId, "image/png")).toMatch(/\.png$/);
    expect(buildMenuItemImagePath(restaurantId, menuItemId, "image/webp")).toMatch(/\.webp$/);
  });

  it("generates a different object key on every call — replacing an image never collides with the old path", () => {
    const first = buildMenuItemImagePath(restaurantId, menuItemId, "image/jpeg");
    const second = buildMenuItemImagePath(restaurantId, menuItemId, "image/jpeg");
    expect(first).not.toBe(second);
  });
});

describe("extractMenuImageObjectPath", () => {
  it("extracts the object path from a real Supabase public Storage URL for this bucket", () => {
    const path = `${restaurantId}/${menuItemId}/abc123.jpg`;
    const url = `https://project-ref.supabase.co/storage/v1/object/public/${MENU_IMAGES_BUCKET}/${path}`;
    expect(extractMenuImageObjectPath(url)).toBe(path);
  });

  it("strips a query string or fragment from the extracted path", () => {
    const path = `${restaurantId}/${menuItemId}/abc123.jpg`;
    const url = `https://project-ref.supabase.co/storage/v1/object/public/${MENU_IMAGES_BUCKET}/${path}?download=`;
    expect(extractMenuImageObjectPath(url)).toBe(path);
  });

  it("returns null for a legacy externally-pasted URL that predates this feature — never mistaken for a Storage object to delete", () => {
    expect(extractMenuImageObjectPath("https://images.example.com/burger.jpg")).toBeNull();
  });

  it("returns null for a Storage URL from a DIFFERENT bucket", () => {
    const url = "https://project-ref.supabase.co/storage/v1/object/public/some-other-bucket/x.jpg";
    expect(extractMenuImageObjectPath(url)).toBeNull();
  });

  it("URL-decodes the extracted path", () => {
    const url = `https://project-ref.supabase.co/storage/v1/object/public/${MENU_IMAGES_BUCKET}/${restaurantId}/${menuItemId}/my%20file.jpg`;
    expect(extractMenuImageObjectPath(url)).toBe(`${restaurantId}/${menuItemId}/my file.jpg`);
  });
});
