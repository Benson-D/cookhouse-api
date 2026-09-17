import { describe, expect, it } from "vitest";
import { categorize } from "./categorize.js";

describe("categorize", () => {
  it("matches plain produce, dairy, and meat items", () => {
    expect(categorize("banana")).toBe("produce");
    expect(categorize("milk")).toBe("dairy");
    expect(categorize("chicken thighs")).toBe("meat");
  });

  it("matches a plural form of a singular keyword", () => {
    expect(categorize("bananas")).toBe("produce");
    expect(categorize("tomatoes")).toBe("produce");
  });

  it("does not break on a word that already ends in s", () => {
    expect(categorize("asparagus")).toBe("produce");
    expect(categorize("hummus")).toBe(null);
  });

  it("matches alcohol and household items", () => {
    expect(categorize("beer")).toBe("alcohol");
    expect(categorize("cabernet wine")).toBe("alcohol");
    expect(categorize("dish soap")).toBe("household");
    expect(categorize("paper towels")).toBe("household");
  });

  it("splits apple cider (beverages) from bare cider (alcohol)", () => {
    expect(categorize("apple cider")).toBe("beverages");
    expect(categorize("cider")).toBe("alcohol");
  });

  it("resolves hard seltzer to alcohol, not beverages' bare seltzer", () => {
    expect(categorize("hard seltzer")).toBe("alcohol");
    expect(categorize("seltzer water")).toBe("beverages");
  });

  it("does not miscategorize root beer as alcohol", () => {
    expect(categorize("root beer")).toBe("beverages");
  });

  it("resolves compound-phrase overrides before the generic keyword would", () => {
    expect(categorize("almond milk")).toBe("beverages");
    expect(categorize("oat milk")).toBe("beverages");
    expect(categorize("peanut butter")).toBe("pantry");
    expect(categorize("coconut milk")).toBe("pantry");
    expect(categorize("green beans")).toBe("produce");
    expect(categorize("chicken broth")).toBe("pantry");
  });

  it("resolves a jarred/preserved form to pantry, not the fresh-produce word it contains", () => {
    expect(categorize("sun-dried tomatoes")).toBe("pantry");
    expect(categorize("roasted red peppers")).toBe("pantry");
    expect(categorize("split peas")).toBe("pantry");
    expect(categorize("tomatoes")).toBe("produce");
    expect(categorize("peas")).toBe("produce");
  });

  it("resolves a sauce/condiment to pantry, not the meat word it contains", () => {
    expect(categorize("oyster sauce")).toBe("pantry");
    expect(categorize("fish sauce")).toBe("pantry");
    expect(categorize("oysters")).toBe("meat");
    expect(categorize("fish")).toBe("meat");
  });

  it("resolves a spiced/prepared form to its own category, not the base word's", () => {
    expect(categorize("ground ginger")).toBe("spices");
    expect(categorize("celery salt")).toBe("spices");
    expect(categorize("hot chocolate")).toBe("beverages");
    expect(categorize("ginger ale")).toBe("beverages");
    expect(categorize("pork rinds")).toBe("snacks");
    expect(categorize("ginger")).toBe("produce");
    expect(categorize("chocolate")).toBe("desserts");
    expect(categorize("pork")).toBe("meat");
  });

  it("resolves a seed/powder form to spices, not the produce or pantry word it contains", () => {
    expect(categorize("coriander seed")).toBe("spices");
    expect(categorize("fennel seed")).toBe("spices");
    expect(categorize("mustard seed")).toBe("spices");
    // Bare forms still resolve to their usual category.
    expect(categorize("coriander")).toBe("produce");
    expect(categorize("fennel")).toBe("produce");
    expect(categorize("mustard")).toBe("pantry");
  });

  it("pluralizes a consonant + y keyword as -ies, not a simple +s suffix", () => {
    expect(categorize("blueberry")).toBe("produce");
    expect(categorize("blueberries")).toBe("produce");
    expect(categorize("strawberries")).toBe("produce");
    expect(categorize("cherries")).toBe("produce");
    expect(categorize("candies")).toBe("desserts");
  });

  it("resolves ranch seasoning to spices, not pantry's bare ranch (dressing)", () => {
    expect(categorize("ranch")).toBe("pantry");
    expect(categorize("ranch seasoning")).toBe("spices");
  });

  it("does not match a keyword mid-word", () => {
    // "oat" should not match inside "goat", nor "nut" inside "coconut".
    expect(categorize("goat cheese")).toBe("dairy");
    expect(categorize("coconut")).toBe("pantry");
  });

  it("returns null for garbled or unrecognized OCR text rather than guessing", () => {
    expect(categorize("GV WHL MLK")).toBe(null);
    expect(categorize("xyz123")).toBe(null);
    expect(categorize("")).toBe(null);
  });
});
