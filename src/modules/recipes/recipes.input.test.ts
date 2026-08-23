import { describe, expect, it } from "vitest";
import {
  createRecipeInput,
  listRecipesInput,
  updateRecipeInput,
} from "./recipes.input.js";

describe("createRecipeInput", () => {
  const minimal = { name: "Soup", instructions: [{ step: 1, text: "Boil" }] };

  it("fills in empty ingredients and tags", () => {
    const parsed = createRecipeInput.parse(minimal);
    expect(parsed.ingredients).toEqual([]);
    expect(parsed.tagIds).toEqual([]);
  });

  it("rejects a blank name", () => {
    expect(createRecipeInput.safeParse({ ...minimal, name: "" }).success).toBe(false);
  });

  it("rejects a non-positive ingredient amount", () => {
    const result = createRecipeInput.safeParse({
      ...minimal,
      ingredients: [{ ingredientId: "i1", amount: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed sourceUrl", () => {
    expect(
      createRecipeInput.safeParse({ ...minimal, sourceUrl: "not-a-url" }).success
    ).toBe(false);
  });
});

describe("updateRecipeInput", () => {
  it("requires an id but nothing else", () => {
    expect(updateRecipeInput.safeParse({ id: "r1" }).success).toBe(true);
    expect(updateRecipeInput.safeParse({ name: "Soup" }).success).toBe(false);
  });
});

describe("listRecipesInput", () => {
  it("defaults to the first page when omitted entirely", () => {
    expect(listRecipesInput.parse(undefined)).toMatchObject({ skip: 0, take: 20 });
  });

  // The cap is what stops a client asking for every recipe in one request.
  it("rejects a page size above the cap", () => {
    expect(listRecipesInput.safeParse({ take: 101 }).success).toBe(false);
    expect(listRecipesInput.safeParse({ take: 100 }).success).toBe(true);
  });

  it("rejects a negative skip", () => {
    expect(listRecipesInput.safeParse({ skip: -1 }).success).toBe(false);
  });
});
