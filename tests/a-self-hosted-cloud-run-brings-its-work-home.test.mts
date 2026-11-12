// A SELF-HOSTED CLOUD RUN BRINGS ITS WORK HOME.
//
// The self-hosted cloud (cloud/selfhost/server.mjs) is the managed cloud's
// server on a machine of the owner's own: the same gateway, with a bucket on
// its disk in place of S3, a container a session in place of AgentCore, and a
// door that checks the database's signature in place of asking it. The Mac
// talks to it as it talks to the managed cloud (main/cloud/managed.mts). If any
// part answered differently, a thread would say it finished while its work
// stayed on the server. Driven for real on one machine: the real sandbox
// server as each session's container, the bucket's signed links over HTTP, a
// real ES256 session, and the Mac's real run code.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSandbox } from '../cloud/sandbox/server.mjs';
import { selfHostedCloud } from '../cloud/selfhost/server.mjs';
import { dockerSessions } from '../cloud/selfhost/sessions.mjs';
import { managedClients } from '../main/cloud/managed.mts';
import { TERMS_VERSION } from '../cloud/gateway/terms.mjs';
import { cloudRun } from '../main/cloud/run.mts';
import { envName } from '../shared/product-name.mjs';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const FAKE_CLAUDE = here('./fixtures/cloud/fake-claude.mjs');
const FAKE_STORE = here('./fixtures/cloud/fake-store-server.mjs');
const STUB = here('../cloud/sandbox/mcp-stub.mjs');
const PERSON = '33333333-3333-4333-8333-333333333333';
const STRANGER = '44444444-4444-4444-8444-444444444444';
const ISSUER = 'https://db.example.test/auth/v1';
const LOGIN = { engine: 'claude', id: 'L1', key: 'logins/claude/L1.json' };

const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwks = { keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'ES256' }] };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sessionOf(sub: string) {
  const head = `${b64({ alg: 'ES256', kid: 'k1', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', iss: ISSUER, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${head}.${crypto.sign('sha256', Buffer.from(head), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

type Container = { sandbox: ReturnType<typeof createSandbox>; url: string; session: string };
let tmp: string; let server: http.Server; let base: string; let mac: string;
let cloud: Awaited<ReturnType<typeof selfHostedCloud>>; let containers: Map<string, Container>;
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

// docker, as the sessions use it, with the real sandbox server as each container.
async function docker(args: string[]) {
  const [cmd, ...rest] = args;
  if (cmd === 'inspect') return containers.has(rest[rest.length - 1]) ? { code: 0, stdout: 'true\n', stderr: '' } : { code: 1, stdout: '', stderr: 'No such object' };
  if (cmd === 'run') {
    const name = rest[rest.indexOf('--name') + 1];
    const session = rest[rest.indexOf('--label') + 1].replace(/^mercury\.session=/, '');
    const root = path.join(tmp, name);
    const sandbox = createSandbox({ workRoot: path.join(root, 'work'), pathRoot: path.join(root, 'vm'), bridgeSocket: path.join(tmp, `${name.slice(-8)}.sock`) });
    const url = `http://127.0.0.1:${(await sandbox.listen(0, '127.0.0.1')).port}`;
    containers.set(name, { sandbox, url, session });
    return { code: 0, stdout: name, stderr: '' };
  }
  if (cmd === 'rm') {
    const c = containers.get(rest[rest.length - 1]);
    if (c) { await c.sandbox.close(); containers.delete(rest[rest.length - 1]); }
    return { code: c ? 0 : 1, stdout: '', stderr: c ? '' : 'No such container' };
  }
  return { code: 0, stdout: '', stderr: '' };
}

