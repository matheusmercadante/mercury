// THE ONE FILE THAT KNOWS HEX. Hex (anoma.ly/hex) records both sides of a call
// on this Mac and transcribes them locally, under its own signature, so macOS
// asks for the call's audio in Hex's name. Its command line is a contract it
// publishes for scripts (docs/cli.md and docs/transcript-cli.md in its
// repository); a different recorder would be a change to this file alone.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BINARY = 'Hex.app/Contents/MacOS/hex';
// Its command line gives the app 15 s to answer, and `hex start` waits 20 s.
const ANSWER_MS = 20_000;
const START_MS = 30_000;
const LONGEST_REPLY = 32 * 1024 * 1024;
const READ_VERSION = 1;

export const HEX_SITE = 'https://anoma.ly/hex/';

export interface HexReply {
  ok: boolean;
  code: string | null;
  message: string | null;
  body: any;
}

type Run = (bin: string, args: string[], options: { timeout: number; maxBuffer: number }, done: (err: (Error & { code?: unknown; killed?: boolean }) | null, stdout: string, stderr: string) => void) => unknown;

export function findHex({ home = os.homedir(), exists = fs.existsSync }: { home?: string; exists?: (file: string) => boolean } = {}): string | null {
  return [path.join('/Applications', BINARY), path.join(home, 'Applications', BINARY)].find((file) => exists(file)) ?? null;
}

function parsed(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

export function hexCli(bin: string, { run = execFile as unknown as Run }: { run?: Run } = {}) {
  const raw = (args: string[], timeout = ANSWER_MS) => new Promise<{ err: (Error & { killed?: boolean }) | null; out: string; said: string }>((resolve) => {
    run(bin, args, { timeout, maxBuffer: LONGEST_REPLY }, (err, out, said) => resolve({ err, out: String(out ?? ''), said: String(said ?? '') }));
  });

  const refused = (err: { killed?: boolean } | null, said: string, body: any): HexReply => {
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
    markdown: async (id: string): Promise<HexReply> => {
      const { err, out, said } = await raw(['meetings', 'show', id, '--md']);
      return err ? refused(err, said, null) : { ok: true, code: null, message: null, body: out };
    },
  };
}

export type HexCli = ReturnType<typeof hexCli>;
