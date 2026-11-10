// A MEETING RECORDED ON THIS MAC BECOMES A THREAD. Hex records and transcribes
// (main/hex-meetings.mts); this file presses its buttons, watches it, and, when a
// meeting ends, files the transcript as a document of the project and starts a
// thread on it, whether the recording began here or from Hex's own offer.
//
// Hex's advice to a companion app (docs/streams.md) is the shape of `catchUp`: its
// meetings folder is the record, a meeting counts once it reads complete with a
// final transcript, the cursor stays before anything unfinished, and the same
// meeting can be listed twice, so what was handled is kept by id.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA_VERSION } from '../shared/contracts.mts';
import { recoveryProduct } from './connections/start.mts';
import type { HexBody, HexCli, HexReply } from './hex-meetings.mts';
import type { Heard } from './meeting-audio.mts';
import { atomicWriteJson, readIndex, readJson, saveCreation } from './store/project.mts';
import { runForProject } from './store/queues.mts';
import type { SupervisorStore } from './supervisor.mts';

// Parakeet first: it finds the language by itself, so a meeting can change
// language halfway, and it is the faster of the two for Hex's dictation as well.
const MEETING_MODELS = ['parakeet_v3', 'whisper_large_v3_turbo'];
const LOOK_IDLE_MS = 15_000;
const LOOK_BUSY_MS = 3_000;
const TRIES = 3;
// About five minutes of looks: long enough for Hex to finish updating itself.
const LIST_REFUSALS = 20;
const KEPT_RECEIPTS = 200;
const CLOCK_SLACK_MS = 2_000;

export interface MeetingView {
  hex: boolean;
  phase: 'idle' | 'starting' | 'recording' | 'transcribing';
  title: string | null;
  startedAt: number | null;
  product: string | null;
  problem: string | null;
  model: { from: string; to: string; size: string } | null;
  preparing: number | null;
}

interface Listed {
  id: string;
  title: string;
  timestamp_ms: number;
  duration_ms: number;
  application: string | null;
  status: string;
  transcript_source: string;
  warnings?: string[];
}

interface Kept {
  since?: number;
  /** The project of the last press, which a meeting takes the first time it is seen. */
  product?: string;
  where?: Record<string, string>;
  done?: Record<string, number>;
  tries?: Record<string, number>;
}

interface MeetingStore extends Pick<SupervisorStore, 'listProducts'> {
  productDir(slug: string): string;
  composeItem(slug: string, input: { title: string; body: string; visibility: string; fromPhone?: string }): unknown;
  fileItem(slug: string, row: { title: string; body: string; problem?: string }): unknown;
}

export interface TranscriptDoc { title: string; path: string; content: string }

const two = (n: number) => String(n).padStart(2, '0');

function slugOf(title: string): string {
  const slug = title.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '');
  return slug || 'meeting';
}

function transcriptPath(m: Listed): string {
  const d = new Date(m.timestamp_ms);
  return `transcripts/${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}-${slugOf(m.title)}.md`;
}

const WRITE_THE_NOTES = 'Read all of it, then write the notes: what it was about, what was decided, who will do what, and what is still open. Keep names, numbers and dates as they were said.';
const FILE_THE_TASKS = 'File each task that came out of it for me as its own proposal under this thread, written so it can start cold, so I can approve the ones I want. Leave out what other people said they would do.';
const ITS_LANGUAGE = 'Answer in the language of the meeting.';

function threadBody(m: Listed, doc: TranscriptDoc): string {
  const minutes = Math.max(1, Math.round(m.duration_ms / 60_000));
  const facts = [`${minutes} min`, m.application].filter(Boolean).join(', ');
  return [
    `I recorded a meeting: [${doc.title}](${doc.path}) (${facts}).`,
    `${WRITE_THE_NOTES} The transcript comes from speech recognition, so say where it is unclear instead of guessing. "You" is me; "Them" is everyone else on the call, and it does not tell them apart.`,
    FILE_THE_TASKS,
    ITS_LANGUAGE,
  ].join('\n\n');
}

const AUDIO_LINK = /\[[^\]\n]*\]\((attachments\/[^)\s]+\.(?:m4a|mp4|aac|caf|wav|mp3))\)/gi;

const clockOf = (ms: number) => `${two(Math.floor(ms / 60_000))}:${two(Math.floor(ms / 1000) % 60)}`;

