// A PROJECT FOLDER THAT HOLDS REPOSITORIES, AND IS NOT ONE ITSELF, RUNS ITS
// TASKS IN THE FOLDER ITSELF.
//
// REPORTED 2026-11-10 (w-d6a8a84bc0): "estou tendo o problema abaixo para
// quando eu estou abrindo threads em projetos que na raiz nao é git. mas isso
// nao deveria dar problema. isso esta acontecendo até quando tento fazer o move
// de um projeto para o outro da thread." Every thread in a project made from a
// folder of a client's repositories, and every thread moved into it, ended
// "Could not make a folder for w-c3b8dd4c13: fatal: invalid reference: HEAD".
//
// MEASURED ON THAT FOLDER the same day: eight entries, six of them
// repositories with history and two plain folders holding two more each, one
// of which had never had a commit. The app's `git init` had run there on
// 2026-11-07 and its `git add -A` died on that repository ("does not have a
// commit checked out"). Nothing looked at that answer, so the folder was left
// a repository with no commit, and every task after it asked git for a branch
// off nothing.
//
// MAKING THE FIRST COMMIT WORK WOULD NOT HAVE BEEN THE FIX. A repository made
// around other repositories records each one as a bare pointer, so in a task
// folder made from it every one of them is an empty directory: the task gets a
// copy of the project with none of the code in it. So such a folder is left as
// it is, and its tasks run in it the way a project with no repository always
// has (tests/a-task-with-no-folder-does-not-run-in-the-shared-checkout keeps
// that road). The change card stays honest there, because a folder that is not
// a checkout has nothing for git to read: each session's card comes from its
// own conversation.
//
// AND WHAT MUST NOT CHANGE: a plain folder of files is still made a repository
// with a first commit and still gives every task a folder of its own
// (tests/a-project-folder-that-is-not-a-repository-still-runs-its-first-task),
// and a repository with a commit is never asked about what it holds.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureTaskFolder, heldRepositories, taskFolderPath } from '../main/task-folders.mts';
import { Supervisor } from '../main/supervisor.mts';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ident = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];

