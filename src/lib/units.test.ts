import { describe, expect, it } from "vitest";
import { canMerge, fromBase, mergeLines, toBase, type UnitRef } from "./units.js";

const ml: UnitRef = { id: "ml", type: "volume", conversionFactor: 1 };
const cup: UnitRef = { id: "cup", type: "volume", conversionFactor: 236.588 };
const tsp: UnitRef = { id: "tsp", type: "volume", conversionFactor: 4.92892 };
const gram: UnitRef = { id: "g", type: "weight", conversionFactor: 1 };
const pound: UnitRef = { id: "lb", type: "weight", conversionFactor: 453.592 };
const piece: UnitRef = { id: "pc", type: "count", conversionFactor: 1 };

describe("canMerge", () => {
  it("merges within a unit family", () => {
    expect(canMerge(cup, tsp)).toBe(true);
    expect(canMerge(gram, pound)).toBe(true);
  });

  it("refuses to cross volume, weight and count", () => {
    expect(canMerge(cup, gram)).toBe(false);
    expect(canMerge(piece, gram)).toBe(false);
  });

  it("merges unitless with unitless only", () => {
    expect(canMerge(null, null)).toBe(true);
    expect(canMerge(null, cup)).toBe(false);
  });
});

describe("toBase / fromBase", () => {
  it("round-trips through the base unit", () => {
    expect(toBase(2, cup)).toBeCloseTo(473.176);
    expect(fromBase(473.176, cup)).toBeCloseTo(2);
  });

  it("treats a null factor as the base unit", () => {
    expect(toBase(5, { id: "x", type: "count", conversionFactor: null })).toBe(5);
  });
});

describe("mergeLines", () => {
  const line = (ingredientId: string, quantity: number | null, unit: UnitRef, meta = "") => ({
    ingredientId,
    quantity,
    unit,
    meta,
  });

  it("sums same-unit lines", () => {
    const merged = mergeLines([line("flour", 2, cup), line("flour", 0.5, cup)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ quantity: 2.5, unit: cup });
  });

  it("converts within a family and reports in the first unit seen", () => {
    const [merged] = mergeLines([line("milk", 1, cup), line("milk", 236.588, ml)]);
    expect(merged!.unit).toBe(cup);
    expect(merged!.quantity).toBe(2);
  });

  // A grocery list is a list of things to buy: you buy one bag of flour, so
  // mismatched units collapse to one line without a number, not two lines.
  it("gives one unquantified line when units are incompatible", () => {
    const merged = mergeLines([line("flour", 2, cup), line("flour", 500, gram)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ ingredientId: "flour", quantity: null, unit: null });
  });

  // A staple reminder or a "salt to taste" recipe entry has nothing to add —
  // it shouldn't block a real quantity elsewhere from surviving the merge.
  it("ignores a line with no quantity rather than blanking the total", () => {
    const merged = mergeLines([line("salt", null, null), line("salt", 2, tsp)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ quantity: 2, unit: tsp });
  });

  it("still drops the quantity when the real amounts genuinely conflict", () => {
    const merged = mergeLines([
      line("flour", null, null),
      line("flour", 2, cup),
      line("flour", 500, gram),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ quantity: null, unit: null });
  });

  it("gives no quantity when every line for an ingredient lacks one", () => {
    const merged = mergeLines([line("onion", null, null), line("onion", null, null)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ quantity: null, unit: null });
  });

  it("keeps different ingredients apart", () => {
    expect(mergeLines([line("flour", 1, cup), line("sugar", 1, cup)])).toHaveLength(2);
  });

  it("reports every source that folded into a line", () => {
    const [merged] = mergeLines([
      line("flour", 1, cup, "row-1"),
      line("flour", 1, cup, "row-2"),
      line("flour", 1, gram, "row-3"),
    ]);
    expect(merged!.sources).toEqual(["row-1", "row-2", "row-3"]);
  });

  it("trims floating-point noise", () => {
    const third: UnitRef = { id: "third", type: "volume", conversionFactor: 1 / 3 };
    const [merged] = mergeLines([
      line("flour", 1, third),
      line("flour", 1, third),
      line("flour", 1, third),
    ]);
    expect(merged!.quantity).toBe(3);
  });

  it("preserves input order", () => {
    const merged = mergeLines([line("b", 1, cup), line("a", 1, cup)]);
    expect(merged.map((l) => l.ingredientId)).toEqual(["b", "a"]);
  });

  it("returns an empty list unchanged", () => {
    expect(mergeLines([])).toEqual([]);
  });
});