function phoneTranscript(title: string, recordedAt: number, heard: Heard): string {
  const d = new Date(recordedAt);
  return [
    `# ${title}`,
    `- Recorded: ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}\n- Duration: ${clockOf(heard.durationMs)}\n- Source: phone microphone`,
    '## Transcript',
    ...heard.pieces.map((p) => `**${clockOf(p.atMs)}**\n${p.text}`),
  ].join('\n\n');
}

function phoneThreadBody(doc: TranscriptDoc, heard: Heard, note: string, audio: string[]): string {
  const minutes = Math.max(1, Math.round(heard.durationMs / 60_000));
  return [
    `I recorded a meeting on my phone: [${doc.title}](${doc.path}) (${minutes} min). The audio is ${audio.join(', ')}.`,
    ...(note ? [`My note: ${note}`] : []),
    `${WRITE_THE_NOTES} It comes from one phone's microphone in the room through speech recognition and does not tell people apart, so say where it is unclear instead of guessing.`,
    FILE_THE_TASKS,
    ITS_LANGUAGE,
  ].join('\n\n');
}

/** Into the product's catalog, the way a document an agent writes gets there. */
export function saveTranscriptIn(productDir: (slug: string) => string) {
  return (slug: string, doc: TranscriptDoc) => runForProject(slug, async () => {
    const dir = productDir(slug);
    const at = Date.now();
    // A try that died before its thread was made comes back with the same path.
    const had = readIndex(dir).creations?.find((c: { path?: string }) => c.path === doc.path);
    saveCreation(dir, {
      id: had?.id ?? `a-${crypto.randomBytes(4).toString('hex')}`, kind: 'transcript', title: doc.title, path: doc.path,
      ts: had?.ts ?? at, updatedAt: new Date(at).toISOString(), schemaVersion: SCHEMA_VERSION,
    }, doc.content);
  });
}

