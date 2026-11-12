// A SELF-HOSTED CLOUD SESSION IS ONE CONTAINER, AND IT GOES AWAY.
//
// AgentCore gave each cloud session its own machine, started it on the first
// call, ended it on `stop`, and ended it on its own after 15 idle minutes or
// 8 hours. The self-hosted cloud does the same with one container a session
// (cloud/selfhost/sessions.mjs). A session that started a second container,
// outlived its run or waited for ever on a container that never came up would
// fill a small machine and stall every run behind it. Driven with a stand-in
// for docker whose containers are real HTTP servers answering /ping and
// /invocations as the sandbox does.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { dockerSessions } from '../cloud/selfhost/sessions.mjs';

type Box = { name: string; args: string[]; server: http.Server; url: string; status: string; changedAt: number; hang: boolean; calls: unknown[]; mute: boolean };
let boxes: Map<string, Box>; let ran: string[][]; let clock: number;

async function startBox(name: string, args: string[]): Promise<Box> {
  const box = { name, args, status: 'Healthy', changedAt: clock / 1000, hang: false, mute: false, calls: [] as unknown[] } as Box;
  box.server = http.createServer((req, res) => {
    if (box.mute) return;
    if (req.url?.startsWith('/ping')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: box.status, time_of_last_update: box.changedAt })); return; }
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      box.calls.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (box.hang) return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, by: name }));
    });
  });
  await new Promise<void>((r) => box.server.listen(0, '127.0.0.1', r));
  box.url = `http://127.0.0.1:${(box.server.address() as { port: number }).port}`;
  return box;
}

const labelOf = (args: string[], label: string) => { const at = args.findIndex((a, i) => args[i - 1] === '--label' && a.startsWith(`${label}=`)); return at === -1 ? '' : args[at].slice(label.length + 1); };

// The parts of the docker CLI the sessions use, over the boxes above.
async function docker(args: string[]) {
  const [cmd, ...rest] = args;
  if (cmd === 'run') {
    ran.push(args);
    const name = rest[rest.indexOf('--name') + 1];
    boxes.set(name, await startBox(name, args));
    return { code: 0, stdout: `${name}\n`, stderr: '' };
  }
  if (cmd === 'rm') {
    const name = rest[rest.length - 1];
    const box = boxes.get(name);
    if (!box) return { code: 1, stdout: '', stderr: `Error: No such container: ${name}` };
    box.server.closeAllConnections(); box.server.close(); boxes.delete(name);
    return { code: 0, stdout: name, stderr: '' };
  }
  if (cmd === 'inspect') {
    const box = boxes.get(rest[rest.length - 1]);
    return box ? { code: 0, stdout: 'true\n', stderr: '' } : { code: 1, stdout: '', stderr: 'Error: No such object' };
  }
  if (cmd === 'ps') {
    const lines = [...boxes.values()].map((b) => [b.name, labelOf(b.args, 'mercury.session'), labelOf(b.args, 'mercury.started')].join('\t'));
    return { code: 0, stdout: lines.join('\n'), stderr: '' };
  }
  throw new Error(`a docker command the sessions should not use: ${args.join(' ')}`);
}

const make = (over = {}) => dockerSessions({
  docker, image: 'mercury-sandbox:test', network: 'mercury-cloud-net', memory: '3g', cpus: '2', pids: 512,
  addressOf: (name: string) => boxes.get(name)?.url ?? 'http://127.0.0.1:9', now: () => clock, readyMs: 2000, pollMs: 20, timeoutMs: 1500,
  ...over,
});

beforeEach(() => { boxes = new Map(); ran = []; clock = Date.UTC(2026, 10, 12, 12); });
afterEach(() => { for (const b of boxes.values()) { b.server.closeAllConnections(); b.server.close(); } });

