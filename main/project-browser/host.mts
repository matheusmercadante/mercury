// ONE PROJECT'S BROWSER, AND THE ONE PROCESS THAT OWNS IT.
//
// A saved profile serves one browser at a time, so one host per project holds
// it and every thread of the project asks here. The host starts the hidden
// browser on the first call and closes it when nothing has asked for a while.
// The owner's sign-in window is opened here too, because it needs the same
// profile and the hidden browser has to let go of it first.
//
// What drives the pages is Playwright MCP, one instance per thread, each handed
// a view of the browser that shows only that thread's pages (view.mts). The
// host adds what Playwright MCP does not have: which tools an agent gets, and
// which sites a page may go to (guard.mts, shared/project-browser.mts).
//
// Started detached by the app (app.mts), not by a worker: a program a worker
// starts is tied to its task and stopped when the task is closed.
//
//   ELECTRON_RUN_AS_NODE=1 <electron> main/project-browser/host.mts <folder> <app pid> <socket>
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { createConnection } from '@playwright/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { chromesForTesting } from '../../shared/hidden-browser.mts';
import { AGENT_TOOLS, NO_TEST_BROWSER, SIGNING_IN, notOneOfItsSites, siteAllows } from '../../shared/project-browser.mts';
import { nameSlug } from '../../shared/product-name.mjs';
import { profileDir, readProject, type HostRequest } from './place.mts';
import { guardPage, type KeptFrom } from './guard.mts';
import { settled, watchRequests } from './settle.mts';
import { openSignIn, type SignInWindow } from './sign-in.mts';
import { threadViews, type ThreadViews } from './view.mts';

export const BROWSER_HOST_ALREADY_THERE = 3;
const MAX_LINE = 1024 * 1024;
const PAGES_KEPT_BYTES = 64 * 1024 * 1024;

export interface BrowserStatus {
  state: 'closed' | 'open' | 'signing-in';
  /** Whether this computer has the browser it runs on. */
  canRun: boolean;
  threads: number;
}

type McpConfig = NonNullable<Parameters<typeof createConnection>[0]>;
type Launch = (profile: string, chrome: string) => Promise<BrowserContext>;

const said = (text: string, isError = true): CallToolResult => ({ ...(isError ? { isError: true } : {}), content: [{ type: 'text', text }] });

/** Chrome for Testing: the one browser here that runs hidden and also shows a window, on the same profile. */
export const testBrowser = (): string | null => chromesForTesting()[0] ?? null;

const launchHidden: Launch = (profile, chrome) => chromium.launchPersistentContext(profile, {
  executablePath: chrome,
  headless: true,
  viewport: { width: 1280, height: 720 },
  // Playwright MCP's own default for a browser it starts.
  args: ['--disable-blink-features=AutomationControlled'],
  handleSIGINT: false,
  handleSIGTERM: false,
  handleSIGHUP: false,
});

/** The profile is for sign-ins, not passwords: the browser never offers to save one. */
function keepNoPasswords(profile: string): void {
  const file = path.join(profile, 'Default', 'Preferences');
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ credentials_enable_service: false, profile: { password_manager_enabled: false } }), { mode: 0o600 });
}

const alive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException)?.code === 'EPERM'; }
};

const keptFromWords = ({ host, how }: KeptFrom, sites: readonly string[]): string => (how === 'stopped'
  ? `The page tried to go to ${host}, which is not one of this project's sites (${sites.join(', ')}), so it was stopped and nothing was sent there.`
  : `The site sent this page on to ${host}, which is not one of this project's sites (${sites.join(', ')}), so the page was emptied. When that is a sign-in service, the sign-in has ended: stop, and tell the owner to sign in again under Settings, Projects, this project, Browser.`);

