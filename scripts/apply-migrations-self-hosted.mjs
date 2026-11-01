#!/usr/bin/env node
// Applies the migrations to a self-hosted database over a direct Postgres
// connection, in the schema the team config names (`schema` in
// cloud/team.config.json, else public). scripts/apply-migration.mjs is the
// hosted project's way in, through Supabase's own API.
//
//   PGHOST=… PGPORT=5432 PGUSER=… PGPASSWORD=… PGDATABASE=postgres \
//     node scripts/apply-migrations-self-hosted.mjs [file.sql …]
//
// psql reads the connection from those variables, so the password is never
// in a command line. With no files it takes every migration, oldest first.
// All of them run in one transaction: one that fails leaves the database as
// it was. Every migration here is written to be run twice without harm.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCloudConfig } from '../main/team/session.mjs';
import { schemaOf } from '../shared/db-schema.mjs';
import { inSchema } from './lib/migrations-in-schema.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(root, 'cloud', 'supabase', 'migrations');
const PSQL_MS = 10 * 60_000;

export function migrationScript(files, schema) {
  const parts = files.map((f) => `-- ${path.basename(f)}\n${inSchema(fs.readFileSync(f, 'utf8'), schema)}`);
  return ['\\set ON_ERROR_STOP on', 'begin;', ...parts, 'commit;', ''].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.PGHOST || !process.env.PGUSER) throw new Error('set PGHOST, PGUSER and PGPASSWORD (and PGPORT, PGDATABASE) for the database');
  const schema = schemaOf(loadCloudConfig(root, { packaged: false, env: {} }));
  const given = process.argv.slice(2);
  const files = given.length ? given : fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(MIGRATIONS, f));
  console.log(`applying ${files.length} migration(s) in schema ${schema}, in one transaction`);
  const run = spawnSync('psql', ['-X', '-q', '-f', '-'], { input: migrationScript(files, schema), stdio: ['pipe', 'inherit', 'inherit'], timeout: PSQL_MS });
  if (run.error) throw run.error;
  if (run.status !== 0) { console.error('nothing was applied: the transaction was rolled back'); process.exit(run.status ?? 1); }
  console.log('applied');
}
