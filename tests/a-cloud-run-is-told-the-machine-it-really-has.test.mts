// A CLOUD RUN IS TOLD THE MACHINE IT REALLY HAS.
//
// A thread run on a self-hosted cloud said so itself (2026-11-12): its note
// told it "2 cores, 8 GB of memory", the managed cloud's machine, while the
// container it ran in had 2 cores and 3 GB. An agent that plans a build or a
// browser for 8 GB on 3 is stopped halfway by the memory guard. The note's
// numbers were written in the app, never read from the machine.
//
// Now the sandbox measures its machine (its container's limits, else the
// machine's own, and the free disk under its work folder) and says it in a
// start's answer; the Mac keeps what it heard, per cloud, and the next run's
// note says that. A cloud never heard from is told the managed cloud's
// machine, as before.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { createSandbox, pickBaseEnv } from '../cloud/sandbox/server.mjs';
import { machineSize } from '../cloud/sandbox/machine.mjs';
import { cloudRun, cloudNote, CLOUD_NOTE, PLAIN_CLOUD_NOTE } from '../main/cloud/run.mts';
import { cloudMachine, noteCloudMachine, noteImageCaps, imageCaps } from '../main/cloud/config.mts';
import { TOKEN } from './fixtures/cloud/fake-vendor-cli.mjs';

const GB = 2 ** 30;
const OLYMPUS = { cores: 2, memoryGB: 3, swapGB: 0, diskGB: 41 };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

let tmp;
beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-machine-'))); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A fake /sys/fs/cgroup and /proc, written as the kernel writes them.
function machine({ memoryMax = 'max', cpuMax = 'max 100000', swapMax = 'max', memTotalKb = 16 * 2 ** 20, swapTotalKb = 0 } = {}) {
  const cgroup = path.join(tmp, 'cgroup');
  const proc = path.join(tmp, 'proc');
  fs.mkdirSync(cgroup, { recursive: true });
  fs.mkdirSync(proc, { recursive: true });
  fs.writeFileSync(path.join(cgroup, 'memory.max'), `${memoryMax}\n`);
  fs.writeFileSync(path.join(cgroup, 'cpu.max'), `${cpuMax}\n`);
  fs.writeFileSync(path.join(cgroup, 'memory.swap.max'), `${swapMax}\n`);
  fs.writeFileSync(path.join(proc, 'meminfo'), `MemTotal:       ${Math.round(memTotalKb)} kB\nMemFree:        1024 kB\nSwapTotal:      ${Math.round(swapTotalKb)} kB\n`);
  return { cgroup, proc };
}
const disk = (freeBytes) => () => ({ bavail: freeBytes / 4096, bsize: 4096 });

describe('the sandbox measures its machine', () => {
  it('by its container\'s limits when it has them', () => {
    const size = machineSize({ ...machine({ memoryMax: String(3 * GB), cpuMax: '200000 100000' }), dir: tmp, statfs: disk(41.6 * GB), cpuCount: () => 20 });
    expect(size).toEqual({ cores: 2, memoryGB: 3, swapGB: 0, diskGB: 41 });
  });

  it('by the machine\'s own when the container has none', () => {
    const size = machineSize({ ...machine({ memTotalKb: 7.7 * 2 ** 20 }), dir: tmp, statfs: disk(5.2 * GB), cpuCount: () => 2 });
    expect(size).toEqual({ cores: 2, memoryGB: 8, swapGB: 0, diskGB: 5 });
  });

  it('with the swap the container may use of the machine\'s', () => {
    const roomy = machine({ memoryMax: String(3 * GB), swapTotalKb: 2 * 2 ** 20 });
    expect(machineSize({ ...roomy, dir: tmp, statfs: disk(GB), cpuCount: () => 2 }).swapGB).toBe(2);
    const none = machine({ memoryMax: String(3 * GB), swapTotalKb: 2 * 2 ** 20, swapMax: '0' });
    expect(machineSize({ ...none, dir: tmp, statfs: disk(GB), cpuCount: () => 2 }).swapGB).toBe(0);
  });

  it('and a part of a core is said as it is', () => {
    expect(machineSize({ ...machine({ cpuMax: '150000 100000' }), dir: tmp, statfs: disk(GB), cpuCount: () => 8 }).cores).toBe(1.5);
  });

  it('here too, where there is no cgroup or /proc to read', () => {
    const size = machineSize({ cgroup: path.join(tmp, 'none'), proc: path.join(tmp, 'none'), dir: tmp });
    for (const v of Object.values(size)) expect(Number.isFinite(v) && v >= 0).toBe(true);
    expect(size.cores).toBeGreaterThan(0);
    expect(size.memoryGB).toBeGreaterThan(0);
  });
});

