// "Deveriamos ter como conseguir fazer essas gravacoes pelo celular tambem." The
// phone records, its audio goes up the way any attachment does, and the Mac ends
// it the way a Hex meeting ends: the transcript as a document of the project and
// a private thread that writes the notes and proposes the tasks. The command is
// the phone's ordinary "new thread", so nothing changes in the database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeetings } from '../main/meetings.mts';
import { hexService } from '../main/hex-meetings.mts';
import { linkPhoneFiles } from '../shared/phone-files.mts';
import { phoneChoices } from '../shared/phone-snapshot.mts';
import { commandFor } from '../renderer/src/phone-rows.ts';
import { REQUEST_CHANNELS } from '../shared/bridge-map.mts';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { applyThrough } from '../main/phone-inbox.mts';
import { registerIpc } from '../main/ipc.mts';
import { collectingIpcMain, broadcastingWindow, nodeHost } from '../main/serve.mts';
import { Store } from '../main/store.mts';
import { Supervisor } from '../main/supervisor.mts';

const AT = 1_794_143_000_000;
const heard = { durationMs: 1_500_000, pieces: [{ atMs: 0, text: 'Bom dia, vamos começar.' }, { atMs: 31_000, text: 'O João fecha o relatório.' }] };

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-meeting-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function setup({ transcribe = vi.fn(async () => heard) } = {}) {
  const store = {
    listProducts: () => [{ slug: 'work', name: 'Work' }],
    productDir: () => '/projects/work',
    composeItem: vi.fn((slug, input) => ({ id: 'w-new', product: slug, ...input })),
    fileItem: vi.fn(),
  };
  const save = vi.fn(async () => {});
  const wake = vi.fn();
  const m = createMeetings({
    locate: () => null, store, saveTranscript: save, wake, stateFile: path.join(dir, 'meetings.json'),
    languages: ['pt'], now: () => AT, transcribe,
  });
  return { m, store, save, wake, transcribe };
}
const body = '[meeting.m4a](attachments/aaaa-meeting.m4a)';
const take = (m, over = {}) => m.takeRecording({ product: 'work', title: 'Reunião com a Kruzer', body, fromPhone: 'cmd-1', recordedAt: AT, ...over });

describe('a recording from the phone', () => {
  it('is transcribed from the file it brought, in the project it was sent to', async () => {
    const s = setup();
    await take(s.m);
    expect(s.transcribe).toHaveBeenCalledWith(['/projects/work/attachments/aaaa-meeting.m4a']);
  });

  it('takes its parts in the order they were sent', async () => {
    const s = setup();
    await take(s.m, { body: 'notas\n\n[a.m4a](attachments/a-1.m4a)\n[b.m4a](attachments/b-2.m4a)' });
    expect(s.transcribe).toHaveBeenCalledWith(['/projects/work/attachments/a-1.m4a', '/projects/work/attachments/b-2.m4a']);
  });

  it('becomes a transcript in the project, with the time of each passage', async () => {
    const s = setup();
    await take(s.m);
    const [slug, doc] = s.save.mock.calls[0];
    expect(slug).toBe('work');
    expect(doc.path).toMatch(/^transcripts\/\d{4}-\d{2}-\d{2}-\d{4}-reuniao-com-a-kruzer\.md$/);
    expect(doc.content).toContain('# Reunião com a Kruzer');
    expect(doc.content).toContain('**00:00**\nBom dia, vamos começar.');
    expect(doc.content).toContain('**00:31**\nO João fecha o relatório.');
  });

  it('becomes a private thread that links the transcript and starts', async () => {
    const s = setup();
    const made = await take(s.m);
    const [slug, input] = s.store.composeItem.mock.calls[0];
    expect(slug).toBe('work');
    expect(input.visibility).toBe('private');
    expect(input.title).toBe('Reunião com a Kruzer');
    expect(input.body).toContain(`](${s.save.mock.calls[0][1].path})`);
    expect(s.wake).toHaveBeenCalledTimes(1);
    expect(made.id).toBe('w-new');
  });

  // shared/phone-inbox: a command is done once, and this is how it knows.
  it('carries the phone command that asked for it, so it is not made twice', async () => {
    const s = setup();
    await take(s.m);
    expect(s.store.composeItem.mock.calls[0][1].fromPhone).toBe('cmd-1');
  });

  it('says it came from one microphone in a room, not two tracks', async () => {
    const s = setup();
    await take(s.m);
    const { body: asked } = s.store.composeItem.mock.calls[0][1];
    expect(asked).toMatch(/phone/i);
    expect(asked).toMatch(/does not tell/i);
    expect(asked).not.toMatch(/"Them"/);
    expect(asked).toMatch(/propos/i);
    expect(asked).toMatch(/language/i);
  });

  // The links as the phone writes them and the Mac rewrites them (shared/phone-files.mts).
  it('finds its audio in the links the phone files turn into', async () => {
    const s = setup();
    const hash = 'a'.repeat(64);
    await take(s.m, { body: linkPhoneFiles(`nota\n\n[meeting-1.m4a](phone-files/${hash}.m4a)`) });
    expect(s.transcribe).toHaveBeenCalledWith([`/projects/work/attachments/${'a'.repeat(16)}-meeting-1.m4a`]);
  });

  it('leaves a picture sent with it among her words', async () => {
    const s = setup();
    await take(s.m, { body: `[quadro.png](attachments/q.png)\n\n${body}` });
    expect(s.transcribe).toHaveBeenCalledWith(['/projects/work/attachments/aaaa-meeting.m4a']);
    expect(s.store.composeItem.mock.calls[0][1].body).toContain('[quadro.png](attachments/q.png)');
  });

  it('runs on what the card it was sent from picked', async () => {
    const s = setup();
    await take(s.m, { choices: { model: 'opus', effort: 'high', engine: undefined } });
    expect(s.store.composeItem.mock.calls[0][1]).toMatchObject({ model: 'opus', effort: 'high' });
  });

  it('passes on the words she wrote with it', async () => {
    const s = setup();
    await take(s.m, { body: `foco no contrato\n\n${body}` });
    expect(s.store.composeItem.mock.calls[0][1].body).toContain('foco no contrato');
  });

  it('keeps a link to the audio itself', async () => {
    const s = setup();
    await take(s.m);
    expect(s.store.composeItem.mock.calls[0][1].body).toContain('(attachments/aaaa-meeting.m4a)');
  });
});