beforeEach(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'selfhost-run-')));
  containers = new Map();
  server = http.createServer((req, res) => cloud.handler(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  cloud = await selfHostedCloud({
    dataDir: path.join(tmp, 'cloud'), secret: 'only-the-server-knows', publicUrl: base,
    jwks, people: [PERSON], issuer: ISSUER, agents: 2,
    sessions: dockerSessions({ docker, image: 'sandbox', network: 'net', memory: '2g', cpus: '1', pids: 256, addressOf: (n: string) => containers.get(n)?.url ?? 'http://127.0.0.1:9', readyMs: 5000, pollMs: 20, timeoutMs: 30_000 }),
  });
  // The person's Claude sign-in for the cloud, kept under their own space.
  await cloud.bucket.objects.put(`logins/u-${PERSON}/claude/L1.json`, JSON.stringify({ engine: 'claude', token: 'tok-123-cloud-signin-only' }));

  mac = path.join(tmp, 'mac', 'repo');
  fs.mkdirSync(mac, { recursive: true });
  git(mac, 'init', '-q', '-b', 'main');
  git(mac, 'config', 'user.email', 'dev@example.com');
  git(mac, 'config', 'user.name', 'Dev');
  fs.writeFileSync(path.join(mac, 'a.txt'), 'one\n');
  git(mac, 'add', '.');
  git(mac, 'commit', '-q', '-m', 'first');
  git(mac, 'checkout', '-q', '-b', 'agentbox/w-1');
});

afterEach(async () => {
  cloud?.stopTimers();
  for (const c of containers.values()) await c.sandbox.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

const devices = (session: string) => fetch(`${base}/v1/devices`, {
  method: 'POST', headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Mac', acceptedTerms: TERMS_VERSION }), signal: AbortSignal.timeout(5000),
});

function launch({ transport, storage }: ReturnType<typeof managedClients>) {
  const configDir = path.join(tmp, 'mac', 'claude-home');
  fs.mkdirSync(configDir, { recursive: true });
  const mcpFile = path.join(tmp, 'mac', 'mcp.json');
  fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { agentbox: { command: process.execPath, args: [FAKE_STORE], env: { FAKE_STORE_LOG: path.join(tmp, 'store.log') } } } }));
  const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
  let out = ''; let err = '';
  stdout.on('data', (d) => { out += d; if (out.includes('"type":"result"')) stdin.end(); });
  stderr.on('data', (d) => { err += d; });
  const done = cloudRun({
    argv: [FAKE_CLAUDE, '-p', '--output-format', 'stream-json', '--mcp-config', mcpFile],
    env: { ...process.env, ZERO_ITEM: 'w-1', ZERO_PRODUCT: 'p', CLAUDE_CONFIG_DIR: configDir, [envName('HOME')]: path.join(tmp, 'mac') },
    cwd: mac, transport, storage, login: LOGIN,
    stdin, stdout, stderr, remoteCommand: process.execPath, stubPath: STUB, pollWaitMs: 200, resultsWaitMs: 8000, watchParent: false, signals: new EventEmitter(),
    homeDir: path.join(tmp, 'home'),
  });
  stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: 'please do it' } }) + '\n');
  return { done, out: () => out, err: () => err };
}

const keysOnDisk = (dir: string): string[] => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).map(decodeURIComponent).join('/'));

describe('a self-hosted cloud run', () => {
  it('runs on the owner\'s cloud sign-in in a container of its own, lays its commit home and keeps everything in their space', async () => {
    const key = (await (await devices(sessionOf(PERSON))).json()).key;
    const clients = managedClients({ url: base, key });
    const run = launch(clients);
    expect(await run.done, run.err()).toBe(0);
    const result = JSON.parse(JSON.parse(run.out().split('\n').find((l) => l.includes('"type":"result"'))!).result);
    expect(result.said).toBe('noted on the Mac for w-1');
    expect(result.token).toBe('[cloud sign-in]');
    expect(git(mac, 'log', '-1', '--format=%s')).toBe('From the cloud');
    expect(fs.readFileSync(path.join(mac, 'cloud.txt'), 'utf8')).toBe('made in the cloud\n');
    const onDisk = keysOnDisk(path.join(tmp, 'cloud', 'objects'));
    expect(onDisk.filter((k) => !k.startsWith(`runs/u-${PERSON}/`) && !k.startsWith(`logins/u-${PERSON}/`) && !k.startsWith('ledger/'))).toEqual([]);
    expect((await clients.me()).running).toBe(0);
  });

  it('gives the owner the plan it was set up with', async () => {
    const key = (await (await devices(sessionOf(PERSON))).json()).key;
    expect(await managedClients({ url: base, key }).me()).toMatchObject({ plan: 'self', agents: 2 });
  });

  it('a signed-in stranger gets no key to it', async () => {
    const res = await devices(sessionOf(STRANGER));
    expect(res.status).toBe(401);
    expect((await res.json()).key).toBeUndefined();
  });
});
