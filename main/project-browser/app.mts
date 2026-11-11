// THE APP'S SIDE OF A PROJECT'S BROWSER: starting its host, handing a run the
// tools, and the owner's sign-in.
//
// A project has a browser when its owner listed a site for it (the config's
// `projectBrowserSites`). Only that project's runs are handed the tools, and
// they reach only that project's host.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromesForTesting } from '../../shared/hidden-browser.mts';
import { BROWSER_SERVER, browserBrief, sitesOfProject } from '../../shared/project-browser.mts';
import { stripTypesFlags } from '../strip-types.mts';
import type { ConnectionServers } from '../codex-session.mts';
import { askHost, browserDir, pagesDir, readHost, socketPath, writeProject } from './place.mts';
import type { BrowserStatus } from './host.mts';

export interface BrowserConfig {
  storeRoot: string;
  projectBrowserSites?: Record<string, string[]> | null;
}

export interface BrowserDeps {
  config: BrowserConfig;
  /** The app's own folder, where each project's profile is kept. */
  userDir: string;
  appDir: string;
}

type StartHost = (host: { dir: string; sock: string; pages: string; userDir: string }) => void;

const HOST_FILE = fileURLToPath(new URL('./host.mts', import.meta.url));
const INSTALL_MS = 15 * 60_000;
const STARTING_MS = 15_000;
const started = new Map<string, number>();

function startHost({ dir, sock, pages, userDir }: Parameters<StartHost>[0]): void {
  const log = fs.openSync(path.join(userDir, 'browser-host.log'), 'a');
  try {
    const proc = spawn(process.execPath, [...stripTypesFlags(), HOST_FILE, dir, String(process.pid), sock], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      // A file an agent names for a page is written against this folder.
      cwd: pages,
      detached: true,
      stdio: ['ignore', log, log],
    });
    proc.on('error', () => {});
    proc.unref();
  } finally { fs.closeSync(log); }
}

/**
 * The socket of the project's host, with this app's host running or just
 * started. A host an earlier launch of the app left is told to stop, so the
 * project is always served by the code of the app that is open.
 */
export function hostFor({ config, userDir }: Pick<BrowserDeps, 'config' | 'userDir'>, slug: string, { start = startHost, appPid = process.pid, now = Date.now }: { start?: StartHost; appPid?: number; now?: () => number } = {}): string {
  const dir = browserDir(userDir, slug);
  const pages = pagesDir(config.storeRoot, slug);
  const sock = socketPath(dir);
  fs.mkdirSync(pages, { recursive: true });
  writeProject(dir, { slug, sites: sitesOfProject(config, slug), pages });
  const host = readHost(dir);
  if (host?.appPid === appPid && host.sock === sock) return sock;
  if (now() - (started.get(dir) ?? 0) < STARTING_MS) return sock;
  if (host) askHost(host.sock, { method: 'stop' }, { ms: 5_000 }).catch(() => {});
  started.set(dir, now());
  start({ dir, sock, pages, userDir });
  return sock;
}

/** Hands a run its project's browser tools, when the project has a browser. */
export function giveProjectBrowser(plan: { connectionServers?: ConnectionServers | null }, deps: BrowserDeps, { slug, thread }: { slug: string; thread: string }, opts: Parameters<typeof hostFor>[2] = {}): void {
  if (!sitesOfProject(deps.config, slug).length) return;
  const sock = hostFor(deps, slug, opts);
  plan.connectionServers = {
    ...(plan.connectionServers ?? {}),
    [BROWSER_SERVER]: {
      command: process.execPath,
      args: [...stripTypesFlags(), path.join(deps.appDir, 'mcp', 'project-browser.mts')],
      env: { ELECTRON_RUN_AS_NODE: '1', PROJECT_BROWSER_SOCK: sock, PROJECT_BROWSER_THREAD: thread },
    },
  };
}

export const projectBrowserBrief = (config: BrowserConfig | null | undefined, slug: string): string | null => browserBrief(sitesOfProject(config, slug));

/** After the owner changes a project's sites: a running host reads the new list, and one with no sites left stops. */
export function projectSitesChanged({ config, userDir }: Pick<BrowserDeps, 'config' | 'userDir'>, slug: string): void {
  const dir = browserDir(userDir, slug);
  if (!fs.existsSync(dir)) return;
  const sites = sitesOfProject(config, slug);
  writeProject(dir, { slug, sites, pages: pagesDir(config.storeRoot, slug) });
  const host = sites.length ? null : readHost(dir);
  if (host) askHost(host.sock, { method: 'stop' }, { ms: 5_000 }).catch(() => {});
}

/** Downloads the Chrome for Testing this app's Playwright was built for. The builds already on the computer stay. */
function installTestBrowser({ ms = INSTALL_MS }: { ms?: number } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let cli: string;
    try { cli = path.join(path.dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')), 'cli.js'); } catch { resolve(false); return; }
    const proc = spawn(process.execPath, [cli, 'install', 'chromium', '--no-shell', '--no-remove'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' });
    const deadline = setTimeout(() => { try { proc.kill('SIGTERM'); } catch { /* gone */ } }, ms);
    const done = (ok: boolean) => { clearTimeout(deadline); resolve(ok); };
    proc.once('error', () => done(false));
    proc.once('exit', (code) => done(code === 0));
  });
}

const hasTestBrowser = (): boolean => chromesForTesting().length > 0;

export async function projectBrowserStatus(deps: Pick<BrowserDeps, 'userDir'>, slug: string, { hasBrowser = hasTestBrowser }: { hasBrowser?: () => boolean } = {}): Promise<BrowserStatus> {
  const closed: BrowserStatus = { state: 'closed', canRun: hasBrowser(), threads: 0 };
  const host = readHost(browserDir(deps.userDir, slug));
  if (!host) return closed;
  return (await askHost<BrowserStatus>(host.sock, { method: 'status' }, { ms: 3_000 })) ?? closed;
}

export type SignInAnswer = { ok: true } | { ok: false; error: string };

/** Opens the window the owner signs in through, downloading the browser first on a computer that has none. */
export async function signInToProjectBrowser(deps: Pick<BrowserDeps, 'config' | 'userDir'>, slug: string, { install = installTestBrowser, hasBrowser = hasTestBrowser, host = hostFor, waitMs = 20_000 }: {
  install?: () => Promise<boolean>;
  hasBrowser?: () => boolean;
  host?: typeof hostFor;
  waitMs?: number;
} = {}): Promise<SignInAnswer> {
  if (!sitesOfProject(deps.config, slug).length) return { ok: false, error: 'List a site first.' };
  if (!hasBrowser() && !(await install()) && !hasBrowser()) return { ok: false, error: 'Chrome for Testing could not be downloaded. Check the connection and try again.' };
  const sock = host(deps, slug);
  const until = Date.now() + waitMs;
  // A host just started is a moment from listening.
  while (Date.now() < until) {
    const got = await askHost<{ ok: boolean; error?: string }>(sock, { method: 'sign-in' }, { ms: 15_000 });
    if (got?.ok) return { ok: true };
    if (got) return { ok: false, error: got.error === 'no-browser' ? 'This computer has no Chrome for Testing to open.' : 'List a site first.' };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ok: false, error: 'The project\'s browser did not start. Try again.' };
}

export async function finishProjectBrowserSignIn(deps: Pick<BrowserDeps, 'userDir'>, slug: string): Promise<void> {
  const host = readHost(browserDir(deps.userDir, slug));
  if (host) await askHost(host.sock, { method: 'sign-in-done' }, { ms: 5_000 });
}