describe('when it cannot be transcribed', () => {
  const failing = (why) => setup({ transcribe: vi.fn(async () => { throw new Error(why); }) });

  it('tells the phone why, and files nothing an agent would run', async () => {
    const s = failing('Hex is not installed');
    await expect(take(s.m)).rejects.toThrow('Hex is not installed');
    expect(s.store.composeItem).not.toHaveBeenCalled();
    expect(s.wake).not.toHaveBeenCalled();
  });

  it('leaves the audio findable in Needs you, because an hour of talk is not to be lost', async () => {
    const s = failing('the model stopped');
    await expect(take(s.m)).rejects.toThrow();
    expect(s.store.fileItem).toHaveBeenCalledTimes(1);
    const [slug, row] = s.store.fileItem.mock.calls[0];
    expect(slug).toBe('work');
    expect(row.title).toContain('Reunião com a Kruzer');
    expect(row.body).toContain('the model stopped');
    expect(row.body).toContain('(attachments/aaaa-meeting.m4a)');
  });

  it('says so when nobody was heard, and starts no agent', async () => {
    const s = setup({ transcribe: vi.fn(async () => ({ durationMs: 60_000, pieces: [] })) });
    await expect(take(s.m)).rejects.toThrow(/no words/i);
    expect(s.store.composeItem).not.toHaveBeenCalled();
    expect(s.store.fileItem.mock.calls[0][1].body).toContain('(attachments/aaaa-meeting.m4a)');
  });

  it('refuses a message that brought no audio', async () => {
    const s = setup();
    await expect(take(s.m, { body: 'só palavras' })).rejects.toThrow(/recording/i);
    expect(s.transcribe).not.toHaveBeenCalled();
  });
});

describe('the phone asking for it', () => {
  it('rides the ordinary new-thread command', () => {
    const cmd = commandFor(REQUEST_CHANNELS.compose, { product: 'work@0123456789ab', title: 'Reunião', body, meeting: AT }, {});
    expect(cmd?.kind).toBe('new');
    expect(cmd?.payload.meeting).toBe(AT);
  });

  it('reaches the computer only as a time', () => {
    expect(phoneChoices('new', { meeting: AT })).toEqual({ meeting: AT });
    for (const bad of [true, 'now', -1, 0, Number.NaN]) expect(phoneChoices('new', { meeting: bad })).toEqual({});
  });

  it('is handed to the same door a new thread goes through, still marked', async () => {
    const calls = [];
    const apply = applyThrough(new Map([['zero:compose', async (_e, args) => { calls.push(args); return { id: 'w-1' }; }]]));
    await apply({ id: 'c1', kind: 'new', project: 'work', item: null, payload: { title: 'Reunião', body, meeting: AT } });
    expect(calls[0]).toMatchObject({ product: 'work', fromPhone: 'c1', meeting: AT });
  });
});

