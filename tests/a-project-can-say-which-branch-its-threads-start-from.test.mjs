// WHICH BRANCH A THREAD'S FOLDER STARTS FROM IS SOMEBODY'S CHOICE, PER PROJECT AND PER THREAD.
//
// Every folder was cut from local `main`, and a project whose work all happens
// on `develop` had every new thread refused (tests/a-thread-starts-from-the-
// branch-it-was-given says how). Picking the branch by guessing (the checkout's
// branch, origin/HEAD) was turned down: the person working the project knows
// and the app does not. So the project page sets a default, the new thread card
// can pick another for one thread, and with neither it is `main` as before.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Supervisor } from '../main/supervisor.mts';
import { Store } from '../main/store.mts';
import { readSettings, setProjectBaseBranch } from '../main/settings.mts';
import { branchesIn } from '../main/project-branches.mjs';
import { taskBranch } from '../main/task-folders.mts';
import { occurrenceFields } from '../main/repeats.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const made = [];
const tmpDir = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), name)); made.push(d); return d; };

/** `main`, then `develop` and `feature/x` each one commit on from it. */
function repo() {
  const dir = tmpDir('start-pick-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'app.txt'), 'one\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'first');
  for (const b of ['develop', 'feature/x']) {
    git(dir, 'checkout', '-q', '-b', b, 'main');
    fs.writeFileSync(path.join(dir, 'app.txt'), `${b}\n`);
    git(dir, 'commit', '-q', '-am', b);
  }
  git(dir, 'checkout', '-q', 'develop');
  return dir;
}

let dir;
beforeEach(() => { dir = repo(); });
afterEach(() => {
  while (made.length) { try { fs.rmSync(made.pop(), { recursive: true, force: true }); } catch {} }
});

const products = () => [{ slug: 'oms', name: 'OMS', dir: path.join(dir, '.store'), repoPath: dir }];

function supervisorWith(config = {}) {
  const store = { listItems: () => [], listProducts: products, readItem: () => null, isDue: () => true };
  const sup = new Supervisor({ storeRoot: dir, home: dir, claudeBin: '/nonexistent/claude', codexBin: '/nonexistent/codex', authProfiles: ['default'], ...config }, store, '/nonexistent-app');
  sup._saveState = () => {};
  return sup;
}

const startOf = (folder) => git(folder, 'rev-parse', 'HEAD');

describe('the folder a thread is given', () => {
  it('starts from the project default', () => {
    const sup = supervisorWith({ projectBaseBranch: { oms: 'develop' } });
    const folder = sup.workFolderFor({ id: 'w-proj', product: 'oms' }, products()[0]);
    expect(startOf(folder)).toBe(git(dir, 'rev-parse', 'develop'));
  });

  it('starts from the thread\'s own pick over the project default', () => {
    const sup = supervisorWith({ projectBaseBranch: { oms: 'develop' } });
    const folder = sup.workFolderFor({ id: 'w-own', product: 'oms', baseBranch: 'feature/x' }, products()[0]);
    expect(startOf(folder)).toBe(git(dir, 'rev-parse', 'feature/x'));
  });

  it('starts from main with neither', () => {
    const sup = supervisorWith();
    const folder = sup.workFolderFor({ id: 'w-none', product: 'oms' }, products()[0]);
    expect(startOf(folder)).toBe(git(dir, 'rev-parse', 'main'));
  });

  it('is not made when the branch has gone, and says which', () => {
    const sup = supervisorWith({ projectBaseBranch: { oms: 'release/1' } });
    expect(() => sup.workFolderFor({ id: 'w-gone', product: 'oms' }, products()[0])).toThrow(/release\/1/);
  });
});

describe('the project default on the project page', () => {
  function config() {
    fs.writeFileSync(path.join(dir, 'zero.config.json'), '{}');
    return { appDir: dir, home: dir, authProfiles: ['default'] };
  }
  const store = { listProducts: products };

  it('is written, read back, and cleared', async () => {
    const c = config();
    await setProjectBaseBranch({ config: c, store }, { product: 'oms', value: 'develop' });
    expect(c.projectBaseBranch).toEqual({ oms: 'develop' });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'zero.config.json'), 'utf8')).projectBaseBranch).toEqual({ oms: 'develop' });
    const rows = readSettings({ config: { ...c, accountRoot: dir }, supervisor: supervisorWith(c), store: { ...store, listItems: () => [] } }).projects;
    expect(rows.find((p) => p.slug === 'oms').baseBranch).toBe('develop');
    await setProjectBaseBranch({ config: c, store }, { product: 'oms', value: '' });
    expect(c.projectBaseBranch).toBe(undefined);
  });

  it('refuses a branch the repository does not have', async () => {
    const c = config();
    await expect(setProjectBaseBranch({ config: c, store }, { product: 'oms', value: 'release/1' })).rejects.toThrow(/release\/1/);
    expect(c.projectBaseBranch).toBe(undefined);
  });
});

describe('the branches offered', () => {
  it('are the local branches, without the app\'s own task branches', async () => {
    git(dir, 'branch', taskBranch('w-1'), 'main');
    const got = await branchesIn(dir);
    expect(got.branches.sort()).toEqual(['develop', 'feature/x', 'main']);
    expect(got.main).toBe('main');
  });

  it('are none for a folder that is not a repository', async () => {
    expect((await branchesIn(tmpDir('plain-'))).branches).toEqual([]);
  });
});

describe('a thread\'s own pick', () => {
  let root;
  async function storeWithOms() {
    root = tmpDir('start-store-');
    const pdir = path.join(root, 'oms');
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, 'project.json'), JSON.stringify({ slug: 'oms', name: 'OMS' }));
    return new Store({ accountRoot: root, products: [] }).init();
  }

  it('is kept on the thread', async () => {
    const store = await storeWithOms();
    const item = store.composeItem('oms', { title: 'Fulfillment order flow selection', baseBranch: 'develop' });
    expect(store.readItem('oms', item.id).baseBranch).toBe('develop');
    const plain = store.composeItem('oms', { title: 'No pick' });
    expect(store.readItem('oms', plain.id).baseBranch).toBe(undefined);
  });

  it('goes with every run of a repeating task, across a restart', async () => {
    const store = await storeWithOms();
    const rule = store.composeRepeat('oms', { title: 'Nightly check', every: 'day', at: '09:00', baseBranch: 'develop' });
    const again = await new Store({ accountRoot: root, products: [] }).init();
    const kept = again.repeats.get(again.productDir('oms'), rule.id);
    expect(kept.baseBranch).toBe('develop');
    expect(occurrenceFields(kept, '2026-11-01', Date.now()).baseBranch).toBe('develop');
  });
});
