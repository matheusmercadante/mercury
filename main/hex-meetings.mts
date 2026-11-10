// THE ONE FILE THAT KNOWS HEX. Hex (anoma.ly/hex) records both sides of a call
// on this Mac and transcribes them locally, under its own signature, so macOS
// asks for the call's audio in Hex's name. Its command line is a contract it
// publishes for scripts (docs/cli.md and docs/transcript-cli.md in its
// repository); a different recorder would be a change to this file alone.
import { execFile, spawn as spawnChild } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BINARY = 'Hex.app/Contents/MacOS/hex';
// Its command line gives the app 15 s to answer, and `hex start` waits 20 s.
const ANSWER_MS = 20_000;
const START_MS = 30_000;
const LONGEST_REPLY = 32 * 1024 * 1024;
const READ_VERSION = 1;
// Finds the language by itself, so a recording needs no setting to go with it.
const SERVICE_MODEL = 'parakeet_v3';
const SERVICE_READY_MS = 60_000;
// Long enough to download the model the first time.
const SERVICE_PREPARE_MS = 15 * 60_000;
const SERVICE_CLIP_MS = 120_000;
// The service's own grace after its stdin ends is five seconds.
const SERVICE_QUIT_MS = 6_000;

export const HEX_SITE = 'https://anoma.ly/hex/';

// WHAT HEX PRINTS WITH --json, as far as this app reads it: each command fills
// its own fields and leaves the rest out.
export interface HexModel { id: string; name: string; size: string; selected?: boolean; languages?: string[] }
export interface HexBody {
  status?: string;
  code?: string;
  message?: string;
  version?: number;
  meeting?: { state?: string; elapsed_seconds?: number; title?: string | null } | null;
  model?: { id?: string; preparing?: boolean; downloaded_bytes?: number; error?: string } | null;
  models?: HexModel[];
  entries?: unknown[];
  meetings?: unknown[];
  features?: { meetings?: boolean };
}

type HexFailed = { ok: false; code: string; message: string; body: HexBody | null };
export type HexReply = { ok: true; code: null; message: null; body: HexBody } | HexFailed;
/** The transcript as Markdown, which is text and not JSON. */
export type HexText = { ok: true; code: null; message: null; body: string } | HexFailed;

type Run = (bin: string, args: string[], options: { timeout: number; maxBuffer: number }, done: (err: (Error & { code?: unknown; killed?: boolean }) | null, stdout: string, stderr: string) => void) => unknown;

export function findHex({ home = os.homedir(), exists = fs.existsSync }: { home?: string; exists?: (file: string) => boolean } = {}): string | null {
  return [path.join('/Applications', BINARY), path.join(home, 'Applications', BINARY)].find((file) => exists(file)) ?? null;
}

function parsed(text: string): HexBody | null {
  try { return JSON.parse(text) as HexBody | null; } catch { return null; }
}

export function hexCli(bin: string, { run = execFile as unknown as Run }: { run?: Run } = {}) {
  const raw = (args: string[], timeout = ANSWER_MS) => new Promise<{ err: (Error & { killed?: boolean }) | null; out: string; said: string }>((resolve) => {
    run(bin, args, { timeout, maxBuffer: LONGEST_REPLY }, (err, out, said) => resolve({ err, out: String(out ?? ''), said: String(said ?? '') }));
  });

  const refused = (err: { killed?: boolean } | null, said: string, body: HexBody | null): HexFailed => {
    if (err?.killed) return { ok: false, code: 'timeout', message: 'Hex did not answer in time.', body: null };
    return { ok: false, code: body?.code ?? 'failed', message: body?.message ?? (said.trim() || 'Hex did not answer.'), body };
  };

  const answer = async (args: string[], timeout?: number): Promise<HexReply> => {
    const { err, out, said } = await raw([...args, '--json'], timeout);
    const body = parsed(out) ?? parsed(said);
    if (err || body?.status === 'error' || !body) return refused(err, said, body);
    return { ok: true, code: null, message: null, body };
  };

  // The read commands carry their own version, and a new one may mean a new shape.
  const reading = async (args: string[]): Promise<HexReply> => {
    const reply = await answer(args);
    if (reply.ok && reply.body.version !== READ_VERSION) {
      return { ok: false, code: 'version', message: `This Hex writes meetings in version ${reply.body.version}, and this app reads version ${READ_VERSION}.`, body: null };
    }
    return reply;
  };

  return {
    status: () => answer(['status']),
    start: () => answer(['start'], START_MS),
    record: (title?: string) => answer(['meetings', 'record', ...(title ? ['--title', title] : [])]),
    stop: () => answer(['meetings', 'stop']),
    enable: () => answer(['settings', 'set', 'meetings.enabled', 'on']),
    models: () => answer(['model', 'list']),
    install: (model: string) => answer(['model', 'install', model]),
    open: () => answer(['window', 'show', 'meetings']),
    list: (since: number) => reading(['meetings', 'list', '--since', String(since), '--limit', '200']),
    show: (id: string) => reading(['meetings', 'show', id]),
    markdown: async (id: string): Promise<HexText> => {
      const { err, out, said } = await raw(['meetings', 'show', id, '--md']);
      return err ? refused(err, said, null) : { ok: true, code: null, message: null, body: out };
    },
  };
}

