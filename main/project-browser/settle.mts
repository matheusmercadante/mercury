// A PAGE IS HANDED OVER WHEN IT HAS FILLED IN, NOT WHEN IT HAS LOADED.
//
// An app like Jira loads an empty shell and draws the page a few seconds
// later. Measured on a public Jira issue (2026-11-10): what Playwright MCP
// hands back when the navigation returns is 0 characters, and the 20,000 of the
// issue are there about 4 seconds after. An agent handed the empty page spends
// a turn finding that out, and a turn is the slow part of browsing.
//
// So after a navigation the page is read again until it stops changing. A
// short page that has stopped changing is taken as done only once the network
// has gone quiet too, because a shell also holds still while its code loads.
import type { Page } from 'playwright-core';

const QUIET_MS = 500;
// A request open this long is a stream or a long poll, not the page loading.
const STREAM_MS = 5_000;

/** Says whether the page's network has gone quiet: nothing started in the last half second, nothing short still open. */
export function watchRequests(page: Page, now: () => number = Date.now): () => boolean {
  const open = new Map<object, number>();
  let lastAt = 0;
  page.on('request', (request) => { lastAt = now(); open.set(request, lastAt); });
  const done = (request: object) => { open.delete(request); lastAt = now(); };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return () => {
    const at = now();
    if (at - lastAt < QUIET_MS) return false;
    for (const began of open.values()) if (at - began < STREAM_MS) return false;
    return true;
  };
}

/**
 * Waits until `read` (how much is on the page) has stopped changing: twice the
 * same with the network quiet, or three times the same on a page long enough
 * to be one, since an app draws in steps and holds still between them. Gives
 * up waiting, without failing, after `mostMs`.
 */
export async function settled({ read, quiet, everyMs = 400, enough = 400, shortAfterMs = 5_000, mostMs = 10_000, now = Date.now, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) }: {
  read: () => Promise<number>;
  quiet: () => boolean;
  everyMs?: number;
  /** A page with this much on it that has stopped changing is done, whatever the network is doing. */
  enough?: number;
  /** A shorter page that has stopped changing is done after this long, quiet or not. */
  shortAfterMs?: number;
  mostMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<void> {
  const began = now();
  let last = await read();
  let same = 0;
  while (now() - began < mostMs) {
    await sleep(everyMs);
    const size = await read();
    same = size === last ? same + 1 : 0;
    last = size;
    if (!same) continue;
    if (quiet() || (same >= 2 && size >= enough) || now() - began >= shortAfterMs) return;
  }
}
