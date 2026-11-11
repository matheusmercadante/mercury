// ONLY A PROJECT'S OWN THREADS ARE HANDED ITS BROWSER.
//
// Why this exists (2026-11-10): a project's browser holds the sign-ins its
// owner made for that project, for a client's Jira say. A thread of another
// project has no business in them, and a project whose owner listed no site
// has no browser at all. So the tools ride on a run only when its own project
// lists a site, they name that project's folder and no other, and nothing a
// worker is handed for them is worth reading.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Supervisor, type SpawnFile } from '../main/supervisor.mts';
import { giveProjectBrowser, hostFor, projectBrowserBrief, projectSitesChanged } from '../main/project-browser/app.mts';
import { browserDir, pagesDir, profileDir, readProject, socketPath } from '../main/project-browser/place.mts';
import { BROWSER_SERVER } from '../shared/project-browser.mts';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const made: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'whose-browser-')); made.push(d); return d; };
afterEach(() => { while (made.length) fs.rmSync(made.pop()!, { recursive: true, force: true }); });

function world(projectBrowserSites: Record<string, string[]> = { oms: ['acme.atlassian.net'], shop: ['admin.shop.dev'] }) {
  const root = tmp();
  const deps = { config: { storeRoot: path.join(root, 'store'), projectBrowserSites }, userDir: path.join(root, 'app'), appDir: REPO };
  fs.mkdirSync(deps.userDir, { recursive: true });
  const starts: string[] = [];
  const opts = { start: (host: { dir: string }) => { starts.push(host.dir); }, appPid: 4242, now: () => 1_000_000 };
  return { root, deps, starts, opts };
}

describe('the tools a run is handed', () => {
  it('are its own project\'s browser, by that project\'s socket and the thread\'s name', () => {
    const { deps, starts, opts } = world();
    const plan: { connectionServers?: Record<string, { command: string; args: string[]; env?: Record<string, string | null | undefined> }> | null } = {};
    giveProjectBrowser(plan, deps, { slug: 'oms', thread: 'w-1' }, opts);
    const server = plan.connectionServers?.[BROWSER_SERVER];
    expect(server?.args.at(-1)).toBe(path.join(REPO, 'mcp', 'project-browser.mts'));
    expect(server?.env).toEqual({ ELECTRON_RUN_AS_NODE: '1', PROJECT_BROWSER_SOCK: socketPath(browserDir(deps.userDir, 'oms')), PROJECT_BROWSER_THREAD: 'w-1' });
    expect(starts).toEqual([browserDir(deps.userDir, 'oms')]);
  });

  it('are nothing for a project whose owner listed no site', () => {
    const { deps, starts, opts } = world();
    const plan = { connectionServers: null };
    giveProjectBrowser(plan, deps, { slug: 'notes', thread: 'w-2' }, opts);
    expect(plan.connectionServers).toBeNull();
    expect(starts).toEqual([]);
    expect(fs.existsSync(browserDir(deps.userDir, 'notes'))).toBe(false);
  });

  it('never name another project\'s browser', () => {
    const { deps, opts } = world();
    const oms: { connectionServers?: Record<string, { env?: Record<string, string | null | undefined> }> | null } = {};
    const shop: typeof oms = {};
    giveProjectBrowser(oms, deps, { slug: 'oms', thread: 'w-1' }, opts);
    giveProjectBrowser(shop, deps, { slug: 'shop', thread: 'w-9' }, opts);
    const sockOf = (plan: typeof oms) => plan.connectionServers?.[BROWSER_SERVER]?.env?.PROJECT_BROWSER_SOCK;
    expect(sockOf(oms)).toBe(socketPath(browserDir(deps.userDir, 'oms')));
    expect(sockOf(shop)).toBe(socketPath(browserDir(deps.userDir, 'shop')));
    expect(sockOf(oms)).not.toBe(sockOf(shop));
    expect(readProject(browserDir(deps.userDir, 'oms'))?.sites).toEqual(['acme.atlassian.net']);
    expect(readProject(browserDir(deps.userDir, 'shop'))?.sites).toEqual(['admin.shop.dev']);
  });

  it('ride beside the run\'s other connections, not in place of them', () => {
    const { deps, opts } = world();
    const linear = { command: 'x', args: [], env: {} };
    const plan = { connectionServers: { linear } };
    giveProjectBrowser(plan, deps, { slug: 'oms', thread: 'w-1' }, opts);
    expect(Object.keys(plan.connectionServers)).toEqual(['linear', BROWSER_SERVER]);
  });
});

