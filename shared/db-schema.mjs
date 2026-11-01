// WHICH POSTGRES SCHEMA THE APP'S TABLES LIVE IN: `public`, unless the team
// cloud's config names another, as a database shared by several apps does.
// A name that is not a plain identifier is refused rather than passed over,
// because scripts/lib/migrations-in-schema.mjs writes it into SQL.
export const DEFAULT_SCHEMA = 'public';

export function schemaOf(config) {
  const s = config?.schema;
  if (s == null || s === '') return DEFAULT_SCHEMA;
  if (typeof s !== 'string' || !/^[a-z_][a-z0-9_]{0,62}$/.test(s)) throw new Error(`not a schema name: ${JSON.stringify(s)}`);
  return s;
}
