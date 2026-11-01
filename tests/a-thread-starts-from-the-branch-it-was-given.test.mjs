// A THREAD'S FOLDER STARTS FROM THE BRANCH SOMEBODY CHOSE FOR IT, NOT ALWAYS MAIN.
//
// Found 2026-11-01 on a pnpm monorepo whose work all happens on `develop`:
// every new thread was refused with
//
//   node_modules/.pnpm/node_modules/@oms/kernel: it points at something that
//   was not carried in with it
//
// `baseRef` cut every folder from local `main`, 435 commits behind `develop`.
// The checkout stood on `develop`, so its `node_modules` linked to
// `packages/kernel`, which exists there and not on `main`. Copied into a folder
// cut from `main`, the link dangled and the folder was refused. Had it not
// been, the agent would have worked on code without those 435 commits.
//
// So a folder can start from a named local branch, the branch is written on the
// task branch, and the two readings that compare a folder with where it started
// (released once merged, "is there committed work") read it from there.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureTaskFolder, releaseTaskFolder, taskBranch, taskFolderPath } from '../main/task-folders.mjs';
import { whereTheWorkStands } from '../main/git-change.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const made = [];

/** `main` with one commit and `develop` one commit ahead, checkout on `develop`. */
function repoWithDevelop() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-branch-'));
  made.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'app.txt'), 'one\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'first');
  git(dir, 'checkout', '-q', '-b', 'develop');
  fs.mkdirSync(path.join(dir, 'packages', 'kernel'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'packages', 'kernel', 'index.js'), 'export {}\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'kernel, on develop only');
  return dir;
}

/** The link pnpm writes for a workspace package. */
function pnpmLinksTheKernel(dir) {
  const at = path.join(dir, 'node_modules', '.pnpm', 'node_modules', '@oms');
  fs.mkdirSync(at, { recursive: true });
  fs.symlinkSync('../../../../packages/kernel', path.join(at, 'kernel'));
}

const headOf = (dir) => git(dir, 'rev-parse', 'HEAD');

afterEach(() => {
  while (made.length) { try { fs.rmSync(made.pop(), { recursive: true, force: true }); } catch {} }
});

describe('a new folder asked to start from a branch', () => {
  let dir;
  beforeEach(() => { dir = repoWithDevelop(); });

  it('starts from that branch', () => {
    const got = ensureTaskFolder(dir, 'w-dev', { startFrom: 'develop' });
    expect(got.taken).toBe(true);
    expect(headOf(got.path)).toBe(headOf(dir));
    expect(fs.existsSync(path.join(got.path, 'packages', 'kernel', 'index.js'))).toBe(true);
  });

  it('starts from that branch when the checkout stands on another', () => {
    git(dir, 'checkout', '-q', 'main');
    const got = ensureTaskFolder(dir, 'w-other', { startFrom: 'develop' });
    expect(got.how).toBe('checkout');
    expect(headOf(got.path)).toBe(git(dir, 'rev-parse', 'develop'));
  });

  it('gets the dependencies whose links only hold on that branch', () => {
    pnpmLinksTheKernel(dir);
    const got = ensureTaskFolder(dir, 'w-pnpm', { startFrom: 'develop' });
    const link = path.join(got.path, 'node_modules', '.pnpm', 'node_modules', '@oms', 'kernel');
    expect(fs.existsSync(path.join(link, 'index.js'))).toBe(true);
  });

  it('is refused by name when the branch is not there, with nothing left behind', () => {
    expect(() => ensureTaskFolder(dir, 'w-gone', { startFrom: 'release/9' })).toThrow(/release\/9/);
    expect(fs.existsSync(taskFolderPath(dir, 'w-gone'))).toBe(false);
    expect(git(dir, 'branch', '--list', taskBranch('w-gone'))).toBe('');
  });

  it('leaves a task branch that already exists where it is', () => {
    git(dir, 'branch', taskBranch('w-kept'), 'main');
    const got = ensureTaskFolder(dir, 'w-kept', { startFrom: 'develop' });
    expect(headOf(got.path)).toBe(git(dir, 'rev-parse', 'main'));
  });
});

describe('a new folder asked for nothing', () => {
  let dir;
  beforeEach(() => { dir = repoWithDevelop(); });

  it('still starts from main', () => {
    const got = ensureTaskFolder(dir, 'w-main');
    expect(headOf(got.path)).toBe(git(dir, 'rev-parse', 'main'));
  });

  it('is still refused over a link its branch cannot hold, by that link', () => {
    pnpmLinksTheKernel(dir);
    expect(() => ensureTaskFolder(dir, 'w-dangles')).toThrow(/@oms\/kernel: it points at something that was not carried in with it/);
  });
});

describe('a folder that started from a branch', () => {
  let dir;
  beforeEach(() => { dir = repoWithDevelop(); });

  it('has no committed work of its own until it commits some', () => {
    const got = ensureTaskFolder(dir, 'w-idle', { startFrom: 'develop' });
    expect(whereTheWorkStands(got.path).committed).toBe(false);
    fs.writeFileSync(path.join(got.path, 'new.txt'), 'two\n');
    git(got.path, 'add', '.');
    git(got.path, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'work');
    expect(whereTheWorkStands(got.path).committed).toBe(true);
  });

  it('is put away once its work is on that branch, though not on main', () => {
    const got = ensureTaskFolder(dir, 'w-merged', { startFrom: 'develop' });
    fs.writeFileSync(path.join(got.path, 'new.txt'), 'two\n');
    git(got.path, 'add', '.');
    git(got.path, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'work');
    git(dir, 'merge', '-q', '--ff-only', taskBranch('w-merged'));
    const out = releaseTaskFolder(dir, 'w-merged');
    expect(out.reason).toBe('merged');
    expect(out.removed).toBe(true);
  });

  it('is kept while its work is on neither', () => {
    const got = ensureTaskFolder(dir, 'w-unmerged', { startFrom: 'develop' });
    fs.writeFileSync(path.join(got.path, 'new.txt'), 'two\n');
    git(got.path, 'add', '.');
    git(got.path, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'work');
    expect(releaseTaskFolder(dir, 'w-unmerged').reason).toBe('unmerged');
  });
});
