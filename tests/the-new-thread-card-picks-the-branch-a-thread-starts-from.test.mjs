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
    expect(branchRows(oms, '')).toEqual(['develop', 'main', 'feature/flow', 'chore/release-1']);
  });

  it('narrows to what was typed, whatever its case', () => {
    expect(branchRows(oms, 'FLOW')).toEqual(['feature/flow']);
    expect(branchRows(oms, 'nothing')).toEqual([]);
  });

  it('keeps every branch, for its list to scroll', () => {
    const branches = Array.from({ length: 120 }, (_, i) => `b${i}`);
    expect(branchRows({ branches, main: null, preset: null }, '').length).toBe(120);
  });
});

// THE MENU IS THE SIZE OF ITS NEIGHBOURS (2026-11-01). It listed thirty
// branches at 428px tall and 364px wide; on the card drawn on the page, where
// every bar menu drops below its chip, `fitMenu` found no room below and
// turned it upward, the only menu on the card that opened that way. Measured
// in the built renderer at 1280x820: project 190px tall, priority 177px.
describe('the branch menu\'s size', () => {
  const css = fs.readFileSync(new URL('../renderer/src/threads/thread-composer.css', import.meta.url), 'utf8');
  const rule = (sel) => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)));

  it('shows a few rows and scrolls the rest', () => {
    expect(BRANCH_ROWS_SHOWN).toBeLessThanOrEqual(4);
    expect(rule('.tc-branch-list')).toMatch(/overflow-y: auto/);
    expect(rule('.tc-branch-list')).toMatch(/max-height: calc\(var\(--tc-row\) \* var\(--tc-branch-rows\)\)/);
  });

  it('is a fixed width, a long name cut with an ellipsis', () => {
    expect(rule('.tc-branch-menu')).toMatch(/width: \d+px/);
    expect(rule('.tc-branch-menu .tc-row-label')).toMatch(/text-overflow: ellipsis/);
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

describe('the project page\'s branch picker', () => {
  const css = fs.readFileSync(new URL('../renderer/src/components/settings.css', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../renderer/src/components/Settings.tsx', import.meta.url), 'utf8');

  it('scrolls after a few rows, and only that picker does', () => {
    expect(css).toMatch(/\.set-picker-menu\.set-picker-long \{[^}]*overflow-y: auto/);
    expect(css).not.toMatch(/^\.set-picker-menu \{[^}]*max-height/m);
    const at = page.lastIndexOf('label="New threads start from"');
    const row = page.slice(at - 80, at);
    expect(row).toMatch(/\blong\b/);
  });
});
