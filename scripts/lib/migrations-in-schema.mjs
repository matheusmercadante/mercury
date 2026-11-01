// The migrations are written for `public`. This rewrites one for another
// schema: its qualified names, the functions' search_path, the catalog
// lookups and the schema grants. `public` the role (`from public`), the
// pg_publication catalog and storage.buckets' `public` column are not names
// in the schema, and are left alone.
import { schemaOf } from '../../shared/db-schema.mjs';

export function inSchema(sql, schema) {
  const s = schemaOf({ schema });
  if (s === 'public') return sql;
  const moved = sql
    .replace(/\bsearch_path = public\b/g, `search_path = ${s}, public`)
    .replace(/\bschema public\b/g, `schema ${s}`)
    .replace(/\b(schemaname|table_schema) = 'public'/g, `$1 = '${s}'`)
    .replace(/\bpublic\.(?=[a-z_])/g, `${s}.`);
  return `create schema if not exists ${s};\ngrant usage on schema ${s} to anon, authenticated, service_role;\n${moved}`;
}