describe('the note says the machine', () => {
  const sentence = 'Debian, 2 cores, 3 GB of memory with no swap, and about 41 GB of free disk';

  it('that was heard, with a repository or with none', () => {
    for (const plain of [false, true]) {
      const note = cloudNote({ plain, machine: OLYMPUS });
      expect(note).toContain(sentence);
      expect(note).not.toContain('8 GB');
    }
  });

  it('or the managed cloud\'s, when none was', () => {
    for (const note of [CLOUD_NOTE, PLAIN_CLOUD_NOTE, cloudNote({ machine: null }), cloudNote({ machine: { cores: 'two' } })]) {
      expect(note).toContain('Debian, 2 cores, 8 GB of memory with no swap, and about 5 GB of free disk');
    }
    expect(cloudNote({ machine: null })).toBe(CLOUD_NOTE);
  });

  it('in words that fit one core, part of one, and swap', () => {
    expect(cloudNote({ machine: { ...OLYMPUS, cores: 1 } })).toContain('Debian, 1 core, 3 GB');
    expect(cloudNote({ machine: { ...OLYMPUS, cores: 1.5 } })).toContain('Debian, 1.5 cores, 3 GB');
    expect(cloudNote({ machine: { ...OLYMPUS, swapGB: 2 } })).toContain('3 GB of memory and 2 GB of swap, and about 41 GB');
  });
});

describe('the Mac keeps what each cloud said', () => {
  const ours = { gateway: 'https://cloud.example' };
  let env;
  beforeEach(() => {
    const cfg = path.join(tmp, 'cloud.json');
    fs.writeFileSync(cfg, JSON.stringify(ours));
    env = { MERCURY_CLOUD_CONFIG: cfg };
  });

  it('for that cloud only', () => {
    expect(cloudMachine(ours, env)).toBe(null);
    noteCloudMachine(ours, OLYMPUS, env);
    expect(cloudMachine(ours, env)).toEqual(OLYMPUS);
    expect(cloudMachine({ gateway: 'https://another.example' }, env)).toBe(null);
  });

  it('beside its caps, neither writing over the other', () => {
    noteImageCaps(ours, ['keys', 'plain'], env);
    noteCloudMachine(ours, OLYMPUS, env);
    noteImageCaps(ours, ['keys', 'offline', 'plain'], env);
    expect(cloudMachine(ours, env)).toEqual(OLYMPUS);
    noteCloudMachine(ours, { ...OLYMPUS, diskGB: 40 }, env);
    expect(imageCaps(ours, env)).toEqual(['keys', 'offline', 'plain']);
    expect(cloudMachine(ours, env)).toEqual({ ...OLYMPUS, diskGB: 40 });
  });

  it('and nothing that is not a machine', () => {
    noteCloudMachine(ours, { cores: 'many' }, env);
    noteCloudMachine(ours, null, env);
    expect(cloudMachine(ours, env)).toBe(null);
  });

  it('the run is started with it, and tells it what it hears', () => {
    const cli = fs.readFileSync(new URL('../main/cloud/run-cli.mts', import.meta.url), 'utf8');
    expect(cli).toMatch(/machine: cloudMachine\(config\)/);
    expect(cli).toMatch(/onMachine: \(m\) => noteCloudMachine\(config, m\)/);
  });
});

