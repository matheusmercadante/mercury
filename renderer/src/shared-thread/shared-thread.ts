// A THREAD'S LINK ON THE WEB APP: /t/<owner>/<thread>. It opens for whoever
// can read the thread's card (the cloud's own rule on thread_work), and offers
// the app, where the thread opens in full.
import { threadAppLink } from '../../../shared/room-links.mts';

const PART = /^[\w-]{1,80}$/;

/** The owner and thread when this address is a thread's link on the web app; null anywhere else. */
export function sharedThreadOf(pathname: string, onTheWebApp: boolean): { owner: string; id: string } | null {
  if (!onTheWebApp) return null;
  const m = /^\/t\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  return m && PART.test(m[1]) && PART.test(m[2]) ? { owner: m[1], id: m[2] } : null;
}

export const openInApp = (owner: string, id: string) => threadAppLink(owner, id);

export interface SaidLine { key: string; by: string | null; agent: boolean; comment: boolean; text: string; at: number }
export type ThreadShown =
  | { state: 'shown'; title: string; owner: string; lines: SaidLine[]; names: Record<string, string> }
  | { state: 'hidden' };

// A row and a line as the cloud sends them, read without trusting their shape.
interface Row { work?: { lines?: unknown } | null; title?: unknown; id?: unknown; name?: unknown }
interface Line { uid?: unknown; ts?: unknown; by?: unknown; source?: unknown; patch?: { body?: unknown; answer?: unknown; result?: unknown; note?: unknown; comment?: { text?: unknown } | null } | null }
interface Select { select(table: string, query: string): Promise<object[]> }

/** What a line of the published work says, and whose it is; null for a line that says nothing. */
export function saidLine(l: unknown, i: number): SaidLine | null {
  const line: Line = l && typeof l === 'object' ? l : {};
  const p = line.patch ?? {};
  const text = [p.body, p.answer, p.result, p.note, p.comment?.text].find((t) => typeof t === 'string' && t.trim());
  if (!text) return null;
  const comment = !!p.comment?.text;
  const agent = !comment && line.source !== 'founder';
  return { key: String(line.uid ?? `${line.ts}-${i}`), by: typeof line.by === 'string' ? line.by : null, agent, comment, text: String(text), at: Number(line.ts) || 0 };
}

export async function readSharedThread(db: Select, owner: string, id: string): Promise<ThreadShown> {
  if (!PART.test(owner) || !PART.test(id)) return { state: 'hidden' };
  const at = `person_id=eq.${owner}&thread_id=eq.${id}`;
  const [work, card]: Row[][] = await Promise.all([
    db.select('thread_work', `${at}&select=work&limit=1`),
    db.select('thread_cards', `${at}&select=title&limit=1`),
  ]);
  if (!work[0] && !card[0]) return { state: 'hidden' };
  const said = work[0]?.work?.lines;
  const lines = (Array.isArray(said) ? said : []).map(saidLine).filter((l): l is SaidLine => l !== null);
  const ids = [...new Set([owner, ...lines.map((l) => l.by).filter((b): b is string => !!b && PART.test(b))])];
  const people: Row[] = await db.select('people', `id=in.(${ids.join(',')})&select=id,name`).catch(() => []);
  const names = Object.fromEntries(people.flatMap((p) => (typeof p?.id === 'string' && p.id ? [[p.id, String(p.name || '').trim() || 'A teammate']] : [])));
  return { state: 'shown', title: String(card[0]?.title || 'A thread'), owner, lines, names };
}

/** Who a line is from, as the page says it. */
export function whoSaid(line: SaidLine, owner: string, names: Record<string, string>): string {
  const first = (id: string | null) => (names[id ?? ''] || 'A teammate').split(/\s+/)[0];
  if (line.agent) return `${first(owner)}'s agent`;
  return first(line.comment ? line.by : (line.by ?? owner));
}
