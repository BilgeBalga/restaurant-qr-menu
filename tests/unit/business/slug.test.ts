import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/business/slug";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Classic Burger")).toBe("classic-burger");
  });

  it("strips punctuation and collapses repeated separators", () => {
    expect(slugify("Mac & Cheese!!")).toBe("mac-cheese");
    expect(slugify("  Extra   Spicy  ")).toBe("extra-spicy");
  });

  it("removes diacritics", () => {
    expect(slugify("Café Latté")).toBe("cafe-latte");
  });

  it("trims leading/trailing hyphens produced by leading/trailing punctuation", () => {
    expect(slugify("-Starters-")).toBe("starters");
  });

  it("falls back to a stable placeholder for input with nothing sluggable", () => {
    expect(slugify("!!!")).toBe("item");
    expect(slugify("")).toBe("item");
  });

  it("truncates very long names", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });
});
