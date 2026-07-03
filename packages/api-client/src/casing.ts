// snake_case (SQL) <-> camelCase (@setflow/shared) mapping helpers.
// The database uses snake_case columns; app types use camelCase fields.

const camelToSnakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const snakeToCamelKey = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

const mapKeys = (obj: Record<string, unknown>, fn: (k: string) => string) =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [fn(k), v]));

/** DB row -> app object. Shallow: our schema has no nested JSON objects. */
export function rowToApp<T>(row: Record<string, unknown>): T {
  return mapKeys(row, snakeToCamelKey) as T;
}

/** App object -> DB row, dropping undefined so partial patches stay partial. */
export function appToRow(obj: Record<string, unknown>): Record<string, unknown> {
  const clean = Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
  return mapKeys(clean, camelToSnakeKey);
}
