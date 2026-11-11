// WHERE A PROJECT'S BROWSER KEEPS ITS THINGS, and how its host is reached.
//
// The profile (the sign-ins) sits in the app's own folder, one per project.
// The pages an agent is handed sit in the store, which every worker may
// already read. The host's socket sits in the temp folder under a short name,
// because a unix socket path is capped near 100 characters.
//
// Node's own modules only, plus shared/product-name.mjs which imports nothing:
// the worker's end (mcp/project-browser.mts) runs on the app's binary with no install.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { nameSlug } from '../../shared/product-name.mjs';

const safe = (slug: string): string => slug.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_') || '_';

/** One project's browser folder, under the app's own. */
export const browserDir = (userDir: string, slug: string): string => path.join(userDir, 'browsers', safe(slug));

export const profileDir = (dir: string): string => path.join(dir, 'profile');

/** Where the pages and pictures an agent is handed are written, inside the store. */
export const pagesDir = (storeRoot: string, slug: string): string => path.join(storeRoot, '.browser', safe(slug));

/**
 * The socket the app gives a project's host. Only the app works this out: a
 * worker's temp folder is not always the app's, so the host and the worker's
 * end are each told the path.
 */
export function socketPath(dir: string, { tmp = os.tmpdir(), uid = process.getuid?.() ?? 0 }: { tmp?: string; uid?: number } = {}): string {
  const name = crypto.createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 16);
  return path.join(tmp, `${nameSlug}-browser-${uid}-${name}.sock`);
}

/** What the app tells a project's host: which sites it opens and where pages go. */
export interface BrowserProject {
  slug: string;
  sites: string[];
  pages: string;
}

const projectFile = (dir: string): string => path.join(dir, 'project.json');

export function writeProject(dir: string, project: BrowserProject): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = projectFile(dir);
  fs.writeFileSync(`${file}.${process.pid}`, JSON.stringify(project), { mode: 0o600 });
  fs.renameSync(`${file}.${process.pid}`, file);
}

export function readProject(dir: string): BrowserProject | null {
  try {
    const kept = JSON.parse(fs.readFileSync(projectFile(dir), 'utf8'));
    if (typeof kept?.slug !== 'string' || typeof kept?.pages !== 'string' || !Array.isArray(kept?.sites)) return null;
    return { slug: kept.slug, pages: kept.pages, sites: kept.sites.filter((s: unknown): s is string => typeof s === 'string') };
  } catch { return null; }
}

const alive = (pid: unknown): boolean => {
  if (!Number.isInteger(pid) || (pid as number) <= 0) return false;
  try { process.kill(pid as number, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException)?.code === 'EPERM'; }
};

/** The host serving this folder, the app that started it and its socket, or null when none is running. */
export function readHost(dir: string): { pid: number; appPid: number; sock: string } | null {
  try {
    const at = JSON.parse(fs.readFileSync(path.join(dir, 'host.json'), 'utf8'));
    return alive(at?.pid) && typeof at.sock === 'string' ? { pid: at.pid, appPid: Number(at.appPid), sock: at.sock } : null;
  } catch { return null; }
}

export interface HostRequest {
  method: 'tools/list' | 'tools/call' | 'status' | 'sign-in' | 'sign-in-done' | 'stop';
  thread?: string;
  params?: { name?: unknown; arguments?: Record<string, unknown> };
}

/**
 * One question to a project's host, on its socket, and its answer, or null
 * when no host answered before the deadline. A connection per question: the
 * host keeps what a thread has open by the thread's name, not by its connection.
 */
export function askHost<T = unknown>(socket: string, request: HostRequest, { ms, signal }: { ms: number; signal?: AbortSignal }): Promise<T | null> {
  return new Promise((resolve) => {
    const sock = net.createConnection(socket);
    let buf = '';
    let done = false;
    const end = (answer: T | null) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      signal?.removeEventListener('abort', give);
      sock.destroy();
      resolve(answer);
    };
    const give = () => end(null);
    const deadline = setTimeout(give, ms);
    signal?.addEventListener('abort', give, { once: true });
    sock.setEncoding('utf8');
    sock.once('connect', () => { sock.write(`${JSON.stringify(request)}\n`); });
    sock.on('data', (d: string) => {
      buf += d;
      const at = buf.indexOf('\n');
      if (at < 0) return;
      try { end((JSON.parse(buf.slice(0, at)) as { result: T }).result ?? null); } catch { end(null); }
    });
    sock.on('error', give);
    sock.on('close', give);
  });
}
