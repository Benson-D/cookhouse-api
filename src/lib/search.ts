/**
 * Escapes SQL LIKE wildcards (`%`, `_`) and the escape character itself
 * (`\`) in `term`, so a literal percent sign or underscore in a search
 * behaves as a literal character rather than a wildcard.
 *
 * Prisma's `contains`/`startsWith`/`endsWith` don't escape these by
 * default — searching "100%" would otherwise match anything starting with
 * "100", not literally "100%". Apostrophes and quotes need no equivalent
 * handling: Prisma always parameterizes filter values, so those can't break
 * or inject anything.
 */
export function escapeLikeWildcards(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}