describe('a real run', () => {
  let objects; let s3; let s3Url; let sandbox; let bin;

  beforeEach(async () => {
    objects = new Map();
    s3 = http.createServer((req, res) => {
      const k = decodeURIComponent(req.url.slice(1).split('?')[0]);
      if (req.method === 'GET') { const b = objects.get(k); res.writeHead(b ? 200 : 404); return res.end(b); }
      const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { objects.set(k, Buffer.concat(chunks)); res.writeHead(200); res.end(); });
    });
    await new Promise((r) => s3.listen(0, '127.0.0.1', r));
    s3Url = `http://127.0.0.1:${s3.address().port}`;
    bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\necho done\n', { mode: 0o755 });
  });

  afterEach(async () => {
    await sandbox?.close();
    sandbox = null;
    s3.closeAllConnections();
    await new Promise((r) => s3.close(r));
  });

  const storage = {
    async put(k, body) { objects.set(k, Buffer.from(body)); },
    async get(k) { throw new Error(`the Mac read ${k}`); },
    async del(k) { objects.delete(k); },
    async getUrl(k) { return `${s3Url}/${encodeURIComponent(k)}`; },
    async putUrl(k) { return `${s3Url}/${encodeURIComponent(k)}`; },
  };

  async function runInTheCloud({ heard = null, measured = OLYMPUS } = {}) {
    sandbox = createSandbox({
      workRoot: path.join(tmp, 'vm-work'), pathRoot: path.join(tmp, 'vm'), bridgeSocket: path.join(tmp, 'bridge.sock'),
      baseEnv: { ...pickBaseEnv(process.env), PATH: `${bin}:${process.env.PATH}` },
      terminal: (line) => ['sh', '-c', line], whoIs: async () => null, uploadRetryMs: 10,
      ...(measured ? { machine: () => measured } : {}),
    });
    const mac = path.join(tmp, 'mac', 'repo');
    fs.rmSync(mac, { recursive: true, force: true });
    fs.mkdirSync(mac, { recursive: true });
    git(mac, 'init', '-q', '-b', 'main');
    git(mac, 'config', 'user.email', 'dev@example.com');
    git(mac, 'config', 'user.name', 'Dev');
    fs.writeFileSync(path.join(mac, 'a.txt'), 'one\n');
    git(mac, 'add', '.');
    git(mac, 'commit', '-q', '-m', 'first');
    git(mac, 'checkout', '-q', '-b', 'agentbox/w-1');
    objects.set('logins/claude/L1.json', Buffer.from(JSON.stringify({ engine: 'claude', token: TOKEN })));
    const sent = [];
    const told = [];
    const stdin = new PassThrough(); stdin.end();
    await cloudRun({
      argv: ['-p'], env: { ...process.env, ZERO_ITEM: 'w-1', CLAUDE_CONFIG_DIR: path.join(tmp, 'mac', 'claude-home') },
      cwd: mac, storage,
      transport: { invoke: (sid, p) => { sent.push(p); return sandbox.handle(p); }, async stop() {} },
      login: { engine: 'claude', id: 'L1', key: 'logins/claude/L1.json' },
      machine: heard, onMachine: (m) => told.push(m),
      stdin, stdout: new PassThrough(), stderr: new PassThrough(), remoteCommand: 'claude',
      pollWaitMs: 50, resultsWaitMs: 5000, watchParent: false, homeDir: path.join(tmp, 'home'),
    });
    await sandbox.close();
    sandbox = null;
    const start = sent.find((p) => p.action === 'start');
    return { system: start.argv[start.argv.indexOf('--append-system-prompt') + 1], told };
  }

  it('hears the machine from the sandbox, and the next run is told it', async () => {
    const first = await runInTheCloud();
    expect(first.system).toContain('2 cores, 8 GB of memory');
    expect(first.told).toEqual([OLYMPUS]);
    const next = await runInTheCloud({ heard: first.told[0] });
    expect(next.system).toContain('Debian, 2 cores, 3 GB of memory with no swap, and about 41 GB of free disk');
    expect(next.system).not.toContain('8 GB');
  }, 30_000);

  it('a sandbox that measures itself says real numbers', async () => {
    const { told } = await runInTheCloud({ measured: null });
    expect(told).toHaveLength(1);
    expect(told[0].cores).toBeGreaterThan(0);
    expect(told[0].memoryGB).toBeGreaterThan(0);
  }, 30_000);
});