export function createMeetings({ locate, store, saveTranscript, wake, stateFile, languages, now = Date.now, onChange = () => {}, transcribe }: {
  locate: () => HexCli | null;
  store: MeetingStore;
  saveTranscript: (slug: string, doc: TranscriptDoc) => Promise<unknown>;
  wake: () => void;
  /** Words from a recording the phone made (main/meeting-audio.mts). */
  transcribe?: (files: string[]) => Promise<Heard>;
  stateFile: string;
  /** The languages this Mac reads, as Hex names them: `en`, `pt`. */
  languages: readonly string[];
  now?: () => number;
  onChange?: () => void;
}) {
  let kept: Kept = readKept();
  let view: MeetingView = { hex: true, phase: 'idle', title: null, startedAt: null, product: kept.product ?? null, problem: null, model: null, preparing: null };
  let shown = JSON.stringify(view);
  let offered: string | null = null;
  let switching: string | null = null;
  let looking: Promise<void> | null = null;
  let refusals = 0;

  function readKept(): Kept {
    if (!fs.existsSync(stateFile)) {
      const first = { since: now() };
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      atomicWriteJson(stateFile, first);
      return first;
    }
    return readJson(stateFile) ?? { since: now() };
  }

  const keep = (patch: Kept) => {
    kept = { ...kept, ...patch };
    atomicWriteJson(stateFile, kept);
  };

  const set = (patch: Partial<MeetingView>) => {
    view = { ...view, ...patch };
    const next = JSON.stringify(view);
    if (next === shown) return;
    shown = next;
    onChange();
  };

  const say = (reply: HexReply) => set({ problem: reply.message ?? 'Hex did not answer.' });

  function readStatus(body: HexBody) {
    const elapsed = body.meeting?.elapsed_seconds;
    const state = body.meeting?.state;
    const active = state === 'starting' || state === 'recording' || state === 'transcribing';
    const preparing = body.model?.preparing ? Math.round(Number(body.model.downloaded_bytes ?? 0) / 1_000_000) : null;
    const began = active && typeof elapsed === 'number' && Number.isFinite(elapsed) ? now() - elapsed * 1000 : null;
    // Hex counts whole seconds, so each look lands a little off, and a moved
    // start would refetch the whole snapshot for a clock the screen ticks itself.
    const same = began != null && view.startedAt != null && Math.abs(began - view.startedAt) < CLOCK_SLACK_MS;
    set({
      phase: active ? state : 'idle',
      title: active ? body.meeting?.title ?? null : null,
      startedAt: same ? view.startedAt : began,
      preparing,
    });
    // The install answers at once; how its download ended is only ever on the status.
    if (switching && body.model?.error) {
      switching = null;
      set({ problem: body.model.error });
    } else if (body.model?.id === switching && !preparing) switching = null;
  }

  const gone = () => set({ phase: 'idle', title: null, startedAt: null, preparing: null });

  async function look(hex: HexCli) {
    const status = await hex.status();
    if (status.ok) readStatus(status.body);
    else if (status.code === 'not-running') gone();
  }

  const hears = (model: { languages?: string[] }) => {
    const heard = model.languages ?? [];
    return heard.includes('*') || languages.every((l) => heard.includes(l));
  };

  /** The model to offer when the selected one cannot hear this Mac's languages. */
  async function betterModel(hex: HexCli) {
    const reply = await hex.models();
    if (!reply.ok) return null;
    const models: { id: string; name: string; size: string; selected?: boolean; languages?: string[] }[] = reply.body.models ?? [];
    const selected = models.find((m) => m.selected);
    if (!selected || hears(selected)) return null;
    const better = MEETING_MODELS.map((id) => models.find((m) => m.id === id)).find((m) => m && hears(m));
    return better ? { selected, better } : null;
  }

  async function take(hex: HexCli, m: Listed, slug: string) {
    const [show, markdown] = await Promise.all([hex.show(m.id), hex.markdown(m.id)]);
    if (!show.ok) throw new Error(show.message ?? 'Hex could not show the meeting');
    if (!markdown.ok) throw new Error(markdown.message ?? 'Hex could not show the transcript');
    if (!show.body.entries?.length) {
      store.fileItem(slug, {
        title: `${m.title} has no transcript`,
        body: 'Hex recorded this meeting but heard no words in it. If people did speak, check that Hex is allowed under System Settings › Privacy & Security › Screen & System Audio Recording, and that the right microphone is selected in Hex.',
      });
      return;
    }
    const doc = { title: m.title, path: transcriptPath(m), content: markdown.body };
    await saveTranscript(slug, doc);
    store.composeItem(slug, { title: m.title, body: threadBody(m, doc), visibility: 'private' });
    wake();
  }

  async function catchUp(hex: HexCli) {
    const since = kept.since ?? now();
    const listed = await hex.list(since);
    if (!listed.ok) {
      refusals += 1;
      const slug = refusals === LIST_REFUSALS ? recoveryProduct(store, kept.product ?? null) : null;
      if (slug) store.fileItem(slug, { title: 'Meetings have stopped arriving from Hex', body: `Hex will not list its meetings: ${listed.message} New recordings stay in Hex's Meetings until this is fixed.` });
      return;
    }
    refusals = 0;
    const done = { ...kept.done };
    const tries = { ...kept.tries };
    const where = { ...kept.where };
    let cursor = since;
    let held = Infinity;
    // Written at once: dying before this line files the meeting a second time.
    const finish = (m: Listed) => {
      done[m.id] = m.timestamp_ms;
      delete tries[m.id];
      delete where[m.id];
      cursor = Math.max(cursor, m.timestamp_ms + m.duration_ms);
      keep({ done, tries, where });
    };

    for (const m of [...(listed.body.meetings as Listed[])].sort((a, b) => a.timestamp_ms - b.timestamp_ms)) {
      if (done[m.id]) continue;
      // Seen first while it records, so a press for another project cannot move it.
      if (kept.product) where[m.id] ??= kept.product;
      const slug = recoveryProduct(store, where[m.id]);
      if (m.status === 'failed') {
        if (slug) store.fileItem(slug, { title: `${m.title} could not be transcribed`, body: `Hex stopped on this meeting. ${(m.warnings ?? []).join(' ')} Its recording may still be in Hex's Meetings.`.trim() });
        finish(m);
        continue;
      }
      if (m.status !== 'complete' || m.transcript_source !== 'final' || !slug) {
        held = Math.min(held, m.timestamp_ms);
        continue;
      }
      try {
        await take(hex, m, slug);
        finish(m);
      } catch (err) {
        tries[m.id] = (tries[m.id] ?? 0) + 1;
        if (tries[m.id] < TRIES) {
          held = Math.min(held, m.timestamp_ms);
          continue;
        }
        store.fileItem(slug, { title: `${m.title} could not be saved`, body: `The transcript could not be filed after ${TRIES} tries: ${(err as Error).message}. It is still in Hex's Meetings.` });
        finish(m);
      }
    }

    const newest = Object.entries(done).sort((a, b) => b[1] - a[1]).slice(0, KEPT_RECEIPTS);
    keep({ since: Math.min(cursor, held), done: Object.fromEntries(newest), tries, where });
  }

  const lookOnce = async () => {
    const hex = locate();
    set({ hex: !!hex });
    if (!hex) return gone();
    await look(hex);
    await catchUp(hex);
  };

  const nextLookMs = () => (view.phase === 'idle' && view.preparing == null ? LOOK_IDLE_MS : LOOK_BUSY_MS);

  const me = {
    view: () => view,

    /** One look at a time: a press and the timer can both ask. */
    tick() {
      looking ??= lookOnce().finally(() => { looking = null; });
      return looking;
    },

    nextLookMs,

    /** Looks for as long as the app runs, without holding it open; a look that fails is said and the next one still comes. */
    watch() {
      const again = () => { setTimeout(() => { void once(); }, nextLookMs()).unref?.(); };
      const once = () => me.tick().catch((err: Error) => console.warn('zero: could not look at the meetings:', err?.message ?? err)).finally(again);
      void once();
    },

    async record({ product, title }: { product: string; title?: string }) {
      set({ problem: null, model: null });
      offered = null;
      const hex = locate();
      set({ hex: !!hex });
      if (!hex) return set({ problem: 'Meetings are recorded by Hex, which is not installed here.' });

      let status = await hex.status();
      if (!status.ok && status.code === 'not-running') {
        const started = await hex.start();
        if (!started.ok) return say(started);
        status = await hex.status();
      }
      if (!status.ok) return say(status);
      if (!status.body.features?.meetings) {
        const on = await hex.enable();
        if (!on.ok) return say(on);
      }

      const offer = await betterModel(hex);
      if (offer) {
        offered = offer.better.id;
        return set({ model: { from: offer.selected.name, to: offer.better.name, size: offer.better.size } });
      }

      keep({ product });
      set({ product });
      const recording = await hex.record(title);
      if (!recording.ok) return say(recording);
      await look(hex);
    },

    async stop() {
      const hex = locate();
      if (!hex) return;
      const stopped = await hex.stop();
      if (!stopped.ok) return say(stopped);
      await look(hex);
    },

    /** Hex's model is its dictation's too, so this runs only on the press that says so. */
    async useModel() {
      const hex = locate();
      if (!hex || !offered) return;
      const installing = await hex.install(offered);
      if (!installing.ok) return say(installing);
      switching = offered;
      offered = null;
      set({ model: null });
      await look(hex);
    },

    async openHex() {
      const hex = locate();
      if (!hex) return;
      const opened = await hex.open();
      if (!opened.ok) say(opened);
    },

    dismiss() {
      offered = null;
      set({ problem: null, model: null });
    },

    /**
     * A recording the phone sent, already in the project's attachments. It ends
     * as a Hex meeting does. What fails is said to the phone by the throw and
     * kept in Needs you with the audio, so an hour of talk is never only a refusal.
     */
    async takeRecording({ product, title, body, fromPhone, recordedAt, choices }: { product: string; title: string; body: string; fromPhone?: string; recordedAt: number; choices?: Record<string, unknown> }) {
      const links = [...String(body ?? '').matchAll(AUDIO_LINK)];
      if (!links.length) throw new Error('The recording did not arrive with its message.');
      const audio = links.map((l) => l[0]);
      const note = String(body).replace(AUDIO_LINK, '').trim();
      const keepIt = (why: string): never => {
        store.fileItem(product, { title: `${title} could not be transcribed`, body: `${why}\n\nThe recording is kept: ${audio.join(', ')}` });
        throw new Error(why);
      };

      let heard: Heard | undefined;
      try {
        if (!transcribe) throw new Error('This computer cannot transcribe recordings.');
        heard = await transcribe(links.map((l) => path.join(store.productDir(product), l[1])));
      } catch (err) {
        keepIt(String((err as Error)?.message ?? err));
      }
      if (!heard?.pieces.length) return keepIt('No words were heard in this recording.');

      const doc = { title, path: transcriptPath({ timestamp_ms: recordedAt, title } as Listed), content: phoneTranscript(title, recordedAt, heard) };
      await saveTranscript(product, doc);
      const made = store.composeItem(product, { ...choices, title, body: phoneThreadBody(doc, heard, note, audio), visibility: 'private', ...(fromPhone ? { fromPhone } : {}) });
      wake();
      return made;
    },
  };
  return me;
}

export type Meetings = ReturnType<typeof createMeetings>;
