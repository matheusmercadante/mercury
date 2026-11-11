// A PAGE IS HANDED TO AN AGENT ONCE IT HAS FILLED IN.
//
// What broke (2026-11-10, measured on a public Jira Cloud issue through a
// project's browser): opening the issue came back in 1.8 s with a page file of
// 0 characters and the title "Jira". The issue's 19,940 characters were there
// about 4 s later. An agent handed the empty page has to notice, wait and read
// again, and each of those is a turn of the model, which is the slow part.
// The page is now read again until it stops changing before it is handed over.
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type { Page } from 'playwright-core';
import { settled, watchRequests } from '../main/project-browser/settle.mts';

/** A page whose size is read off a script of (time, size) steps, on a clock the wait itself moves. */
function page(steps: [number, number][], quietFrom = 0) {
  let at = 0;
  const reads: number[] = [];
  return {
    reads,
    waited: () => at,
    opts: {
      now: () => at,
      sleep: async (ms: number) => { at += ms; },
      quiet: () => at >= quietFrom,
      read: async () => {
        const size = [...steps].reverse().find(([from]) => at >= from)?.[1] ?? 0;
        reads.push(size);
        return size;
      },
    },
  };
}

describe('how long a page is waited for', () => {
  it('is no longer than two looks for a plain page that is all there', async () => {
    const plain = page([[0, 2_000]]);
    await settled(plain.opts);
    expect(plain.waited()).toBe(400);
  });

  it('is until an app has drawn the page, not until its empty shell holds still', async () => {
    // The Jira issue as measured: nothing, a shell, the start of the page, the page.
    const jira = page([[0, 0], [1_000, 110], [3_000, 3_172], [3_800, 19_940]], 60_000);
    await settled(jira.opts);
    expect(jira.reads.at(-1)).toBe(19_940);
    expect(jira.waited()).toBeGreaterThanOrEqual(4_000);
    expect(jira.waited()).toBeLessThan(5_000);
  });

  it('is short for a small page whose network has gone quiet', async () => {
    const small = page([[0, 120]], 0);
    await settled(small.opts);
    expect(small.waited()).toBe(400);
  });

  it('is five seconds for a small page that keeps the network busy, not for ever', async () => {
    const chatty = page([[0, 120]], 60_000);
    await settled(chatty.opts);
    expect(chatty.waited()).toBeGreaterThanOrEqual(5_000);
    expect(chatty.waited()).toBeLessThan(5_500);
  });

  it('ends at ten seconds on a page that never stops changing', async () => {
    let n = 0;
    const ticker = page([[0, 0]]);
    await settled({ ...ticker.opts, read: async () => { n += 1; return n; } });
    expect(ticker.waited()).toBeGreaterThanOrEqual(10_000);
    expect(ticker.waited()).toBeLessThan(10_500);
  });
});

describe('when a page\'s network counts as quiet', () => {
  function watched() {
    let at = 10_000;
    const fake = new EventEmitter();
    const quiet = watchRequests(fake as unknown as Page, () => at);
    return { fake, quiet, pass: (ms: number) => { at += ms; } };
  }

  it('is when nothing has been asked for in the last half second', () => {
    const { quiet } = watched();
    expect(quiet()).toBe(true);
  });

  it('is not while something is being fetched, or just after it arrived', () => {
    const { fake, quiet, pass } = watched();
    const request = {};
    fake.emit('request', request);
    pass(2_000);
    expect(quiet()).toBe(false);
    fake.emit('requestfinished', request);
    pass(200);
    expect(quiet()).toBe(false);
    pass(400);
    expect(quiet()).toBe(true);
  });

  it('is once a failed request is over too', () => {
    const { fake, quiet, pass } = watched();
    const request = {};
    fake.emit('request', request);
    fake.emit('requestfailed', request);
    pass(600);
    expect(quiet()).toBe(true);
  });

  it('is despite a request left open for good, which is a stream and not the page loading', () => {
    const { fake, quiet, pass } = watched();
    fake.emit('request', {});
    pass(4_000);
    expect(quiet()).toBe(false);
    pass(1_500);
    expect(quiet()).toBe(true);
  });
});