describe('where a project\'s browser keeps things', () => {
  it('is a profile of its own per project inside the app\'s folder, whatever the project is called', () => {
    const userDir = '/Users/x/Library/Application Support/App';
    expect(profileDir(browserDir(userDir, 'oms'))).toBe(path.join(userDir, 'browsers', 'oms', 'profile'));
    expect(profileDir(browserDir(userDir, 'oms'))).not.toBe(profileDir(browserDir(userDir, 'shop')));
    for (const slug of ['../../etc', '..', '.', 'a/b', '']) {
      const dir = browserDir(userDir, slug);
      expect(path.dirname(dir), slug).toBe(path.join(userDir, 'browsers'));
    }
  });

  it('writes the pages it hands over inside the store, which a worker may already read', () => {
    const { deps, opts } = world();
    hostFor(deps, 'oms', opts);
    const project = readProject(browserDir(deps.userDir, 'oms'));
    expect(project?.pages).toBe(pagesDir(deps.config.storeRoot, 'oms'));
    expect(project?.pages.startsWith(deps.config.storeRoot + path.sep)).toBe(true);
    expect(fs.existsSync(project!.pages)).toBe(true);
  });
});

describe('the host behind it', () => {
  it('is started once, not again for each run that follows', () => {
    const { deps, starts, opts } = world();
    hostFor(deps, 'oms', opts);
    hostFor(deps, 'oms', opts);
    hostFor(deps, 'oms', { ...opts, now: () => 1_005_000 });
    expect(starts.length).toBe(1);
  });

  it('is started again when the last start came to nothing', () => {
    const { deps, starts, opts } = world();
    hostFor(deps, 'oms', opts);
    hostFor(deps, 'oms', { ...opts, now: () => 1_000_000 + 60_000 });
    expect(starts.length).toBe(2);
  });

  it('is left alone when this app\'s own is already running', () => {
    const { deps, starts, opts } = world();
    const dir = browserDir(deps.userDir, 'oms');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'host.json'), JSON.stringify({ pid: process.pid, appPid: 4242, sock: socketPath(dir) }));
    hostFor(deps, 'oms', opts);
    expect(starts).toEqual([]);
  });

  it('is replaced when the one running was started by an earlier launch of the app', () => {
    const { deps, starts, opts } = world();
    const dir = browserDir(deps.userDir, 'oms');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'host.json'), JSON.stringify({ pid: process.pid, appPid: 1111, sock: socketPath(dir) }));
    hostFor(deps, 'oms', opts);
    expect(starts).toEqual([dir]);
  });

  it('reads a change to the project\'s sites without being started again', () => {
    const { deps, starts, opts } = world();
    hostFor(deps, 'oms', opts);
    deps.config.projectBrowserSites = { oms: ['acme.atlassian.net', 'grafana.acme.dev'] };
    projectSitesChanged(deps, 'oms');
    expect(readProject(browserDir(deps.userDir, 'oms'))?.sites).toEqual(['acme.atlassian.net', 'grafana.acme.dev']);
    deps.config.projectBrowserSites = {};
    projectSitesChanged(deps, 'oms');
    expect(readProject(browserDir(deps.userDir, 'oms'))?.sites).toEqual([]);
    expect(starts.length).toBe(1);
  });
});

describe('what a run is told', () => {
  const supervisor = (projectBrowserSites: Record<string, string[]>) => {
    const dir = tmp();
    const store = { listItems: () => [], listProducts: () => [], isDue: () => true };
    return new Supervisor({ storeRoot: dir, maxConcurrentSessions: 1, projectBrowserSites }, store, REPO, REPO, dir);
  };
  const row = (product: string) => ({ id: 'w-1a2b3c4d5e', product, title: 'Read the board', body: 'Do it.', labels: ['founder'] });
  const systemOf = (product: string) => supervisor({ oms: ['acme.atlassian.net'] }).spawnPlan(row(product), { slug: product, dir: os.tmpdir(), repoPath: null }, { engine: 'claude' }).system as string;

  it('is that its project has a browser, which sites it opens, and to read rather than act', () => {
    const system = systemOf('oms');
    expect(system).toContain('## This project\'s browser');
    expect(system).toContain('acme.atlassian.net');
    expect(system).toContain('done in their name');
    expect(system).toContain('Do not try to sign in');
  });

  it('is nothing about a browser on a project that has none', () => {
    expect(systemOf('notes')).not.toContain('This project\'s browser');
    expect(projectBrowserBrief({ storeRoot: '/s', projectBrowserSites: {} }, 'oms')).toBeNull();
    expect(projectBrowserBrief(null, 'oms')).toBeNull();
  });

  it('is granted the browser\'s tools on Claude Code without a question for each call', () => {
    const sup = supervisor({ oms: ['acme.atlassian.net'] });
    const plan = { args: [] as string[], connectionServers: { [BROWSER_SERVER]: { command: 'x', args: [], env: {} } } };
    const spawnFiles: SpawnFile[] = [];
    sup.prepareClaudePermissions(plan, { slug: 'oms', dir: os.tmpdir(), repoPath: null }, 'run-1', spawnFiles);
    try {
      const at = plan.args.indexOf(`mcp__${BROWSER_SERVER}`);
      expect(plan.args[at - 1]).toBe('--allowedTools');
      const config = JSON.parse(fs.readFileSync(plan.args[plan.args.indexOf('--mcp-config') + 1], 'utf8'));
      expect(Object.keys(config.mcpServers)).toContain(BROWSER_SERVER);
    } finally {
      sup.removeSpawnFiles({ spawnFiles });
    }
  });
});