describe('a self-hosted cloud session', () => {
  it('starts one container on its first call, with its limits, and hands every call to it', async () => {
    const s = make();
    expect(await s.invoke('u-p-s1', { action: 'start', n: 1 })).toMatchObject({ ok: true });
    expect(await s.invoke('u-p-s1', { action: 'status' })).toMatchObject({ ok: true });
    expect(ran).toHaveLength(1);
    const args = ran[0];
    expect(args).toEqual(expect.arrayContaining(['--network', 'mercury-cloud-net', '--memory', '3g', '--cpus', '2', '--pids-limit', '512', 'mercury-sandbox:test']));
    expect(labelOf(args, 'mercury.session')).toBe('u-p-s1');
    const box = [...boxes.values()][0];
    expect(box.calls).toEqual([{ action: 'start', n: 1 }, { action: 'status' }]);
  });

  // The links the server signs name it by one address, so a container must
  // reach the server by the name the Mac uses for it.
  it('a container knows the server by the name its links use', async () => {
    const s = make({ addHosts: ['cloud-server:10.9.8.1'] });
    await s.invoke('u-p-s1', { action: 'status' });
    expect(ran[0]).toEqual(expect.arrayContaining(['--add-host', 'cloud-server:10.9.8.1']));
    await make().invoke('u-p-s2', { action: 'status' });
    expect(ran[1]).not.toContain('--add-host');
  });

  it('gives each session its own container, and stop ends only its own', async () => {
    const s = make();
    await s.invoke('u-p-s1', { action: 'status' });
    await s.invoke('u-p-s2', { action: 'status' });
    expect(boxes.size).toBe(2);
    await s.stop('u-p-s1');
    expect([...boxes.values()].map((b) => labelOf(b.args, 'mercury.session'))).toEqual(['u-p-s2']);
    await s.stop('u-p-never');
  });

  it('a container that never comes up fails the call in time and is removed', async () => {
    const s = make({ addressOf: () => 'http://127.0.0.1:9' });
    const t0 = Date.now();
    await expect(s.invoke('u-p-s1', { action: 'start' })).rejects.toThrow(/did not come up/);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(boxes.size).toBe(0);
  });

  it('a call a container never answers ends at its deadline', async () => {
    const s = make();
    await s.invoke('u-p-s1', { action: 'status' });
    [...boxes.values()][0].hang = true;
    const t0 = Date.now();
    await expect(s.invoke('u-p-s1', { action: 'events' })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it('the sweep ends a session idle for 15 minutes, keeps a busy one, and ends any after 8 hours', async () => {
    const s = make();
    for (const id of ['idle', 'busy', 'fresh']) await s.invoke(`u-p-${id}`, { action: 'status' });
    const box = (id: string) => [...boxes.values()].find((b) => labelOf(b.args, 'mercury.session') === `u-p-${id}`);
    box('busy')!.status = 'HealthyBusy';
    clock += 10 * 60_000;
    box('fresh')!.changedAt = clock / 1000;
    clock += 6 * 60_000;
    expect(await s.sweep()).toBe(1);
    expect(box('idle')).toBeUndefined();
    expect(box('busy')).toBeDefined();
    expect(box('fresh')).toBeDefined();
    clock += 8 * 3_600_000;
    box('fresh')!.changedAt = clock / 1000;
    await s.sweep();
    expect(boxes.size).toBe(0);
  });

  it('the sweep ends a container that stopped answering', async () => {
    const s = make({ timeoutMs: 300 });
    await s.invoke('u-p-s1', { action: 'status' });
    [...boxes.values()][0].mute = true;
    expect(await s.sweep()).toBe(1);
    expect(boxes.size).toBe(0);
  });

  it('a server that started again finds the session\'s container instead of starting a second', async () => {
    await make().invoke('u-p-s1', { action: 'status' });
    const again = make();
    await again.invoke('u-p-s1', { action: 'status' });
    expect(ran).toHaveLength(1);
    expect(await again.sweep()).toBe(0);
  });
});
