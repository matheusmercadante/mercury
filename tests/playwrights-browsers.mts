// Whether the tests that draw a page with Playwright can start their browser
// here, for tests/agentbox-home.setup.mts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Where Playwright keeps the browsers it downloads on this computer. */
export const playwrightCache = (platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string =>
  platform === 'darwin' ? path.join(home, 'Library/Caches/ms-playwright') : path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'ms-playwright');

/** The build of its headless shell the installed Playwright starts, or null with no Playwright. */
export function shellBuild(repo: string = REPO): string | null {
  try {
    const { browsers } = JSON.parse(fs.readFileSync(path.join(repo, 'node_modules/playwright-core/browsers.json'), 'utf8')) as { browsers: { name: string; revision: string }[] };
    return browsers.find((b) => b.name === 'chromium-headless-shell')?.revision ?? null;
  } catch { return null; }
}

/** Whether `chromium.launch({ headless: true })` has its browser on this computer. */
export const shellIsInstalled = ({ cache = playwrightCache(), build = shellBuild() }: { cache?: string; build?: string | null } = {}): boolean =>
  !!build && fs.existsSync(path.join(cache, `chromium_headless_shell-${build}`, 'INSTALLATION_COMPLETE'));

/** The folder a test run points Playwright at, or null to leave it looking where it does. */
export function browsersFolderForTests({ env = process.env, installed = shellIsInstalled, empty }: { env?: NodeJS.ProcessEnv; installed?: () => boolean; empty: string }): string | null {
  if (env.PLAYWRIGHT_BROWSERS_PATH) return null;
  return installed() ? null : empty;
}