export type HexCli = ReturnType<typeof hexCli>;

export interface HexService {
  transcribe(wav: Buffer): Promise<string>;
  close(): void;
}

type ServiceChild = {
  stdout: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
  once(event: 'exit' | 'error', fn: (...args: unknown[]) => void): unknown;
  kill(signal?: NodeJS.Signals): unknown;
};
type Spawn = (bin: string, args: string[], options: { stdio: ['pipe', 'pipe', 'ignore'] }) => ServiceChild;

function readyLine(child: ServiceChild): Promise<{ url: string; token: string }> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const fail = (why: string) => { clearTimeout(timer); reject(new Error(`Hex's transcription service did not start: ${why}`)); };
    const timer = setTimeout(() => fail('it never said it was ready'), SERVICE_READY_MS);
    child.once('exit', () => fail('it stopped'));
    child.once('error', (err) => fail(String((err as Error)?.message ?? err)));
    child.stdout.on('data', (bit: Buffer) => {
      buffer += bit;
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      clearTimeout(timer);
      try { resolve(JSON.parse(buffer.slice(0, end))); } catch { reject(new Error("Hex's transcription service did not start: its first line was not readable")); }
    });
  });
}

/**
 * Hex without its window, as a child of this app: it reads audio and writes
 * words, and needs no permission, because it never touches the microphone
 * (docs/specs/local-transcription-service.md in its repository).
 */
export async function hexService(bin: string, { spawn = spawnChild as unknown as Spawn, fetchImpl = fetch }: { spawn?: Spawn; fetchImpl?: typeof fetch } = {}): Promise<HexService> {
  const child = spawn(bin, ['service', '--embedded'], { stdio: ['pipe', 'pipe', 'ignore'] });
  let ended = false;
  const close = () => {
    if (ended) return;
    ended = true;
    child.stdin.end();
    setTimeout(() => child.kill('SIGKILL'), SERVICE_QUIT_MS).unref?.();
  };
  let ready: { url: string; token: string };
  try { ready = await readyLine(child); } catch (err) { ended = true; child.kill('SIGKILL'); throw err; }
  const headers = { Authorization: `Bearer ${ready.token}` };
  try {
    const prepared = await fetchImpl(`${ready.url}/models/${SERVICE_MODEL}/prepare`, { method: 'POST', headers, signal: AbortSignal.timeout(SERVICE_PREPARE_MS) });
    const last = JSON.parse((await prepared.text()).trim().split('\n').filter((l) => l.startsWith('data:')).at(-1)?.slice(5) || '{}');
    if (!prepared.ok || last.type !== 'ok') throw new Error(last.message || last.error || `Hex could not get its speech model ready (${prepared.status})`);
  } catch (err) { close(); throw err; }
  return {
    close,
    async transcribe(wav) {
      const res = await fetchImpl(`${ready.url}/transcriptions?model=${SERVICE_MODEL}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'audio/wav' }, body: new Uint8Array(wav), signal: AbortSignal.timeout(SERVICE_CLIP_MS),
      });
      const body = await res.json().catch(() => null) as { message?: string; error?: string; transcript?: string } | null;
      if (!res.ok) throw new Error(body?.message || body?.error || `Hex could not transcribe a piece of the recording (${res.status})`);
      return String(body?.transcript ?? '');
    },
  };
}
