/**
 * Unit conversion and grocery-line merging — pure functions, no Prisma.
 *
 * Callers pass plain unit records (the service fetches them); nothing here
 * touches the database, so it is directly unit-testable.
 *
 * A grocery list is a list of *things to buy*, so it gets one line per
 * ingredient — you buy one bag of flour regardless of how the recipes that
 * needed it were written. Quantities are best-effort on top of that: they add
 * up when the units belong to the same family, and are dropped when they
 * don't, leaving just the ingredient.
 *
 * Quantities never convert across families. Volume and weight would need
 * per-ingredient density (flour ≈ 0.53 g/ml vs. honey ≈ 1.42), which the
 * schema deliberately does not model, so "2 cups + 500g" yields "flour" with
 * no number rather than a confident wrong one.
 */

export type UnitRef = {
  id: string;
  type: string;
  /** Multiplier into the type's base unit. Null is treated as the base (1). */
  conversionFactor: number | null;
} | null;

export type MergeLine<T = unknown> = {
  ingredientId: string;
  quantity: number | null;
  unit: UnitRef;
  /** Caller's handle on this line (e.g. an existing row id). */
  meta: T;
};

export type MergedLine<T = unknown> = {
  ingredientId: string;
  quantity: number | null;
  unit: UnitRef;
  /** Every input line's `meta` that folded into this one, in input order. */
  sources: T[];
};

/** True when two units are the same family and their amounts can be summed. */
export function canMerge(a: UnitRef, b: UnitRef): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.type === b.type;
}

/** Converts an amount into its type's base unit. */
export function toBase(amount: number, unit: UnitRef): number {
  return amount * (unit?.conversionFactor ?? 1);
}

/** Converts an amount out of base units into `unit`. */
export function fromBase(amount: number, unit: UnitRef): number {
  return amount / (unit?.conversionFactor ?? 1);
}

/** Trims float noise so 1/3 cup x3 reads as 1, not 0.9999999999999999. */
function round(value: number, places = 3): number {
  return Number(value.toFixed(places));
}

/**
 * Collapses lines into one per ingredient.
 *
 * The surviving line keeps the unit of the *first quantified* occurrence, so
 * a list built from a recipe written in cups reads in cups rather than in
 * millilitres.
 *
 * A line with no quantity (a staple reminder, a "salt to taste" recipe entry)
 * has nothing to contribute and is skipped rather than treated as a
 * disagreement — it never blocks the other lines' amounts from summing. The
 * quantity is dropped only when two or more lines *do* have real amounts that
 * don't share a unit family (2 cups flour + 500g flour) — that's a genuine
 * conflict, not a gap, so the line keeps the ingredient and drops both
 * quantity and unit: "flour", with no number, which is what a shopping list
 * can honestly say when the recipes disagree on how to measure it. If no line
 * has a quantity at all, the result is the same bare ingredient, for the same
 * reason — there was never a number to show.
 *
 * Input order is preserved.
 */
export function mergeLines<T>(lines: MergeLine<T>[]): MergedLine<T>[] {
  const groups = new Map<string, MergeLine<T>[]>();

  for (const line of lines) {
    const group = groups.get(line.ingredientId);
    if (group) {
      group.push(line);
    } else {
      groups.set(line.ingredientId, [line]);
    }
  }

  return [...groups.values()].map((group) => {
    const first = group[0]!;
    const sources = group.map((line) => line.meta);

    const quantified = group.filter((line) => line.quantity !== null);
    const anchor = quantified[0];

    const summable =
      anchor !== undefined && quantified.every((line) => canMerge(anchor.unit, line.unit));

    if (!summable) {
      return { ingredientId: first.ingredientId, quantity: null, unit: null, sources };
    }

    const totalInBase = quantified.reduce(
      (sum, line) => sum + toBase(line.quantity as number, line.unit),
      0
    );
    return {
      ingredientId: first.ingredientId,
      quantity: round(fromBase(totalInBase, anchor.unit)),
      unit: anchor.unit,
      sources,
    };
  });
}
