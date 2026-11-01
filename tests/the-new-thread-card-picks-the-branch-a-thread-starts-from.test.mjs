// THE NEW THREAD CARD CAN PICK THE BRANCH A THREAD STARTS FROM.
//
// A project whose work all happens on `develop` had every thread cut from
// `main` (tests/a-thread-starts-from-the-branch-it-was-given). The project page
// now sets a default, and the card offers a branch chip beside the project for
// the one thread that needs another. These are the card's rules: when the chip
// is drawn, what it says, the order of the menu, and what the send carries.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { branchChip, branchRows, BRANCH_ROWS_SHOWN } from '../renderer/src/threads/composer-rules';

const oms = { branches: ['feature/flow', 'develop', 'chore/release-1', 'main'], main: 'main', preset: 'develop' };
const plain = { branches: ['main'], main: 'main', preset: null };

describe('the branch chip', () => {
  it('is drawn for a repository with more than one branch', () => {
    expect(branchChip(null, oms)).toEqual({ shown: 'develop', field: {} });
  });

  it('is not drawn for one branch and no project default, which is most projects', () => {
    expect(branchChip(null, plain)).toBe(null);
  });

  it('is not drawn before the branches are known, or for a project with no repository', () => {
    expect(branchChip(null, null)).toBe(null);
    expect(branchChip(null, { branches: [], main: null, preset: null })).toBe(null);
  });

  it('says main when the project has no default', () => {
    expect(branchChip(null, { ...oms, preset: null }).shown).toBe('main');
  });

  it('says the pick, and the send carries it', () => {
    expect(branchChip('feature/flow', oms)).toEqual({ shown: 'feature/flow', field: { baseBranch: 'feature/flow' } });
  });
});

describe('the branch menu', () => {
  it('opens on the project default, then main, then the newest first', () => {
    expect(branchRows(oms, '')).toEqual({ rows: ['develop', 'main', 'feature/flow', 'chore/release-1'], more: 0 });
  });

  it('narrows to what was typed, whatever its case', () => {
    expect(branchRows(oms, 'FLOW').rows).toEqual(['feature/flow']);
    expect(branchRows(oms, 'nothing').rows).toEqual([]);
  });

  it('shows a page of a long list and says how many more there are', () => {
    const branches = Array.from({ length: BRANCH_ROWS_SHOWN + 5 }, (_, i) => `b${i}`);
    const got = branchRows({ branches, main: null, preset: null }, '');
    expect(got.rows.length).toBe(BRANCH_ROWS_SHOWN);
    expect(got.more).toBe(5);
  });
});

describe('the card', () => {
  const card = fs.readFileSync(new URL('../renderer/src/threads/ThreadComposer.tsx', import.meta.url), 'utf8');

  it('sends the pick with a task and with a repeating task', () => {
    const sends = card.slice(card.indexOf('const sendTask'), card.indexOf('const sendMessage'));
    expect(sends.match(/\.\.\.branch\??\.field/g)?.length).toBe(2);
  });

  it('forgets the pick when the project changes', () => {
    expect(card).toMatch(/setBranchPick\(null\)/);
  });
});
