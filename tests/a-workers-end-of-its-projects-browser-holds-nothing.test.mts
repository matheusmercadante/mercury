// A WORKER'S END OF ITS PROJECT'S BROWSER HOLDS NOTHING AND DECIDES NOTHING.
//
// Why this exists (2026-11-10): the tool server a worker starts for its
// project's browser is a process the worker owns, so anything in it or handed
// to it the worker can read or change. It therefore carries the thread's name
// and the socket to ask on, passes each call to the project's host, and says
// plainly when no host answers. The sites and the tools are the host's to
// decide. Driven here as the real process over its real pipes, against a
// stand-in host on the real socket.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypesFlags } from '../main/strip-types.mts';
import type { HostRequest } from '../main/project-browser/place.mts';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROXY = path.join(REPO, 'mcp', 'project-browser.mts');
const ends: (() => void)[] = [];
afterEach(() => { while (ends.length) ends.pop()!(); });

/** A socket path nothing is listening on yet. */
function socket(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-end-'));
  ends.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'host.sock');
}

/** A host that answers every question with what `answer` returns, and keeps what it was asked. */
async function standInHost(sock: string, answer: (request: HostRequest) => unknown): Promise<HostRequest[]> {
  const asked: HostRequest[] = [];
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    let buf = '';
    sock.on('data', (d: string) => {
      buf += d;
      if (!buf.includes('\n')) return;
      const request = JSON.parse(buf.slice(0, buf.indexOf('\n'))) as HostRequest;
      asked.push(request);
      sock.end(`${JSON.stringify({ result: answer(request) })}\n`);
    });
  });
  await new Promise<void>((resolve) => server.listen(sock, resolve));
  ends.push(() => { server.close(); });
  return asked;
}

function worker(env: Record<string, string>) {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [...stripTypesFlags(), PROXY], { env: { PATH: process.env.PATH ?? '', ...env } });
  ends.push(() => child.kill());
  let buf = '';
  const waiting = new Map<number, (answer: { result?: Record<string, unknown>; error?: unknown }) => void>();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d: string) => {
    buf += d;
    for (let at; (at = buf.indexOf('\n')) >= 0;) {
      const msg = JSON.parse(buf.slice(0, at));
      buf = buf.slice(at + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  let id = 0;
  return (method: string, params: object = {}) => new Promise<{ result?: Record<string, unknown>; error?: unknown }>((resolve) => {
    id += 1;
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

const textOf = (answer: { result?: Record<string, unknown> }): string => ((answer.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? '').join('\n');

describe('the worker\'s end of its project\'s browser', { timeout: 30_000 }, () => {
  it('offers the tools the host lists, and no others', async () => {
    const sock = socket();
    await standInHost(sock, () => ({ tools: [{ name: 'browser_navigate', inputSchema: { type: 'object' } }] }));
    const ask = worker({ PROJECT_BROWSER_SOCK: sock, PROJECT_BROWSER_THREAD: 'w-1' });
    expect((await ask('initialize', { protocolVersion: '2025-06-18' })).result?.protocolVersion).toBe('2025-06-18');
    const listed = (await ask('tools/list')).result?.tools as { name: string }[];
    expect(listed.map((t) => t.name)).toEqual(['browser_navigate']);
  });

  it('passes a call to the host under the thread\'s name, and hands back the host\'s answer', async () => {
    const sock = socket();
    const asked = await standInHost(sock, (request) => (request.method === 'tools/call' ? { content: [{ type: 'text', text: 'the board' }] } : { tools: [] }));
    const ask = worker({ PROJECT_BROWSER_SOCK: sock, PROJECT_BROWSER_THREAD: 'w-7' });
    const answer = await ask('tools/call', { name: 'browser_navigate', arguments: { url: 'https://acme.atlassian.net/board' } });
    expect(textOf(answer)).toBe('the board');
    expect(asked).toEqual([{ method: 'tools/call', thread: 'w-7', params: { name: 'browser_navigate', arguments: { url: 'https://acme.atlassian.net/board' } } }]);
  });

  it('cannot name a thread other than its own, whatever the call says', async () => {
    const sock = socket();
    const asked = await standInHost(sock, () => ({ content: [{ type: 'text', text: 'ok' }] }));
    const ask = worker({ PROJECT_BROWSER_SOCK: sock, PROJECT_BROWSER_THREAD: 'w-7' });
    await ask('tools/call', { name: 'browser_tabs', arguments: { action: 'list' }, thread: 'w-other' });
    expect(asked[0].thread).toBe('w-7');
  });

  it('says the browser is not running when no host answers, and does nothing', async () => {
    const ask = worker({ PROJECT_BROWSER_SOCK: socket(), PROJECT_BROWSER_THREAD: 'w-1' });
    const answer = await ask('tools/call', { name: 'browser_navigate', arguments: { url: 'https://acme.atlassian.net/' } });
    expect(answer.result?.isError).toBe(true);
    expect(textOf(answer)).toContain('browser is not running');
  });

  it('refuses a call it was given no socket or thread for', async () => {
    const ask = worker({});
    const answer = await ask('tools/call', { name: 'browser_navigate', arguments: {} });
    expect(answer.result?.isError).toBe(true);
  });

  it('answers a method it does not offer as not offered', async () => {
    const ask = worker({ PROJECT_BROWSER_SOCK: socket(), PROJECT_BROWSER_THREAD: 'w-1' });
    expect((await ask('resources/list')).error).toBeTruthy();
  });
});
