import { describe, expect, it } from "vitest";
import {
  buildRecipeImageKey,
  isAllowedImageType,
  keyBelongsToRecipe,
} from "./storage.js";

describe("isAllowedImageType", () => {
  it("accepts the photo formats phones and browsers produce", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic"]) {
      expect(isAllowedImageType(type)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const type of ["image/svg+xml", "application/pdf", "text/html", ""]) {
      expect(isAllowedImageType(type)).toBe(false);
    }
  });
});

describe("buildRecipeImageKey", () => {
  it("scopes the key by household and recipe", () => {
    const key = buildRecipeImageKey("org_1", "rec_1", "image/jpeg");
    expect(key.startsWith("recipes/org_1/rec_1/")).toBe(true);
    expect(key.endsWith(".jpg")).toBe(true);
  });

  it("never repeats a key for the same recipe", () => {
    const a = buildRecipeImageKey("org_1", "rec_1", "image/png");
    const b = buildRecipeImageKey("org_1", "rec_1", "image/png");
    expect(a).not.toBe(b);
  });

  it("throws on a type that passed no validation", () => {
    expect(() => buildRecipeImageKey("org_1", "rec_1", "image/gif")).toThrow();
  });
});

describe("keyBelongsToRecipe", () => {
  const key = "recipes/org_1/rec_1/abc.jpg";

  it("accepts a key under the recipe's prefix", () => {
    expect(keyBelongsToRecipe(key, "org_1", "rec_1")).toBe(true);
  });

  // This is what stops a caller attaching another household's object by
  // passing its key to attachImage.
  it("rejects another household's or another recipe's key", () => {
    expect(keyBelongsToRecipe(key, "org_2", "rec_1")).toBe(false);
    expect(keyBelongsToRecipe(key, "org_1", "rec_2")).toBe(false);
  });

  it("rejects a prefix that only looks similar", () => {
    expect(keyBelongsToRecipe("recipes/org_10/rec_1/a.jpg", "org_1", "rec_1")).toBe(false);
  });
});
