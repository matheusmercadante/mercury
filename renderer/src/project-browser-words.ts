// What a project's page says about the project's own browser.
import type { ProjectBrowser } from './types';

export const SITES_LABEL = 'Sites its agents may open';
export const SIGN_IN_LABEL = 'Sign in to its browser';

export function sitesLine(sites: readonly string[]): string {
  if (sites.length) return sites.join(', ');
  return 'List a site and this project\'s agents get a browser of their own for it. It holds only the sign-ins you make in it, never your own browser\'s.';
}

const threadsWord = (n: number): string => (n === 1 ? '1 thread is' : `${n} threads are`);

export function signInLine(browser: ProjectBrowser | null, busy: boolean): string {
  if (busy) return browser && !browser.canRun ? 'Downloading Chrome for Testing, which this browser runs on. This happens once.' : 'Opening the window.';
  if (browser && !browser.ok && browser.error) return browser.error;
  if (browser?.state === 'signing-in') return 'The window is open on this project\'s sites. Sign in, then close it. Agents wait until you do.';
  if (browser?.state === 'open' && browser.threads > 0) return `${threadsWord(browser.threads)} using it now. Signing in closes their pages first.`;
  const first = browser && !browser.canRun ? ' The first time, it downloads Chrome for Testing (about 170 MB).' : '';
  return `Opens this project's browser for you to sign in by hand. Its agents then read these sites as you.${first}`;
}

export function signInButton(browser: ProjectBrowser | null, busy: boolean): { label: string; action: 'sign-in' | 'done'; disabled: boolean } {
  if (browser?.state === 'signing-in') return { label: 'Done', action: 'done', disabled: busy };
  return { label: 'Sign in', action: 'sign-in', disabled: busy };
}
