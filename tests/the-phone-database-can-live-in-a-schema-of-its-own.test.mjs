// THE PHONE'S DATABASE CAN LIVE IN A SCHEMA OF ITS OWN (w-78b5ec0ef7, 2026-11-01).
//
// The database this copy signs in to is a self-hosted Supabase shared by
// several apps, and that server's rule is one schema per app. Every
// migration, the Mac's client, its realtime listeners and the phone site's
// REST calls all said `public`: rg counted 860 `public.` names in
// cloud/supabase/migrations and ten realtime listeners pinned to
// `schema: 'public'`, so the tables could only ever go in `public`.
//
// Now `schema` in cloud/team.config.json names the schema; without it,
// everything is `public`, byte for byte as before.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const made = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url, key, options) => {
    const listened = [];
    const client = {
      options,
      listened,
      auth: { getSession: async () => ({ data: { session: { access_token: 't', user: { id: 'me' } } } }) },
      channel: () => {
        const ch = { on: (kind, filter) => { listened.push(filter); return ch; }, subscribe: () => ch };
        return ch;
      },
      removeChannel: () => {},
    };
    made.push(client);
    return client;
  },
}));

const { schemaOf } = await import('../shared/db-schema.mjs');
const { inSchema } = await import('../scripts/lib/migrations-in-schema.mjs');
const { migrationScript } = await import('../scripts/apply-migrations-self-hosted.mjs');
const { supabaseSession, loadCloudConfig } = await import('../main/team/session.mjs');
const { supabaseBackend } = await import('../main/team/supabase-backend.mjs');
const { cloudClient } = await import('../renderer/src/cloud-rest.ts');
const { readCloudConfig } = await import('../renderer/src/cloud-bridge.ts');
const { buildPhoneSite } = await import('../scripts/build-phone-site.mjs');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrations = path.join(repo, 'cloud', 'supabase', 'migrations');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'schema-'));

beforeEach(() => { made.length = 0; });

describe('the schema a config names', () => {
  it('is public when the config names none', () => {
    expect(schemaOf({})).toBe('public');
    expect(schemaOf(null)).toBe('public');
    expect(schemaOf({ schema: '' })).toBe('public');
  });

  it('is the one named', () => {
    expect(schemaOf({ schema: 'mercury' })).toBe('mercury');
    expect(schemaOf({ schema: 'my_app2' })).toBe('my_app2');
  });

  it('refuses a name that is not a plain lowercase identifier, since it is written into SQL', () => {
    for (const bad of ['Mercury', 'mer-cury', '1app', 'x; drop table people', 'a.b', 42]) {
      expect(() => schemaOf({ schema: bad }), String(bad)).toThrow(/schema/);
    }
  });
});