const made: string[] = [];
const folder = (prefix: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of made.splice(0)) {
    try { execFileSync('chmod', ['-R', 'u+rwX', dir]); } catch { /* already gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A repository with one commit, at `rel` under `dir`. */
function repositoryAt(dir: string, rel: string) {
  const at = path.join(dir, rel);
  fs.mkdirSync(at, { recursive: true });
  git(at, 'init', '-q');
  fs.writeFileSync(path.join(at, 'README.md'), `${rel}\n`);
  git(at, 'add', '-A');
  git(at, ...ident, 'commit', '-q', '-m', 'first');
  return at;
}

/** A repository nobody has committed to yet, which is what stopped `git add -A`. */
function unbornRepositoryAt(dir: string, rel: string) {
  const at = path.join(dir, rel);
  fs.mkdirSync(at, { recursive: true });
  git(at, 'init', '-q');
  fs.writeFileSync(path.join(at, 'draft.ts'), 'export {};\n');
  return at;
}

/** The reported folder in small: repositories side by side, a group folder
 *  holding two more (one never committed to), and loose files at the top. */
function folderOfRepositories() {
  const dir = folder('client-repos-');
  repositoryAt(dir, 'portal');
  repositoryAt(dir, 'api');
  fs.mkdirSync(path.join(dir, 'group'));
  fs.writeFileSync(path.join(dir, 'group', 'loose-file.txt'), 'something nobody meant to commit\n');
  repositoryAt(dir, path.join('group', 'platform'));
  unbornRepositoryAt(dir, path.join('group', 'sync-api'));
  fs.writeFileSync(path.join(dir, 'notes.md'), 'kickoff notes\n');
  return dir;
}

function supervisorOver(repoPath: string | null) {
  const dir = folder('held-repos-store-');
  const product = { slug: 'clients', name: 'Clients', dir, repoPath };
  const said: { id: string; result?: string }[] = [];
  const sup = new Supervisor(
    {
      home: path.join(dir, 'home'),
      storeRoot: dir,
      claudeBin: '/nonexistent/claude',
      codexBin: '/nonexistent/codex',
      maxConcurrentSessions: 3,
      authProfiles: ['default'],
      codexHome: path.join(dir, 'codex-home'),
    },
    {
      listItems: () => [],
      listProducts: () => [product],
      readItem: () => null,
      isDue: () => true,
      settleAnswer() {},
      recordSessionResult: (_slug: string, id: string, patch: { result?: string }) => said.push({ id, ...patch }),
    },
    '/nonexistent-app',
  );
  return { sup, product, said };
}

describe('a project folder that holds repositories and is not one', () => {
  it('runs a task in the folder itself, though one repository in it has no commit yet', () => {
    const dir = folderOfRepositories();
    const { sup, product } = supervisorOver(dir);
    const item = { id: 'w-heldrepos', product: 'clients', title: 'Study the module documentation' };

    expect(sup._folderRow(item, product)).toBe(false);
    expect(sup.workFolderFor(item, product)).toBe(dir);
    // A resumed chat ran there, so it may be resumed there.
    expect(sup.workFolders(item, product)).toContain(dir);
    // Nothing was made: no repository around theirs, no folder for task folders.
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.claude'))).toBe(false);
  });

  it('does not park a spawn to make a folder it will never make', () => {
    const dir = folderOfRepositories();
    const { sup, product } = supervisorOver(dir);

    expect(sup._folderFirst({ id: 'w-heldrepos-async', product: 'clients' }, product, 'claude', {})).toBe(false);
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(false);
  });

  // THE STATE THE REPORTED FOLDER WAS LEFT IN: an earlier version made it a
  // repository and never got its first commit in. That repository holds none
  // of their work, and it is theirs to keep or delete, so it is left alone and
  // the task runs anyway.
  it('runs there too when an earlier version left a repository with no commit at the top', () => {
    const dir = folderOfRepositories();
    git(dir, 'init', '-q');
    const { sup, product } = supervisorOver(dir);
    const item = { id: 'w-heldrepos-unborn', product: 'clients' };

    expect(sup.workFolderFor(item, product)).toBe(dir);
    expect(() => git(dir, 'rev-parse', '--verify', '-q', 'HEAD')).toThrow();
  });

  it('tells the agent which repositories are there, and to change one from a worktree of it', () => {
    const dir = folderOfRepositories();
    const { sup, product } = supervisorOver(dir);
    const brief = sup.buildBrief({ id: 'w-heldrepos-brief', product: 'clients', title: 'Fix the login', labels: [] }, product);

    expect(brief).toContain(`Product code folder (your cwd): ${dir}`);
    expect(brief).toContain('no git history of its own');
    expect(brief).toContain('api, group/platform, group/sync-api, portal');
    expect(brief).toMatch(/no folder of its own/);
    expect(brief).toContain('worktree add .claude/worktrees/w-heldrepos-brief');
  });

  it('is never wrapped in a repository by the folder code either, and the refusal says why', () => {
    const dir = folderOfRepositories();

    expect(() => ensureTaskFolder(dir, 'w-heldrepos-direct', { dependencies: false }))
      .toThrow(/not a git repository.*holds repositories of its own.*api/s);
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(false);
  });

  it('names what it holds in order, and leaves out tooling', () => {
    const dir = folderOfRepositories();
    // A package an installer cloned, and the app's own task folders: neither is a project of theirs.
    repositoryAt(dir, path.join('node_modules', 'some-package'));
    repositoryAt(dir, path.join('.venv', 'src', 'editable'));

    expect(heldRepositories(dir)).toEqual(['api', 'group/platform', 'group/sync-api', 'portal']);
    expect(heldRepositories(dir, { first: true })).toHaveLength(1);
  });
});

describe('what must not change', () => {
  it('a repository with a commit is asked nothing about what it holds, and its tasks get folders as before', () => {
    const dir = folderOfRepositories();
    git(dir, 'init', '-q');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'portal/\napi/\ngroup/\n');
    git(dir, 'add', '-A');
    git(dir, ...ident, 'commit', '-q', '-m', 'the top is a repository of its own');
    const { sup, product } = supervisorOver(dir);
    const item = { id: 'w-heldrepos-repo', product: 'clients' };

    expect(heldRepositories(dir)).toEqual([]);
    expect(sup._folderRow(item, product)).toBe(true);
    expect(sup.workFolderFor(item, product)).toBe(taskFolderPath(dir, 'w-heldrepos-repo'));
  }, 30_000);

  it('a plain folder of files is still made a repository, and its task gets a folder', () => {
    const dir = folder('plain-files-');
    fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hi</h1>\n');
    const { sup, product } = supervisorOver(dir);
    const item = { id: 'w-heldrepos-plain', product: 'clients' };

    expect(sup._folderRow(item, product)).toBe(true);
    const got = sup.workFolderFor(item, product);
    expect(got).toBe(taskFolderPath(dir, 'w-heldrepos-plain'));
    expect(fs.readFileSync(path.join(got, 'index.html'), 'utf8')).toBe('<h1>hi</h1>\n');
  }, 30_000);
});

// THE FIRST COMMIT ITSELF, for a folder the app does make a repository.
describe('the first commit of a plain folder', () => {
  // A repository the search does not look for, inside a hidden folder, is no
  // reason to refuse the folder, and neither is it something to record as an
  // empty pointer. With no commit of its own it used to stop the whole commit.
  it('leaves a repository inside it out, even one with no commit yet, instead of failing on it', () => {
    const dir = folder('plain-with-tooling-');
    fs.writeFileSync(path.join(dir, 'app.js'), 'x\n');
    unbornRepositoryAt(dir, path.join('.tools', 'cloned'));

    const got = ensureTaskFolder(dir, 'w-heldrepos-tooling', { dependencies: false });

    expect(got?.taken).toBe(true);
    expect(git(dir, 'ls-files').split('\n')).toEqual(['app.js']);
  }, 30_000);

  // AND A FIRST COMMIT GIT WILL NOT MAKE SAYS SO, with git's own words, rather
  // than leaving a repository with no commit for every later task to trip on.
  it('says why when git will not make it, and leaves no repository behind', () => {
    const dir = folder('plain-unreadable-');
    fs.writeFileSync(path.join(dir, 'app.js'), 'x\n');
    const locked = path.join(dir, 'locked.txt');
    fs.writeFileSync(locked, 'nobody may read this\n');
    fs.chmodSync(locked, 0o000);

    expect(() => ensureTaskFolder(dir, 'w-heldrepos-unreadable', { dependencies: false }))
      .toThrow(/first commit.*locked\.txt/s);
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(false);
  }, 30_000);
});
