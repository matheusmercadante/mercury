// A PAGE GOES ONLY TO THE PROJECT'S SITES.
//
// Two checks on every page a thread holds.
//
// Before a page leaves for an address: the browser pauses each document
// request, and one for the page itself (not a frame inside it) that names a
// site off the list is failed before it is sent. Only documents are paused, so
// the browser keeps its cache; a rule on every request turns the cache off,
// and a Jira page then downloads 14 MB again on every visit (measured
// 2026-11-10).
//
// After a page has arrived: a site may send the page on to another address
// (single sign-on does, through the sign-in service and back), and those
// hops are let through. A page that ends up off the list is emptied, and the
// thread is told where it went.
import type { BrowserContext, Page } from 'playwright-core';

interface Paused {
  requestId: string;
  frameId: string;
  request: { url: string };
  redirectedRequestId?: string;
}

interface NavigatedFrame { frame: { id: string; parentId?: string } }

const isWeb = (url: string): boolean => /^https?:/i.test(url);
const hostOf = (url: string): string => { try { return new URL(url).hostname; } catch { return url; } };

/** A site off the list a page was kept from: `stopped` before anything was sent, `emptied` after the site sent the page there. */
export type KeptFrom = { host: string; how: 'stopped' | 'emptied' };

export async function guardPage(context: BrowserContext, page: Page, { allows, kept }: {
  allows: (url: string) => boolean;
  kept: (from: KeptFrom) => void;
}): Promise<void> {
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (!isWeb(url) || allows(url)) return;
    kept({ host: hostOf(url), how: 'emptied' });
    page.goto('about:blank').catch(() => {});
  });

  const cdp = await context.newCDPSession(page);
  let top = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
  cdp.on('Page.frameNavigated', ({ frame }: NavigatedFrame) => { if (!frame.parentId) top = frame.id; });
  cdp.on('Fetch.requestPaused', (paused: Paused) => {
    const leaving = paused.frameId === top && !paused.redirectedRequestId && isWeb(paused.request.url) && !allows(paused.request.url);
    if (leaving) kept({ host: hostOf(paused.request.url), how: 'stopped' });
    const answer = leaving
      ? cdp.send('Fetch.failRequest', { requestId: paused.requestId, errorReason: 'BlockedByClient' })
      : cdp.send('Fetch.continueRequest', { requestId: paused.requestId });
    answer.catch(() => {});
  });
  await cdp.send('Page.enable');
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document' }] });
}
