// ONE BROWSER, AND EACH THREAD SEES ONLY THE PAGES IT OPENED.
//
// A project's threads share one browser so they share its sign-ins, and a saved
// profile serves one browser at a time. Playwright MCP takes every page of the
// browser it is handed as its own tab and makes the first one current, so two
// threads on the browser itself would drive each other's pages. Each thread is
// handed this view instead: the browser, with the pages narrowed to its own.
import type { BrowserContext, Page } from 'playwright-core';

type PageListener = (page: Page) => void;

export interface ThreadViews {
  /** The browser as one thread sees it. The same thread is always handed the same pages. */
  viewFor(thread: string): BrowserContext;
  /** Closes a thread's pages. The browser and the other threads' pages stay. */
  closeThread(thread: string): Promise<void>;
  /** The threads with a page open. */
  threads(): string[];
}

/** `prepare` is run on each page a thread gets, before the thread hears of it. */
export function threadViews(context: BrowserContext, { prepare = () => {} }: { prepare?: (page: Page, thread: string) => Promise<void> | void } = {}): ThreadViews {
  const owner = new WeakMap<Page, string>();
  const listeners = new Map<string, Set<PageListener>>();
  const heardBy = (thread: string): Set<PageListener> => listeners.get(thread) ?? listeners.set(thread, new Set()).get(thread)!;
  const pagesOf = (thread: string): Page[] => context.pages().filter((page) => owner.get(page) === thread);
  const give = async (page: Page, thread: string): Promise<void> => {
    owner.set(page, thread);
    try { await prepare(page, thread); } catch { /* the page is still the thread's */ }
    for (const hear of [...heardBy(thread)]) hear(page);
  };

  // A page a site opened itself (a link with a new-tab target) belongs to the
  // thread whose page opened it. A page with no opener is one a thread asked
  // for, which `newPage` below hands to it.
  context.on('page', (page) => {
    page.opener().then((from) => {
      const thread = from ? owner.get(from) : undefined;
      if (thread && !owner.has(page)) return give(page, thread);
    }, () => {});
  });

  const closeThread = async (thread: string): Promise<void> => {
    await Promise.all(pagesOf(thread).map((page) => page.close().catch(() => {})));
    listeners.delete(thread);
  };

  function viewFor(thread: string): BrowserContext {
    const mine: Record<string, unknown> = {
      pages: () => pagesOf(thread),
      // Announced here, before the page is handed back: Playwright MCP looks
      // the new page up among its tabs on the very next line.
      newPage: async () => {
        const page = await context.newPage();
        await give(page, thread);
        return page;
      },
      close: () => closeThread(thread),
    };
    for (const name of ['on', 'addListener'] as const) {
      mine[name] = (event: string, listener: PageListener) => {
        if (event === 'page') heardBy(thread).add(listener);
        else context.on(event as 'close', listener as unknown as () => void);
        return view;
      };
    }
    for (const name of ['off', 'removeListener'] as const) {
      mine[name] = (event: string, listener: PageListener) => {
        if (event === 'page') heardBy(thread).delete(listener);
        else context.off(event as 'close', listener as unknown as () => void);
        return view;
      };
    }
    const view: BrowserContext = new Proxy(context, {
      get(target, prop) {
        if (typeof prop === 'string' && Object.hasOwn(mine, prop)) return mine[prop];
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return view;
  }

  return {
    viewFor,
    closeThread,
    threads: () => [...new Set(context.pages().map((page) => owner.get(page)).filter((thread): thread is string => !!thread))],
  };
}
