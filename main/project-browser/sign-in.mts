// THE WINDOW THE OWNER SIGNS IN THROUGH.
//
// The same Chrome for Testing on the same profile as the hidden browser, with a
// window and with nothing driving it: the owner types their own password and
// passes their own second step, and what the sites store stays in the profile
// for the project's agents. The cookie store's key flags are the ones
// Playwright starts the hidden browser with, or the hidden browser could not
// read what was stored here.
//
// On a Mac, closing the last window leaves the app running with the profile
// held, so the browser is asked over its own pipe which pages are open and is
// closed when none is left. Nothing listens on a port.
import { spawn as spawnProcess, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';

export interface SignInWindow {
  /** Settles when the browser has exited, however it was closed. */
  closed: Promise<void>;
  /** Asks the browser to close. It is stopped if it has not gone `giveUpMs` later. */
  close(): void;
}

interface PipeMessage {
  method?: string;
  params?: { targetInfo?: { targetId?: string; type?: string }; targetId?: string };
}

export const COOKIE_STORE_FLAGS = ['--password-store=basic', '--use-mock-keychain'];

export function signInArgs(profile: string, urls: readonly string[]): string[] {
  return [
    `--user-data-dir=${profile}`,
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
    ...COOKIE_STORE_FLAGS,
    ...urls,
  ];
}

export function openSignIn({ chrome, profile, urls, extraArgs = [], spawn = spawnProcess, emptyForMs = 600, giveUpMs = 8_000 }: {
  chrome: string;
  profile: string;
  /** The pages it opens on: the project's sites. */
  urls: readonly string[];
  /** For a test, which starts it with no window. */
  extraArgs?: string[];
  spawn?: typeof spawnProcess;
  emptyForMs?: number;
  giveUpMs?: number;
}): SignInWindow {
  const child: ChildProcess = spawn(chrome, [...signInArgs(profile, urls), ...extraArgs], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const toBrowser = child.stdio[3] as Writable;
  const fromBrowser = child.stdio[4] as Readable;
  let nextId = 0;
  const send = (method: string, params: object = {}) => {
    if (child.exitCode !== null || toBrowser.destroyed) return;
    toBrowser.write(`${JSON.stringify({ id: nextId += 1, method, params })}\0`);
  };
  toBrowser.on('error', () => {});

  const pages = new Set<string>();
  let hadPage = false;
  let empty: NodeJS.Timeout | null = null;
  let stop: NodeJS.Timeout | null = null;
  const close = () => {
    send('Browser.close');
    stop ??= setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* gone */ } }, giveUpMs);
  };
  const note = (m: PipeMessage) => {
    const info = m.params?.targetInfo;
    if (m.method === 'Target.targetCreated' && info?.type === 'page' && info.targetId) { pages.add(info.targetId); hadPage = true; }
    if (m.method === 'Target.targetDestroyed' && m.params?.targetId) pages.delete(m.params.targetId);
    if (empty) { clearTimeout(empty); empty = null; }
    // A window closing as another opens passes through none for a moment.
    if (hadPage && !pages.size) empty = setTimeout(close, emptyForMs);
  };
  let buf = '';
  fromBrowser.setEncoding('utf8');
  fromBrowser.on('data', (d: string) => {
    buf += d;
    for (let at; (at = buf.indexOf('\0')) >= 0;) {
      const one = buf.slice(0, at);
      buf = buf.slice(at + 1);
      try { note(JSON.parse(one)); } catch { /* not a message */ }
    }
  });
  fromBrowser.on('error', () => {});
  send('Target.setDiscoverTargets', { discover: true });

  const closed = new Promise<void>((resolve) => {
    const done = () => {
      if (empty) clearTimeout(empty);
      if (stop) clearTimeout(stop);
      resolve();
    };
    child.once('exit', done);
    child.once('error', done);
  });
  return { closed, close };
}