describe('a migration rewritten for another schema', () => {
  const sql = [
    'create table if not exists public.people (id uuid primary key);',
    'create or replace function public.my_teams() returns setof uuid',
    'language sql stable security definer set search_path = public as $$ select 1 $$;',
    'create or replace function public.forget_me() returns void',
    'language plpgsql security definer set search_path = public, auth as $$ begin end $$;',
    "if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'x') then",
    "select 1 from information_schema.tables where table_schema = 'public' and table_name = 'x';",
    'grant usage on schema public to authenticated;',
    "execute format('revoke all on function %s from public, anon', f);",
    'revoke execute on function public.my_teams() from anon, public;',
    "if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then",
    "insert into storage.buckets (id, name, public, file_size_limit) values ('phone-files', 'phone-files', false, 1)",
    '  on conflict (id) do update set public = false;',
  ].join('\n');
  const out = inSchema(sql, 'mercury');

  it('makes the schema first, usable by the roles the API signs in as', () => {
    expect(out.startsWith('create schema if not exists mercury;\ngrant usage on schema mercury to anon, authenticated, service_role;\n')).toBe(true);
  });

  it('moves the qualified names, the search paths, the catalog lookups and the schema grants', () => {
    expect(out).toContain('create table if not exists mercury.people');
    expect(out).toContain('set search_path = mercury, public as $$');
    expect(out).toContain('set search_path = mercury, public, auth as $$');
    expect(out).toContain("schemaname = 'mercury'");
    expect(out).toContain("table_schema = 'mercury'");
    expect(out).toContain('grant usage on schema mercury to authenticated;');
    expect(out).toContain('revoke execute on function mercury.my_teams() from anon, public;');
  });

  it('leaves the role named public, the publication catalog and the bucket column alone', () => {
    expect(out).toContain("revoke all on function %s from public, anon'");
    expect(out).toContain('from anon, public;');
    expect(out).toContain('from pg_publication where');
    expect(out).toContain('insert into storage.buckets (id, name, public, file_size_limit)');
    expect(out).toContain('set public = false;');
  });

  it('is the migration unchanged for public', () => {
    expect(inSchema(sql, 'public')).toBe(sql);
  });

  it('leaves no table, function or lookup of the real migrations in public', () => {
    for (const file of fs.readdirSync(migrations).filter((f) => f.endsWith('.sql'))) {
      const moved = inSchema(fs.readFileSync(path.join(migrations, file), 'utf8'), 'mercury');
      expect(moved, file).not.toMatch(/\bpublic\.[a-z_]/);
      expect(moved, file).not.toMatch(/= 'public'/);
      expect(moved, file).not.toMatch(/\bschema public\b/);
      expect(moved, file).not.toMatch(/search_path = public/);
    }
  });

  it('applies every migration, oldest first, in one transaction that stops at the first error', () => {
    const files = fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(migrations, f));
    const script = migrationScript(files, 'mercury');
    expect(script.startsWith('\\set ON_ERROR_STOP on\nbegin;\n')).toBe(true);
    expect(script.trimEnd().endsWith('commit;')).toBe(true);
    const at = files.map((f) => script.indexOf(`-- ${path.basename(f)}\n`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});

describe('the Mac', () => {
  const sessionFor = (cloudConfig) => supabaseSession({ cloudConfig, sessionFile: path.join(tmp(), 's'), openExternal: () => {}, packaged: false, testLogin: null });

  it('asks the database for the schema its config names', async () => {
    const backend = await sessionFor({ url: 'https://api.example', anonKey: 'k', schema: 'mercury' }).restore();
    expect(made[0].options.db).toEqual({ schema: 'mercury' });
    backend.subscribe(() => {});
    expect(made[0].listened.length).toBeGreaterThan(0);
    expect(made[0].listened.every((f) => f.schema === 'mercury')).toBe(true);
  });

  it('asks for public, as before, with none named', async () => {
    const backend = await sessionFor({ url: 'https://api.example', anonKey: 'k' }).restore();
    expect(made[0].options.db).toEqual({ schema: 'public' });
    backend.subscribe(() => {});
    expect(made[0].listened.every((f) => f.schema === 'public')).toBe(true);
  });

  it('listens to the rooms in that schema too', () => {
    const listened = [];
    const ch = { on: (kind, filter) => { listened.push(filter); return ch; }, subscribe: () => ch };
    const backend = supabaseBackend({ channel: () => ch, removeChannel: () => {} }, { schema: 'mercury' });
    backend.subscribeRooms(() => {});
    expect(listened.length).toBe(8);
    for (const f of listened) expect(f.schema).toBe('mercury');
  });

  it('reads the schema from the checkout\'s team file', () => {
    const app = tmp();
    fs.mkdirSync(path.join(app, 'cloud'));
    fs.writeFileSync(path.join(app, 'cloud', 'team.config.json'), JSON.stringify({ url: 'https://api.example', anonKey: 'k', schema: 'mercury' }));
    expect(loadCloudConfig(app, { packaged: false, home: tmp(), env: {} }).schema).toBe('mercury');
  });

  it('a packaged build carries the schema it was baked with', () => {
    const app = tmp();
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ bakedTeam: { url: 'https://api.example', anonKey: 'k', schema: 'mercury' } }));
    expect(loadCloudConfig(app, { packaged: true, home: tmp(), env: {} }).schema).toBe('mercury');
    const release = fs.readFileSync(path.join(repo, 'scripts', 'release.mjs'), 'utf8');
    expect(release).toMatch(/\['url', 'anonKey', 'phoneSite', 'schema'\]/);
  });
});

