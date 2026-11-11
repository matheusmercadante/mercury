// A PAGE TEST RUNS ONLY WHERE PLAYWRIGHT HAS THE BROWSER IT STARTS.
//
// Why this exists (2026-11-11): twenty tests draw a page with
// `chromium.launch({ headless: true })` and skip themselves when
// `chromium.executablePath()` is not on the disk. That path is Chrome for
// Testing, and `launch` starts Playwright's headless shell, a second download.
// Playwright was not installed here, so they always skipped. A project's
// browser brought Playwright in and installs Chrome for Testing without the
// shell: on the whole suite 20 files then ran and 43 launches failed with
// "Executable doesn't exist at .../chromium_headless_shell-1247". A test run
// now points Playwright at an empty folder unless the shell is there.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { browsersFolderForTests, shellBuild, shellIsInstalled } from './playwrights-browsers.mts';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const made: string[] = [];
const cacheWith = (...folders: string[]) => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-cache-'));
  made.push(cache);
  for (const folder of folders) fs.mkdirSync(path.join(cache, folder), { recursive: true });
  return cache;
};
const complete = (cache: string, folder: string) => fs.writeFileSync(path.join(cache, folder, 'INSTALLATION_COMPLETE'), '');
afterEach(() => { while (made.length) fs.rmSync(made.pop()!, { recursive: true, force: true }); });

describe('whether Playwright has its headless shell', () => {
  it('reads the build the installed Playwright starts', () => {
    expect(shellBuild()).toMatch(/^\d+$/);
    expect(shellBuild(os.tmpdir())).toBeNull();
  });

  it('is no with Chrome for Testing alone, which is all a project\'s browser installs', () => {
    const cache = cacheWith('chromium-1247');
    complete(cache, 'chromium-1247');
    expect(shellIsInstalled({ cache, build: '1247' })).toBe(false);
  });

  it('is yes once that build of the shell has finished downloading', () => {
    const cache = cacheWith('chromium_headless_shell-1247');
    expect(shellIsInstalled({ cache, build: '1247' })).toBe(false);
    complete(cache, 'chromium_headless_shell-1247');
    expect(shellIsInstalled({ cache, build: '1247' })).toBe(true);
  });

  it('is no for another build of the shell, or with no Playwright at all', () => {
    const cache = cacheWith('chromium_headless_shell-1246', 'chromium_headless_shell-1254');
    complete(cache, 'chromium_headless_shell-1246');
    complete(cache, 'chromium_headless_shell-1254');
    expect(shellIsInstalled({ cache, build: '1247' })).toBe(false);
    expect(shellIsInstalled({ cache, build: null })).toBe(false);
  });
});

describe('where a test run tells Playwright to look', () => {
  it('is an empty folder when the shell is missing', () => {
    expect(browsersFolderForTests({ env: {}, installed: () => false, empty: '/nothing-here' })).toBe('/nothing-here');
  });

  it('is left alone when the shell is there, or when somebody already said where', () => {
    expect(browsersFolderForTests({ env: {}, installed: () => true, empty: '/nothing-here' })).toBeNull();
    expect(browsersFolderForTests({ env: { PLAYWRIGHT_BROWSERS_PATH: '/theirs' }, installed: () => false, empty: '/nothing-here' })).toBeNull();
  });

  it('makes the browser a page test asks for one that is not there, so the test skips itself', () => {
    const empty = cacheWith();
    const asked = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("playwright").chromium.executablePath())'], {
      cwd: REPO, encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: empty },
    });
    expect(asked.status).toBe(0);
    expect(asked.stdout.startsWith(fs.realpathSync(empty)) || asked.stdout.startsWith(empty)).toBe(true);
    expect(fs.existsSync(asked.stdout)).toBe(false);
  });

  it('is set for this run exactly when the shell is missing here', () => {
    const steered = (process.env.PLAYWRIGHT_BROWSERS_PATH ?? '').endsWith('no-playwright-browsers');
    expect(steered).toBe(!shellIsInstalled());
  });
});