export function serveBrowser({ dir, sock, appPid, chrome = testBrowser, launch = launchHidden, signInUrls = (sites) => sites.map((site) => `https://${site}/`), signInExtraArgs = [], settle = {}, idleMs = 15 * 60_000, callMs = 3 * 60_000, checkMs = 5_000, log = () => {}, onIdle = () => {} }: {
  dir: string;
  /** The socket the app chose for this host. */
  sock: string;
  appPid: number;
  chrome?: () => string | null;
  launch?: Launch;
  /** The pages the sign-in window opens on. */
  signInUrls?: (sites: readonly string[]) => string[];
  /** For a test, which opens the sign-in browser with no window. */
  signInExtraArgs?: string[];
  /** How long a page is waited for after a navigation (settle.mts). */
  settle?: Pick<Parameters<typeof settled>[0], 'everyMs' | 'enough' | 'shortAfterMs' | 'mostMs'>;
  /** A thread's tabs, then the browser, then the host with its app gone, are let go after this long unused. */
  idleMs?: number;
  callMs?: number;
  checkMs?: number;
  log?: (line: string) => void;
  onIdle?: () => void;
}): { started: Promise<void>; answer(request: HostRequest): Promise<unknown>; close(): Promise<void> } {
  const profile = profileDir(dir);
  const sitesNow = (): string[] => readProject(dir)?.sites ?? [];

  let context: BrowserContext | null = null;
  let views: ThreadViews | null = null;
  let opening: Promise<BrowserContext> | null = null;
  let signIn: SignInWindow | null = null;
  let tools: Tool[] | null = null;
  let usedAt = Date.now();
  let inFlight = 0;
  const threads = new Map<string, { client: Client; usedAt: number }>();
  const queues = new Map<string, Promise<void>>();
  const keptFrom = new Map<string, KeptFrom>();
  const quietOf = new WeakMap<Page, () => boolean>();

  const mcpConfig = (): McpConfig => ({
    outputDir: readProject(dir)?.pages ?? path.join(dir, 'pages'),
    outputMaxSize: PAGES_KEPT_BYTES,
    filePaths: 'absolute',
    codegen: 'none',
  });

  async function connect(config: McpConfig, browser: BrowserContext): Promise<Client> {
    const server = await createConnection(config, async () => browser);
    const [theirs, ours] = InMemoryTransport.createLinkedPair();
    await server.connect(theirs);
    const client = new Client({ name: `${nameSlug}-project-browser`, version: '1.0.0' });
    await client.connect(ours);
    return client;
  }

  /** The tools an agent is offered, read off Playwright MCP without starting a browser. */
  async function listTools(): Promise<Tool[]> {
    if (tools) return tools;
    const nothing = { once: () => {}, on: () => {}, browser: () => null, pages: () => [] } as unknown as BrowserContext;
    const client = await connect(mcpConfig(), nothing);
    try {
      const all = (await client.listTools(undefined, { timeout: 20_000 })).tools;
      tools = all.filter((tool) => AGENT_TOOLS.includes(tool.name));
    } finally { await client.close().catch(() => {}); }
    return tools;
  }

  function forget(): void {
    context = null;
    views = null;
    for (const { client } of threads.values()) client.close().catch(() => {});
    threads.clear();
    keptFrom.clear();
  }

  async function openBrowser(): Promise<BrowserContext> {
    if (context) return context;
    opening ??= (async () => {
      const bin = chrome();
      if (!bin) throw new Error(NO_TEST_BROWSER);
      fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
      keepNoPasswords(profile);
      const opened = await launch(profile, bin);
      opened.once('close', () => { if (context === opened) forget(); });
      context = opened;
      views = threadViews(opened, {
        prepare: (page: Page, thread: string) => {
          quietOf.set(page, watchRequests(page));
          return guardPage(opened, page, {
            allows: (url) => siteAllows(sitesNow(), url),
            kept: (from) => { keptFrom.set(thread, from); },
          });
        },
      });
      log(`opened the browser on ${bin}`);
      return opened;
    })().finally(() => { opening = null; });
    return opening;
  }

  async function closeBrowser(): Promise<void> {
    const open = context ?? await opening?.catch(() => null) ?? null;
    if (!open) return;
    forget();
    await open.close().catch(() => {});
    log('closed the browser');
  }

  async function threadClient(thread: string): Promise<Client> {
    const had = threads.get(thread);
    if (had) return had.client;
    const browser = await openBrowser();
    const client = await connect(mcpConfig(), views!.viewFor(thread));
    // The browser may have closed while this thread was being connected.
    if (context !== browser) { client.close().catch(() => {}); throw new Error('The browser closed while it was being opened. Try again.'); }
    threads.set(thread, { client, usedAt: Date.now() });
    return client;
  }

  async function dropThread(thread: string): Promise<void> {
    const had = threads.get(thread);
    threads.delete(thread);
    keptFrom.delete(thread);
    await views?.closeThread(thread);
    await had?.client.close().catch(() => {});
  }

  /** The page a navigation opened, read again once it has stopped changing (settle.mts), as the file an agent is handed. */
  async function onceFilledIn(thread: string, client: Client, opened: CallToolResult): Promise<CallToolResult> {
    const look = (args: Record<string, unknown>) => client.callTool({ name: 'browser_snapshot', arguments: args }, undefined, { timeout: callMs }) as Promise<CallToolResult>;
    const size = (page: CallToolResult): number => page.content.reduce((n, part) => n + (part.type === 'text' ? part.text.length : 0), 0);
    try {
      await settled({
        read: async () => size(await look({})),
        quiet: () => (views?.viewFor(thread).pages() ?? []).every((page) => quietOf.get(page)?.() ?? true),
        ...settle,
      });
      const filled = await look({ filename: '<auto>' });
      return filled.isError ? opened : filled;
    } catch { return opened; }
  }

  async function callTool(thread: string, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (signIn) return said(SIGNING_IN);
    const sites = sitesNow();
    if (!sites.length) return said('This project no longer lists any site for its browser, so nothing was opened.');
    if (!AGENT_TOOLS.includes(name)) return said(`${name} is not a tool this browser offers.`);
    const address = name === 'browser_navigate' || (name === 'browser_tabs' && args.action === 'new') ? args.url : undefined;
    if (address !== undefined && address !== '' && !siteAllows(sites, address)) return said(notOneOfItsSites(address, sites));
    if (name === 'browser_close') {
      await dropThread(thread);
      return said('Closed this thread\'s tabs. The browser stays open for the project\'s other threads.', false);
    }
    let client: Client;
    try { client = await threadClient(thread); } catch (err) { return said((err as Error).message); }
    let result: CallToolResult;
    try {
      result = await client.callTool({ name, arguments: args }, undefined, { timeout: callMs }) as CallToolResult;
    } catch (err) {
      // What the thread had open is not trusted after a call that never answered.
      await dropThread(thread).catch(() => {});
      return said(`The browser did not finish this: ${(err as Error).message}. This thread's tabs were closed; open the page again.`);
    }
    if (name === 'browser_navigate' && !result.isError && !keptFrom.has(thread)) result = await onceFilledIn(thread, client, result);
    const from = keptFrom.get(thread);
    keptFrom.delete(thread);
    return from ? { ...result, content: [...result.content, { type: 'text', text: keptFromWords(from, sites) }] } : result;
  }

  /** One thread's calls run one after another: Playwright MCP holds one current tab per thread. */
  function inTurn(thread: string, work: () => Promise<CallToolResult>): Promise<CallToolResult> {
    const mine = (queues.get(thread) ?? Promise.resolve()).then(work, work);
    const tail: Promise<void> = mine.then(() => {}, () => {}).finally(() => {
      if (queues.get(thread) === tail) queues.delete(thread);
      const state = threads.get(thread);
      if (state) state.usedAt = Date.now();
    });
    queues.set(thread, tail);
    return mine;
  }

  async function startSignIn(): Promise<{ ok: boolean; error?: string }> {
    if (signIn) return { ok: true };
    const bin = chrome();
    if (!bin) return { ok: false, error: 'no-browser' };
    const sites = sitesNow();
    if (!sites.length) return { ok: false, error: 'no-sites' };
    await closeBrowser();
    fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
    keepNoPasswords(profile);
    const opened = openSignIn({ chrome: bin, profile, urls: signInUrls(sites), extraArgs: signInExtraArgs });
    signIn = opened;
    log('opened the sign-in window');
    opened.closed.then(() => { if (signIn === opened) signIn = null; usedAt = Date.now(); log('the sign-in window closed'); });
    return { ok: true };
  }

  const status = (): BrowserStatus => ({ state: signIn ? 'signing-in' : context ? 'open' : 'closed', canRun: !!chrome(), threads: threads.size });

  async function answer(request: HostRequest): Promise<unknown> {
    usedAt = Date.now();
    if (request.method === 'status') return status();
    if (request.method === 'sign-in') return startSignIn();
    if (request.method === 'sign-in-done') { signIn?.close(); return { ok: true }; }
    if (request.method === 'stop') { setImmediate(onIdle); return { ok: true }; }
    if (request.method === 'tools/list') return { tools: await listTools() };
    if (request.method !== 'tools/call') return said('That is not something the browser offers.');
    const thread = typeof request.thread === 'string' && request.thread ? request.thread : null;
    if (!thread) return said('This call names no thread, so nothing was done.');
    const name = String(request.params?.name ?? '');
    const args = request.params?.arguments ?? {};
    inFlight += 1;
    try { return await inTurn(thread, () => callTool(thread, name, args)); } finally { inFlight -= 1; usedAt = Date.now(); }
  }

  function serveSocket(socket: net.Socket): void {
    socket.setEncoding('utf8');
    let buf = '';
    socket.on('data', (d: string) => {
      buf += d;
      if (buf.length > MAX_LINE) { socket.destroy(); return; }
      const at = buf.indexOf('\n');
      if (at < 0) return;
      const line = buf.slice(0, at);
      buf = '';
      let request: HostRequest;
      try { request = JSON.parse(line); } catch { socket.destroy(); return; }
      answer(request)
        .catch((err: unknown) => said(`The project's browser could not do this: ${(err as Error)?.message ?? err}`))
        .then((result) => { if (!socket.destroyed) socket.end(`${JSON.stringify({ result })}\n`); });
    });
    socket.on('error', () => {});
  }

  const server = net.createServer(serveSocket);
  const sweep = setInterval(() => {
    const now = Date.now();
    if (inFlight || signIn) { usedAt = now; return; }
    for (const [thread, state] of threads) if (now - state.usedAt >= idleMs) dropThread(thread).catch(() => {});
    if (now - usedAt < idleMs) return;
    if (context) { closeBrowser().catch(() => {}); return; }
    if (!alive(appPid)) onIdle();
  }, checkMs);
  sweep.unref?.();

  // A host the app is replacing answers its socket for a moment longer.
  const started = (async () => {
    for (let tries = 0; ; tries += 1) {
      const taken = await new Promise<boolean>((resolve) => {
        const probe = net.createConnection(sock);
        probe.once('connect', () => { probe.destroy(); resolve(true); });
        probe.once('error', () => resolve(false));
      });
      if (!taken) break;
      if (tries >= 40) throw Object.assign(new Error('another host already serves this project\'s browser'), { code: BROWSER_HOST_ALREADY_THERE });
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    fs.rmSync(sock, { force: true });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(sock, () => { fs.chmodSync(sock, 0o600); resolve(); });
    });
    fs.writeFileSync(path.join(dir, 'host.json'), JSON.stringify({ pid: process.pid, appPid, sock }), { mode: 0o600 });
  })();

  return {
    started,
    answer,
    close: async () => {
      clearInterval(sweep);
      signIn?.close();
      await closeBrowser();
      await new Promise<void>((resolve) => { if (server.listening) server.close(() => resolve()); else resolve(); });
      try { if (JSON.parse(fs.readFileSync(path.join(dir, 'host.json'), 'utf8')).pid === process.pid) fs.rmSync(path.join(dir, 'host.json'), { force: true }); } catch { /* not ours to remove */ }
    },
  };
}

async function main(): Promise<void> {
  const [dir, appPidArg, sock] = process.argv.slice(2);
  if (!dir || !sock) { console.error('usage: host.mts <folder> <app pid> <socket>'); process.exit(2); }
  const log = (line: string) => console.error(`${new Date().toISOString()} ${path.basename(dir)}: ${line}`);
  let ending = false;
  const end = (code = 0) => {
    if (ending) return;
    ending = true;
    host.close().catch(() => {}).finally(() => process.exit(code));
  };
  const host = serveBrowser({ dir, sock, appPid: Number(appPidArg), log, onIdle: () => end(0) });
  try { await host.started; } catch (err) {
    log((err as Error).message);
    process.exit((err as { code?: unknown }).code === BROWSER_HOST_ALREADY_THERE ? BROWSER_HOST_ALREADY_THERE : 1);
  }
  log('serving');
  process.on('SIGTERM', () => end(0));
  process.on('SIGINT', () => end(0));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => { console.error(`project browser host: ${(err as Error)?.message ?? err}`); process.exit(1); });
}