describe('the phone site', () => {
  // Signed in, as the site is once its person has signed in.
  const signedIn = JSON.stringify({ access_token: 't', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'me' } });
  const store = () => { const m = new Map([['agentbox-cloud-session', signedIn]]); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, headers: init.headers }); return new Response('[]', { status: 200 }); };

  it('reads and writes the schema it was built with', async () => {
    calls.length = 0;
    const client = cloudClient({ url: 'https://api.example', anonKey: 'k', schema: 'mercury' }, { storage: store(), fetchImpl });
    await client.rpc('my_teams', {}).catch(() => {});
    await client.select?.('phone_threads', 'select=*').catch(() => {});
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls.filter((c) => c.url.includes('/rest/v1/'))) {
      expect(c.headers['accept-profile']).toBe('mercury');
      expect(c.headers['content-profile']).toBe('mercury');
    }
  });

  it('sends no profile at all for public, as before', async () => {
    calls.length = 0;
    const client = cloudClient({ url: 'https://api.example', anonKey: 'k' }, { storage: store(), fetchImpl });
    await client.rpc('my_teams', {}).catch(() => {});
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.headers['accept-profile']).toBeUndefined();
      expect(c.headers['content-profile']).toBeUndefined();
    }
  });

  it('finds the schema in its page, and refuses one that is not a name', () => {
    const page = (content) => ({ querySelector: () => ({ getAttribute: () => content }) });
    expect(readCloudConfig(page('{"url":"https://api.example","anonKey":"k","schema":"mercury"}'))).toEqual({ url: 'https://api.example', anonKey: 'k', schema: 'mercury' });
    expect(readCloudConfig(page('{"url":"https://api.example","anonKey":"k"}'))).toEqual({ url: 'https://api.example', anonKey: 'k' });
    expect(readCloudConfig(page('{"url":"https://api.example","anonKey":"k","schema":"x; drop"}'))).toBeNull();
  });

  it('is built with the schema in its page only when there is one', () => {
    const dir = tmp();
    const dist = path.join(dir, 'dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
    fs.writeFileSync(path.join(dir, 'icon.png'), 'png');
    const build = (cfg) => {
      fs.writeFileSync(path.join(dir, 'team.config.json'), JSON.stringify(cfg));
      buildPhoneSite({ dist, out: path.join(dir, 'out'), configFile: path.join(dir, 'team.config.json'), icon: path.join(dir, 'icon.png'), legal: path.join(dir, 'none'), log: () => {}, stamp: null });
      return fs.readFileSync(path.join(dir, 'out', 'index.html'), 'utf8');
    };
    expect(build({ url: 'https://api.example', anonKey: 'eyJhbGciOi.public-key_1234567890', schema: 'mercury' }))
      .toContain(`content='{"url":"https://api.example","anonKey":"eyJhbGciOi.public-key_1234567890","schema":"mercury"}'`);
    expect(build({ url: 'https://api.example', anonKey: 'eyJhbGciOi.public-key_1234567890' }))
      .toContain(`content='{"url":"https://api.example","anonKey":"eyJhbGciOi.public-key_1234567890"}'`);
    expect(() => build({ url: 'https://api.example', anonKey: 'eyJhbGciOi.public-key_1234567890', schema: "x'><script>" })).toThrow(/schema/);
  });
});
