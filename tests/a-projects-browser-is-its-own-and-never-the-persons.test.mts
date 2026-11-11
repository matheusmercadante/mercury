// A PROJECT'S BROWSER IS ITS OWN, AND NEVER THE PERSON'S.
//
// Why this exists (2026-11-10): the rule was that a browser an agent drives
// carries nothing. Mercury's owner widened it by one step, on purpose: a
// project may have a browser that carries the sign-ins they made in it by hand
// for that project. The step is only safe while it stays that small, so this
// holds its edges. It runs on Chrome for Testing and on a profile of its own;
// nothing in it names the person's Chrome, attaches to a browser already
// running, or opens a port; and the sign-in window and the hidden browser keep
// their cookies under the same key, or a sign-in made in one would be lost to
// the other.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COOKIE_STORE_FLAGS, signInArgs } from '../main/project-browser/sign-in.mts';
import { testBrowser } from '../main/project-browser/host.mts';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const SOURCES = [...fs.readdirSync(path.join(REPO, 'main/project-browser')).map((f) => `main/project-browser/${f}`), 'mcp/project-browser.mts', 'shared/project-browser.mts'];

describe('the browser a project\'s agents drive', () => {
  it('is Chrome for Testing from Playwright\'s own folder, or nothing', () => {
    const bin = testBrowser();
    if (bin) {
      expect(bin).toContain('ms-playwright');
      expect(bin).toContain('Google Chrome for Testing');
    }
    expect(read('main/project-browser/host.mts')).toMatch(/testBrowser = \(\): string \| null => chromesForTesting\(\)\[0\] \?\? null/);
  });

  it('is never the person\'s own browser, by its name, its channel, its profile or the flag that attaches to it', () => {
    for (const rel of SOURCES) {
      const text = read(rel);
      expect(text, rel).not.toMatch(/Google Chrome\.app|MAC_CHROME|channel:|--chrome\b|Application Support\/Google|connectOverCDP|cdpEndpoint|--extension/);
    }
  });

  it('listens on no port, hidden or with its window', () => {
    for (const rel of SOURCES) expect(read(rel), rel).not.toMatch(/remote-debugging-port/);
    const args = signInArgs('/profiles/oms', ['https://acme.atlassian.net/']);
    expect(args).toContain('--remote-debugging-pipe');
    expect(args.some((a) => a.includes('remote-debugging-port'))).toBe(false);
  });
});

describe('the window its owner signs in through', () => {
  it('opens on the project\'s own profile and its sites', () => {
    const args = signInArgs('/profiles/oms', ['https://acme.atlassian.net/']);
    expect(args[0]).toBe('--user-data-dir=/profiles/oms');
    expect(args.at(-1)).toBe('https://acme.atlassian.net/');
  });

  it('is not driven: nothing marks it as automated', () => {
    expect(signInArgs('/profiles/oms', []).some((a) => /enable-automation|headless/.test(a))).toBe(false);
  });

  it('keeps its cookies under the key the hidden browser reads them with', () => {
    const args = signInArgs('/profiles/oms', []);
    for (const flag of COOKIE_STORE_FLAGS) expect(args).toContain(flag);
    // Playwright's own switches for every Chromium it starts, which is how the hidden browser is started.
    const playwright = read('node_modules/playwright-core/lib/coreBundle.js');
    for (const flag of COOKIE_STORE_FLAGS) expect(playwright).toContain(`"${flag}"`);
  });
});

describe('the rule, where a session reads it before it builds on this', () => {
  const law = read('CLAUDE.md');

  it('still forbids the person\'s own browser', () => {
    expect(law).toContain('NO WORKER EVER DRIVES THE USER');
    expect(law).toContain('--chrome');
  });

  it('says what a project\'s browser may carry, and that anything wider is the owner\'s to approve', () => {
    expect(law).toContain('main/project-browser/');
    expect(law).toMatch(/only the\s+sign-ins its owner made in it by hand/);
    expect(law).toMatch(/needs their yes/);
  });
});
