// A PROJECT'S PAGE LISTS ITS BROWSER'S SITES AND OPENS ITS SIGN-IN.
//
// Why this exists (2026-11-10): a project's browser is switched on by listing
// a site for it, and its owner signs in to it by hand. What is typed has to be
// kept as hosts (a pasted address, a stray `www`), an entry that names no site
// has to be refused with the entry named, and emptying the list has to take the
// browser away rather than leave a key that means nothing. The page then says
// one thing about the browser at a time: what it will do, that the window is
// open, or that threads are on it.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSettings, setProjectSetting } from '../main/settings.mts';
import { Supervisor } from '../main/supervisor.mts';
import { finishProjectBrowserSignIn, projectBrowserStatus, signInToProjectBrowser } from '../main/project-browser/app.mts';
import { browserDir, readProject } from '../main/project-browser/place.mts';
import { signInButton, signInLine, sitesLine } from '../renderer/src/project-browser-words.ts';
import { REQUEST_CHANNELS } from '../shared/bridge-map.mts';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const made: string[] = [];
afterEach(() => { while (made.length) fs.rmSync(made.pop()!, { recursive: true, force: true }); });

function app(config: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-settings-'));
  made.push(root);
  const appDir = path.join(root, 'app');
  const userDir = path.join(root, 'user');
  fs.mkdirSync(appDir);
  fs.mkdirSync(userDir);
  const products = [{ slug: 'oms', name: 'OMS', dir: path.join(root, 'store', 'oms'), repoPath: null }];
  const store = { listItems: () => [], listProducts: () => products, readItem: () => null, isDue: () => true };
  const live = { storeRoot: path.join(root, 'store'), home: root, appDir, claudeBin: '/nonexistent/claude', codexBin: '/nonexistent/codex', authProfiles: ['default'], ...config };
  const supervisor = new Supervisor(live, store, appDir, appDir, userDir);
  supervisor._saveState = () => {};
  const deps = { config: live, supervisor, store } as unknown as Parameters<typeof setProjectSetting>[0];
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(appDir, 'zero.config.json'), 'utf8'));
  return { root, userDir, live: live as typeof live & { projectBrowserSites?: Record<string, string[]> }, deps, onDisk };
}

describe('the sites a project lists for its browser', () => {
  it('are kept as hosts, each once, and shown on its page', () => {
    const { deps, live, onDisk } = app();
    setProjectSetting(deps, { product: 'oms', key: 'browserSites', value: 'https://www.acme.atlassian.net/jira, grafana.acme.dev  acme.atlassian.net' });
    expect(live.projectBrowserSites).toEqual({ oms: ['acme.atlassian.net', 'grafana.acme.dev'] });
    expect(onDisk().projectBrowserSites).toEqual({ oms: ['acme.atlassian.net', 'grafana.acme.dev'] });
    const page = readSettings(deps).projects.find((p: { slug: string }) => p.slug === 'oms') as { browserSites?: string[] };
    expect(page.browserSites).toEqual(['acme.atlassian.net', 'grafana.acme.dev']);
  });

  it('refuse an entry that names no site, and say which', () => {
    const { deps, live } = app({ projectBrowserSites: { oms: ['acme.dev'] } });
    expect(() => setProjectSetting(deps, { product: 'oms', key: 'browserSites', value: 'acme.dev, com' })).toThrow(/com is not a site/);
    expect(() => setProjectSetting(deps, { product: 'oms', key: 'browserSites', value: ['file:///etc/passwd'] })).toThrow(/is not a site/);
    expect(live.projectBrowserSites).toEqual({ oms: ['acme.dev'] });
  });

  it('take the browser away when the list is emptied, leaving no key behind', () => {
    const { deps, live, onDisk } = app({ projectBrowserSites: { oms: ['acme.dev'] } });
    setProjectSetting(deps, { product: 'oms', key: 'browserSites', value: '' });
    expect(live.projectBrowserSites).toBeUndefined();
    expect('projectBrowserSites' in onDisk()).toBe(false);
    expect((readSettings(deps).projects[0] as { browserSites?: string[] }).browserSites).toEqual([]);
  });

  it('reach a browser that is already set up, so its host opens the new list', () => {
    const { deps, userDir, live } = app({ projectBrowserSites: { oms: ['acme.dev'] } });
    const dir = browserDir(userDir, 'oms');
    fs.mkdirSync(dir, { recursive: true });
    setProjectSetting(deps, { product: 'oms', key: 'browserSites', value: 'acme.dev, jira.acme.dev' });
    expect(readProject(dir)?.sites).toEqual(['acme.dev', 'jira.acme.dev']);
    expect(readProject(dir)?.pages.startsWith(live.storeRoot)).toBe(true);
  });
});

