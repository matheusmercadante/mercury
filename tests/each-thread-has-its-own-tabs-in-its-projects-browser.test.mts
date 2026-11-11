// EACH THREAD HAS ITS OWN TABS IN ITS PROJECT'S BROWSER.
//
// Why this exists (2026-11-10): a project's threads share one browser, because
// a saved profile serves one browser at a time and the sign-in has to be the
// same for all of them. Playwright MCP takes every page of the browser it is
// handed as a tab of its own and makes the first one current. Measured with two
// clients on one profile: the second client's first navigation would have moved
// the first client's page. Each thread is handed a view that shows only the
// pages it opened.
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type { BrowserContext, Page } from 'playwright-core';
import { threadViews } from '../main/project-browser/view.mts';

class FakePage {
  closed = false;
  constructor(readonly name: string, private readonly from: FakePage | null, private readonly home: FakeContext) {}
  async opener() { return this.from; }
  async close() { this.closed = true; this.home.open = this.home.open.filter((p) => p !== this); }
}

class FakeContext extends EventEmitter {
  open: FakePage[] = [];
  closedWhole = false;
  private n = 0;
  pages() { return [...this.open]; }
  async newPage() { return this.add(null); }
  /** A page the site opened itself, as a link with a new-tab target does. */
  popup(from: FakePage) { return this.add(from); }
  async close() { this.closedWhole = true; }
  async cookies() { return [{ name: 'session' }]; }
  private add(from: FakePage | null) {
    const page = new FakePage(`page-${this.n += 1}`, from, this);
    this.open.push(page);
    this.emit('page', page);
    return page;
  }
}

const asContext = (fake: FakeContext) => fake as unknown as BrowserContext;
const asFake = (page: Page) => page as unknown as FakePage;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function twoThreads() {
  const fake = new FakeContext();
  const views = threadViews(asContext(fake));
  return { fake, views, a: views.viewFor('thread-a'), b: views.viewFor('thread-b') };
}

describe('the pages a thread sees', () => {
  it('are the ones it opened, and no other thread\'s', async () => {
    const { a, b } = twoThreads();
    const mine = await a.newPage();
    const theirs = await b.newPage();
    expect(a.pages()).toEqual([mine]);
    expect(b.pages()).toEqual([theirs]);
  });

  it('do not include the blank page the browser started with', async () => {
    const fake = new FakeContext();
    await fake.newPage();
    const views = threadViews(asContext(fake));
    expect(views.viewFor('thread-a').pages()).toEqual([]);
  });

  it('are announced to that thread before its new page is handed back', async () => {
    const { a, b } = twoThreads();
    const heardByA: Page[] = [];
    const heardByB: Page[] = [];
    a.on('page', (p) => heardByA.push(p));
    b.on('page', (p) => heardByB.push(p));
    const mine = await a.newPage();
    expect(heardByA).toEqual([mine]);
    expect(heardByB).toEqual([]);
  });

  it('include a page one of its pages opened', async () => {
    const { fake, a, b } = twoThreads();
    const heardByA: Page[] = [];
    a.on('page', (p) => heardByA.push(p));
    const mine = await a.newPage();
    const popup = fake.popup(asFake(mine));
    await settle();
    expect(a.pages().map((p) => asFake(p).name)).toEqual([asFake(mine).name, popup.name]);
    expect(heardByA.map((p) => asFake(p).name)).toEqual([asFake(mine).name, popup.name]);
    expect(b.pages()).toEqual([]);
  });

  it('stop being announced once the thread stops listening', async () => {
    const { a } = twoThreads();
    const heard: Page[] = [];
    const listen = (p: Page) => heard.push(p);
    a.on('page', listen);
    a.off('page', listen);
    await a.newPage();
    expect(heard).toEqual([]);
  });
});

describe('closing', () => {
  it('a thread\'s view closes its pages and leaves the browser and the other threads open', async () => {
    const { fake, a, b } = twoThreads();
    const mine = await a.newPage();
    const theirs = await b.newPage();
    await a.close();
    expect(asFake(mine).closed).toBe(true);
    expect(asFake(theirs).closed).toBe(false);
    expect(fake.closedWhole).toBe(false);
  });

  it('a thread from outside does the same', async () => {
    const { views, a, b } = twoThreads();
    await a.newPage();
    await a.newPage();
    const theirs = await b.newPage();
    expect(views.threads()).toEqual(['thread-a', 'thread-b']);
    await views.closeThread('thread-a');
    expect(a.pages()).toEqual([]);
    expect(b.pages()).toEqual([theirs]);
    expect(views.threads()).toEqual(['thread-b']);
  });
});

describe('everything else', () => {
  it('is the browser\'s own, so a sign-in is the same for every thread', async () => {
    const { a, b } = twoThreads();
    expect(await a.cookies()).toEqual([{ name: 'session' }]);
    expect(await b.cookies()).toEqual([{ name: 'session' }]);
  });

  it('hears the browser close', async () => {
    const { fake, a } = twoThreads();
    let closed = 0;
    a.once('close', () => { closed += 1; });
    fake.emit('close');
    expect(closed).toBe(1);
  });
});