describe('the door it comes through', () => {
  function door({ meetings = { takeRecording: vi.fn(async () => ({ id: 'w-rec' })) } } = {}) {
    vi.spyOn(fs, 'watch').mockReturnValue({ close() {} });
    const store = new Store({ storeRoot: dir });
    const supervisor = new Supervisor({ storeRoot: dir, maxConcurrentSessions: 1 }, store, dir);
    supervisor.wake = vi.fn();
    vi.spyOn(store, 'composeItem');
    const ipcMain = collectingIpcMain();
    registerIpc({ store, supervisor, config: { storeRoot: dir }, window: broadcastingWindow(), host: { ...nodeHost(), ipcMain }, meetings });
    return { store, meetings, compose: ipcMain.handlers.get('zero:compose') };
  }

  it('goes to the recording, not to an ordinary thread that an agent would start on audio', async () => {
    const d = door();
    const out = await d.compose(null, { product: 'work', title: 'Reunião', body, meeting: AT, fromPhone: 'c1', model: 'opus' });
    expect(d.meetings.takeRecording).toHaveBeenCalledTimes(1);
    expect(d.meetings.takeRecording.mock.calls[0][0]).toMatchObject({ product: 'work', title: 'Reunião', body, recordedAt: AT, fromPhone: 'c1' });
    expect(out.id).toBe('w-rec');
    expect(d.store.composeItem).not.toHaveBeenCalled();
  });

  it('says so where this app cannot transcribe, and starts nothing', async () => {
    const d = door({ meetings: null });
    await expect(d.compose(null, { product: 'work', title: 'x', body, meeting: AT })).rejects.toThrow(/cannot transcribe/i);
    expect(d.store.composeItem).not.toHaveBeenCalled();
  });
});

describe('the headless Hex that transcribes it', () => {
  function fakeChild() {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = vi.fn();
    return child;
  }
  const ok = (body, init = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init });

  async function open({ prepare = 'data: {"type":"loading"}\n\ndata: {"type":"ok"}\n\n', answer = { transcript: 'olá', durationMs: 5 } } = {}) {
    const child = fakeChild();
    const asked = [];
    const fetchImpl = vi.fn(async (url, init) => {
      asked.push([url, init]);
      return url.includes('/prepare') ? ok(prepare) : ok(answer);
    });
    const spawn = vi.fn(() => { setImmediate(() => child.stdout.write('{"type":"ready","url":"http://127.0.0.1:9","token":"t0k","apiVersion":"2","pid":1}\n')); return child; });
    const service = await hexService('/hex', { spawn, fetchImpl });
    return { service, child, asked, spawn };
  }

  it('starts as a child of the app, and never as the desktop Hex', async () => {
    const { spawn } = await open();
    expect(spawn.mock.calls[0].slice(0, 2)).toEqual(['/hex', ['service', '--embedded']]);
  });

  it('readies the model that hears any language, then sends the audio', async () => {
    const { service, asked } = await open();
    expect(asked[0][0]).toBe('http://127.0.0.1:9/models/parakeet_v3/prepare');
    expect(await service.transcribe(Buffer.from('wav'))).toBe('olá');
    expect(asked[1][0]).toBe('http://127.0.0.1:9/transcriptions?model=parakeet_v3');
    expect(asked[1][1].headers.Authorization).toBe('Bearer t0k');
  });

  it('gives every request a deadline', async () => {
    const { service, asked } = await open();
    await service.transcribe(Buffer.from('wav'));
    for (const [, init] of asked) expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('says why when the model could not be readied', async () => {
    await expect(open({ prepare: 'data: {"type":"error","message":"no disk left"}\n\n' })).rejects.toThrow('no disk left');
  });

  it('closes by ending its stdin, as the service asks', async () => {
    const { service, child } = await open();
    const ended = new Promise((r) => child.stdin.once('finish', r));
    service.close();
    await ended;
  });

  it('gives up on a helper that never says it is ready, and stops it', async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const waiting = hexService('/hex', { spawn: () => child, fetchImpl: vi.fn() });
      const caught = expect(waiting).rejects.toThrow(/did not start/i);
      await vi.advanceTimersByTimeAsync(61_000);
      await caught;
      expect(child.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so when the helper dies before it is ready', async () => {
    const child = fakeChild();
    const waiting = hexService('/hex', { spawn: () => { setImmediate(() => child.emit('exit', 1)); return child; }, fetchImpl: vi.fn() });
    await expect(waiting).rejects.toThrow(/did not start/i);
  });
});
