/**
 * Matches "prod" or "production" as a whole word, where anything other than a
 * letter separates words: "prod", "my-prod-db", "prod_eu", "db.prod.local"
 * and "prod1" match; "products" and "reproduction" do not.
 */
const PRODUCTION_WORD = /(^|[^a-z])prod(uction)?([^a-z]|$)/i;

/**
 * Name heuristic for "this target is probably production". Shared by the
 * renderer (to ask for confirmation) and the main process (which enforces it).
 */
export function looksLikeProduction(
  ...values: (string | null | undefined)[]
): boolean {
  return values.some(
    (value) => typeof value === "string" && PRODUCTION_WORD.test(value),
  );
}