describe('signing in', () => {
  const deps = (sites: string[]) => {
    const { userDir, live } = app({ projectBrowserSites: sites.length ? { oms: sites } : {} });
    return { config: live, userDir };
  };

  it('is refused for a project that lists no site', async () => {
    expect(await signInToProjectBrowser(deps([]), 'oms', { hasBrowser: () => true, host: () => { throw new Error('not reached'); } })).toEqual({ ok: false, error: 'List a site first.' });
  });

  it('downloads the browser first on a computer that has none, and says so when that fails', async () => {
    let asked = 0;
    const answer = await signInToProjectBrowser(deps(['acme.dev']), 'oms', { hasBrowser: () => false, install: async () => { asked += 1; return false; }, host: () => { throw new Error('not reached'); } });
    expect(asked).toBe(1);
    expect(answer).toEqual({ ok: false, error: 'Chrome for Testing could not be downloaded. Check the connection and try again.' });
  });

  it('gives up with a reason when the project\'s browser never starts', async () => {
    const d = deps(['acme.dev']);
    const answer = await signInToProjectBrowser(d, 'oms', { hasBrowser: () => true, host: () => path.join(d.userDir, 'nobody.sock'), waitMs: 300 });
    expect(answer).toEqual({ ok: false, error: 'The project\'s browser did not start. Try again.' });
  });

  it('reads as closed, and finishing is nothing, while no host is running', async () => {
    const d = deps(['acme.dev']);
    expect(await projectBrowserStatus(d, 'oms', { hasBrowser: () => true })).toEqual({ state: 'closed', canRun: true, threads: 0 });
    expect(await projectBrowserStatus(d, 'oms', { hasBrowser: () => false })).toEqual({ state: 'closed', canRun: false, threads: 0 });
    await finishProjectBrowserSignIn(d, 'oms');
  });
});

describe('what the page says', () => {
  const browser = (patch = {}) => ({ ok: true, state: 'closed' as const, canRun: true, threads: 0, ...patch });

  it('is the list itself, or what listing a site does', () => {
    expect(sitesLine(['acme.atlassian.net', 'grafana.acme.dev'])).toBe('acme.atlassian.net, grafana.acme.dev');
    expect(sitesLine([])).toContain('never your own browser');
  });

  it('is what Sign in will do, and that the first time downloads the browser', () => {
    expect(signInLine(browser(), false)).toBe('Opens this project\'s browser for you to sign in by hand. Its agents then read these sites as you.');
    expect(signInLine(browser({ canRun: false }), false)).toContain('downloads Chrome for Testing');
    expect(signInButton(browser(), false)).toEqual({ label: 'Sign in', action: 'sign-in', disabled: false });
  });

  it('is that the window is open, with Done in place of Sign in', () => {
    expect(signInLine(browser({ state: 'signing-in' }), false)).toContain('The window is open');
    expect(signInButton(browser({ state: 'signing-in' }), false)).toEqual({ label: 'Done', action: 'done', disabled: false });
  });

  it('is how many threads are on it, since signing in closes their pages', () => {
    expect(signInLine(browser({ state: 'open', threads: 1 }), false)).toBe('1 thread is using it now. Signing in closes their pages first.');
    expect(signInLine(browser({ state: 'open', threads: 3 }), false)).toContain('3 threads are using it now');
  });

  it('is the reason when it could not open, and the wait while it is opening', () => {
    expect(signInLine(browser({ ok: false, error: 'The project\'s browser did not start. Try again.' }), false)).toBe('The project\'s browser did not start. Try again.');
    expect(signInLine(browser(), true)).toBe('Opening the window.');
    expect(signInLine(browser({ canRun: false }), true)).toContain('Downloading Chrome for Testing');
    expect(signInButton(browser(), true).disabled).toBe(true);
  });

  it('is drawn on the project\'s own page, through the one channel both front doors offer', () => {
    const page = fs.readFileSync(path.join(REPO, 'renderer/src/components/Settings.tsx'), 'utf8');
    expect(page).toMatch(/<Group label="Browser">\s*<ProjectBrowserRows project=\{current\}/);
    expect(REQUEST_CHANNELS.projectBrowser).toBe('zero:project-browser');
    expect(fs.readFileSync(path.join(REPO, 'preload.cjs'), 'utf8')).toContain("ipcRenderer.invoke('zero:project-browser', payload)");
    expect(fs.readFileSync(path.join(REPO, 'main/ipc.mts'), 'utf8')).toContain("ipcMain.handle('zero:project-browser'");
  });
});
