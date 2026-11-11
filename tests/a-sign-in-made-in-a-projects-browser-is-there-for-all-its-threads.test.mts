// A SIGN-IN MADE IN A PROJECT'S BROWSER IS THERE FOR ALL ITS THREADS, AND
// NOWHERE ELSE.
//
// Why this exists (2026-11-10): a project got a browser its owner signs in to
// by hand, for its agents to read the project's signed-in tools with. This
// drives the real thing end to end on a real Chrome for Testing: the owner's
// sign-in window stores a session, the hidden browser reads it, two threads use
// it at once in their own tabs, and a page never reaches a site off the list.
// The two sites here are one local server under two names: `localhost` is on
// the project's list and `127.0.0.1` is not.
//
// Skipped on a machine with no Chrome for Testing, which is what the browser
// runs on.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { serveBrowser, testBrowser, type BrowserStatus } from '../main/project-browser/host.mts';
import { askHost, profileDir, writeProject } from '../main/project-browser/place.mts';
import { SIGNING_IN } from '../shared/project-browser.mts';

const chrome = testBrowser();
const text = (r: CallToolResult | null): string => (r?.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('\n');
const until = async (what: () => boolean | Promise<boolean>, ms = 15_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await what()) return; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('waited too long');
};

describe.skipIf(!chrome)('a project\'s browser, on a real Chrome for Testing', { timeout: 90_000 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-browser-'));
  const dir = path.join(root, 'browser');
  const pages = path.join(root, 'pages');
  const sock = path.join(root, 'host.sock');
  const seen: string[] = [];
  let site: http.Server;
  let on: string;
  let off: string;
  let host: ReturnType<typeof serveBrowser>;
  let idled = 0;
  let signInPage = '/sign-in';

  const call = (thread: string, name: string, args: Record<string, unknown> = {}) =>
    askHost<CallToolResult>(sock, { method: 'tools/call', thread, params: { name, arguments: args } }, { ms: 60_000 });
  const status = () => askHost<BrowserStatus>(sock, { method: 'status' }, { ms: 5_000 });
  const read = async (thread: string) => text(await call(thread, 'browser_snapshot'));

  beforeAll(async () => {
    site = http.createServer((req, res) => {
      const name = String(req.headers.host).split(':')[0];
      seen.push(`${name}${req.url}`);
      const signedIn = (req.headers.cookie ?? '').includes('session=owner');
      const send = (body: string, headers: Record<string, string> = {}) => { res.writeHead(200, { 'content-type': 'text/html', ...headers }); res.end(body); };
      const go = (to: string) => { res.writeHead(302, { location: to }); res.end(); };
      if (req.url === '/sign-in') return send('<h1>Signed in</h1>', { 'set-cookie': 'session=owner; Max-Age=86400; Path=/' });
      // The owner closing the window, which a page with one entry in its history may do to itself.
      if (req.url === '/window-then-closed') return send('<h1>Closing</h1><script>setTimeout(() => window.close(), 300)</script>');
      if (req.url === '/through-sign-in-service') return go(`${off}/service`);
      if (req.url === '/service') return go(`${on}/back`);
      if (req.url === '/sent-away') return go(`${off}/elsewhere`);
      if (req.url === '/links') return send(`<h1>Links</h1><a href="${off}/away">a site off the list</a> <a href="${on}/new-tab" target="_blank">opens a new tab</a>`);
      return send(`<title>${req.url}</title><h1>Page ${req.url}</h1><p>${signedIn ? 'Signed in as the owner' : 'Not signed in'}</p>`);
    });
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
    const { port } = site.address() as AddressInfo;
    on = `http://localhost:${port}`;
    off = `http://127.0.0.1:${port}`;
    writeProject(dir, { slug: 'oms', sites: ['localhost'], pages });
    host = serveBrowser({
      dir, sock, appPid: process.pid, signInUrls: () => [`${on}${signInPage}`], signInExtraArgs: ['--headless=new'],
      onIdle: () => { idled += 1; },
    });
    await host.started;
  });

  afterAll(async () => {
    await host?.close();
    await new Promise((resolve) => site.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('offers the tools that read and move about, and none that run code', async () => {
    const got = await askHost<{ tools: Tool[] }>(sock, { method: 'tools/list' }, { ms: 30_000 });
    const names = (got?.tools ?? []).map((t) => t.name);
    expect(names).toContain('browser_navigate');
    expect(names).toContain('browser_snapshot');
    expect(names).toContain('browser_click');
    expect(names).not.toContain('browser_evaluate');
    expect(names).not.toContain('browser_run_code_unsafe');
    expect((await status())?.state).toBe('closed');
  });

  it('is not signed in to anything before its owner signs in', async () => {
    await call('thread-a', 'browser_navigate', { url: `${on}/board` });
    expect(await read('thread-a')).toContain('Not signed in');
  });

  it('keeps the sign-in its owner makes in the window, and is held for them meanwhile', async () => {
    expect(await askHost(sock, { method: 'sign-in' }, { ms: 30_000 })).toEqual({ ok: true });
    expect((await status())?.state).toBe('signing-in');
    expect(text(await call('thread-a', 'browser_navigate', { url: `${on}/board` }))).toBe(SIGNING_IN);
    await until(() => seen.includes('localhost/sign-in'));
    await askHost(sock, { method: 'sign-in-done' }, { ms: 5_000 });
    await until(async () => (await status())?.state === 'closed');

    await call('thread-a', 'browser_navigate', { url: `${on}/board` });
    expect(await read('thread-a')).toContain('Signed in as the owner');
  });

  it('gives a second thread the same sign-in in tabs of its own', async () => {
    await call('thread-b', 'browser_navigate', { url: `${on}/backlog` });
    expect(await read('thread-b')).toContain('Signed in as the owner');
    expect(await read('thread-a')).toContain('Page /board');
    const tabsA = text(await call('thread-a', 'browser_tabs', { action: 'list' }));
    const tabsB = text(await call('thread-b', 'browser_tabs', { action: 'list' }));
    expect(tabsA).toContain('/board');
    expect(tabsA).not.toContain('/backlog');
    expect(tabsB).toContain('/backlog');
    expect(tabsB).not.toContain('/board');
    expect((await status())?.threads).toBe(2);
  });

  it('refuses an address off the list without sending anything to it', async () => {
    const before = seen.length;
    const said = text(await call('thread-a', 'browser_navigate', { url: `${off}/secret?what=it-read` }));
    expect(said).toContain('127.0.0.1 is not one of this project\'s sites');
    expect(said).toContain('localhost');
    expect(seen.slice(before)).toEqual([]);
    expect(text(await call('thread-a', 'browser_tabs', { action: 'new', url: `${off}/x` }))).toContain('is not one of this project\'s sites');
    expect(text(await call('thread-a', 'browser_navigate', { url: 'file:///etc/hosts' }))).toContain('is not one of this project\'s sites');
    expect(seen.slice(before)).toEqual([]);
  });

  it('does not follow a link on a page to a site off the list', async () => {
    await call('thread-a', 'browser_navigate', { url: `${on}/links` });
    const before = seen.length;
    const clicked = await call('thread-a', 'browser_click', { element: 'a site off the list', target: 'role=link[name="a site off the list"]' });
    expect(clicked?.isError).toBeFalsy();
    expect(text(clicked)).toContain('The page tried to go to 127.0.0.1');
    expect(text(clicked)).toContain('nothing was sent there');
    await new Promise((r) => setTimeout(r, 300));
    expect(seen.slice(before).filter((s) => s.startsWith('127.0.0.1'))).toEqual([]);
  });

  it('gives a thread the tab one of its pages opens, and no other thread', async () => {
    await call('thread-a', 'browser_navigate', { url: `${on}/links` });
    await call('thread-a', 'browser_click', { element: 'opens a new tab', target: 'role=link[name="opens a new tab"]' });
    await until(async () => text(await call('thread-a', 'browser_tabs', { action: 'list' })).includes('/new-tab'));
    expect(text(await call('thread-b', 'browser_tabs', { action: 'list' }))).not.toContain('/new-tab');
  });

  it('lets a site pass a page through a sign-in service and back', async () => {
    await call('thread-a', 'browser_navigate', { url: `${on}/through-sign-in-service` });
    expect(seen).toContain('127.0.0.1/service');
    expect(await read('thread-a')).toContain('Page /back');
  });

  it('empties a page a site sends off the list, and says where it went', async () => {
    const said = text(await call('thread-a', 'browser_navigate', { url: `${on}/sent-away` }));
    expect(said).toContain('sent this page on to 127.0.0.1');
    expect(said).toContain('tell the owner to sign in again');
    expect(await read('thread-a')).not.toContain('Page /elsewhere');
  });

  it('closes one thread\'s tabs and leaves the others', async () => {
    expect(text(await call('thread-a', 'browser_close'))).toContain('Closed this thread\'s tabs');
    expect(await read('thread-b')).toContain('Page /backlog');
    expect((await status())?.threads).toBe(1);
  });

  it('writes the pages it hands over where the project said, and saves no password', () => {
    expect(fs.readdirSync(pages).some((f) => f.endsWith('.yml'))).toBe(true);
    const prefs = JSON.parse(fs.readFileSync(path.join(profileDir(dir), 'Default', 'Preferences'), 'utf8'));
    expect(prefs.credentials_enable_service).toBe(false);
  });

  it('is the agents\' again as soon as the owner closes the sign-in window, with nothing pressed', async () => {
    signInPage = '/window-then-closed';
    expect(await askHost(sock, { method: 'sign-in' }, { ms: 30_000 })).toEqual({ ok: true });
    expect((await status())?.state).toBe('signing-in');
    await until(() => seen.includes('localhost/window-then-closed'));
    await until(async () => (await status())?.state === 'closed');
    await call('thread-b', 'browser_navigate', { url: `${on}/after` });
    expect(await read('thread-b')).toContain('Signed in as the owner');
  });

  it('stops when it is told to', async () => {
    expect(await askHost(sock, { method: 'stop' }, { ms: 5_000 })).toEqual({ ok: true });
    await until(() => idled > 0);
  });
});
