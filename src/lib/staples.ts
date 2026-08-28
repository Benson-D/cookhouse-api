export const DAY_MS = 24 * 60 * 60 * 1000;

export type StapleFrequency = { ingredientId: string; frequencyDays: number };

/**
 * Which of the given staples the household was checked off for recently
 * enough that it's still "good" — i.e. a recipe calling for it shouldn't
 * re-add it to the list. `lastCheckedAt` is the most recent checked-off
 * timestamp per ingredient id (the service resolves that from a completed
 * list's `GroceryListItem` rows); a staple with no entry there has never
 * been checked off and so is never "fresh."
 */
export function computeFreshlyStocked(
  staples: StapleFrequency[],
  lastCheckedAt: Map<string, Date>,
  now: number
): Set<string> {
  const fresh = new Set<string>();
  for (const staple of staples) {
    const checkedAt = lastCheckedAt.get(staple.ingredientId);
    if (checkedAt && checkedAt.getTime() + staple.frequencyDays * DAY_MS > now) {
      fresh.add(staple.ingredientId);
    }
  }
  return fresh;
}
