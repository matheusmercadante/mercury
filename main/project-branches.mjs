// The local branches a project's threads may start from, for the project page
// and the new thread card. The app's own task branches are left out: a thread
// is never meant to start from another thread's work.
import { execFile } from 'node:child_process';
import { nameSlug } from '../shared/product-name.mjs';

const TASK_PREFIX = `${nameSlug}/`;
const GIT_MS = 5000;

const listed = (out) => String(out ?? '').split('\n').map((l) => l.trim())
  .filter((name) => name && !name.startsWith(TASK_PREFIX));

/**
 * `{ branches, main }`, newest commit first. `main` is the branch a thread
 * starts from when nobody chose one (main/task-folders.mjs `baseRef`), or null.
 * A folder that is not a repository answers no branches.
 */
export function branchesIn(repoPath) {
  return new Promise((resolve) => {
    if (!repoPath) { resolve({ branches: [], main: null }); return; }
    execFile('git', ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads'],
      { cwd: repoPath, encoding: 'utf8', timeout: GIT_MS }, (error, out) => {
        const branches = error ? [] : listed(out);
        resolve({ branches, main: ['main', 'master'].find((b) => branches.includes(b)) ?? null });
      });
  });
}

/** Whether a repository has this local branch. */
export function hasBranch(repoPath, name) {
  return new Promise((resolve) => {
    if (!repoPath || typeof name !== 'string' || !name.trim()) { resolve(false); return; }
    execFile('git', ['rev-parse', '--verify', '-q', `refs/heads/${name}`], { cwd: repoPath, timeout: GIT_MS }, (error) => resolve(!error));
  });
}
