// "Estou com necessidade de gravar as reunioes de trabalho e ja ter integrado
// para fazer possiveis tasks." A meeting that ends in Hex has to arrive here on
// its own: its transcript a document of the project, and a thread that reads it
// and proposes the work. Hex's own advice for a companion app (docs/streams.md)
// sets the rules: the meetings folder is the record, a meeting counts once it
// reads complete with a final transcript, the cursor stays before anything
// unfinished, and delivery is at least once, so receipts are kept by id.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeetings } from '../main/meetings.mts';

const T0 = 1_790_000_000_000;
const meeting = (over = {}) => ({
  id: `${T0}-1`, title: 'Weekly sync', timestamp_ms: T0, duration_ms: 2_520_000, application: 'Zoom',
  status: 'complete', in_progress: false, transcript_source: 'final', warnings: [], ...over,
});
const words = [{ source: 'system', start_ms: 0, end_ms: 5000, text: 'Vamos revisar o roadmap.' }];

function setup({ meetings = [], entries = words, markdown = '# Weekly sync\n\n**Them** · 00:00\nVamos revisar o roadmap.\n', now = T0 + 3_600_000, products = [{ slug: 'work', name: 'Work' }] } = {}) {
  const state = { meetings, entries, markdown };
  const cli = {
    status: vi.fn(async () => ({ ok: true, body: { meeting: { state: 'idle', title: null, elapsed_seconds: null }, model: {}, features: { meetings: true } } })),
    list: vi.fn(async () => ({ ok: true, body: { version: 1, meetings: state.meetings } })),
    show: vi.fn(async () => ({ ok: true, body: { version: 1, entries: state.entries } })),
    markdown: vi.fn(async () => ({ ok: true, body: state.markdown })),
  };
  const store = {
    listProducts: () => products,
    composeItem: vi.fn((slug, input) => ({ id: 'w-1', product: slug, ...input })),
    fileItem: vi.fn(),
  };
  const save = vi.fn(async () => {});
  return { state, cli, store, save, wake: vi.fn(), now };
}

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetings-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const make = (s, over = {}) => createMeetings({
  locate: () => s.cli, store: s.store, saveTranscript: s.save, wake: s.wake,
  stateFile: path.join(dir, 'meetings.json'), languages: ['en'], now: () => s.now, ...over,
});
// A Mercury that has been running since before the meeting, so its cursor is older.
const seeded = (since = T0 - 60_000) => fs.writeFileSync(path.join(dir, 'meetings.json'), JSON.stringify({ since }));

describe('a finished meeting', () => {
  it('becomes a transcript in the project and a thread that links it', async () => {
    seeded();
    const s = setup({ meetings: [meeting()] });
    await make(s).tick();

    expect(s.save).toHaveBeenCalledTimes(1);
    const [slug, doc] = s.save.mock.calls[0];
    expect(slug).toBe('work');
    expect(doc.title).toBe('Weekly sync');
    expect(doc.path).toMatch(/^transcripts\/\d{4}-\d{2}-\d{2}-\d{4}-weekly-sync\.md$/);
    expect(doc.content).toContain('Vamos revisar o roadmap.');

    expect(s.store.composeItem).toHaveBeenCalledTimes(1);
    const [, input] = s.store.composeItem.mock.calls[0];
    expect(input.title).toBe('Weekly sync');
    expect(input.body).toContain(`[Weekly sync](${doc.path})`);
    expect(s.wake).toHaveBeenCalledTimes(1);
  });

  it('is private, because a recorded conversation is never shared by default', async () => {
    seeded();
    const s = setup({ meetings: [meeting()] });
    await make(s).tick();
    expect(s.store.composeItem.mock.calls[0][1].visibility).toBe('private');
  });

  it('asks the thread for notes and for proposals in the meeting\'s own language', async () => {
    seeded();
    const s = setup({ meetings: [meeting()] });
    await make(s).tick();
    const { body } = s.store.composeItem.mock.calls[0][1];
    expect(body).toMatch(/propos/i);
    expect(body).toMatch(/language/i);
    expect(body).toMatch(/speech recognition/i);
  });

  it('lands in the project chosen when it was recorded', async () => {
    seeded();
    const s = setup({ products: [{ slug: 'work', name: 'Work' }, { slug: 'side', name: 'Side' }] });
    s.cli.start = vi.fn(async () => ({ ok: true }));
    s.cli.enable = vi.fn(async () => ({ ok: true }));
    s.cli.record = vi.fn(async () => ({ ok: true, body: {} }));
    s.cli.models = vi.fn(async () => ({ ok: true, body: { models: [] } }));
    s.now = T0 - 1000;
    const m = make(s);
    await m.record({ product: 'side' });
    s.state.meetings = [meeting()];
    s.now = T0 + 3_600_000;
    await m.tick();
    expect(s.save.mock.calls[0][0]).toBe('side');
  });

  it('started by Hex itself lands in the project of the last recording', async () => {
    fs.writeFileSync(path.join(dir, 'meetings.json'), JSON.stringify({ since: T0 - 60_000, product: 'side' }));
    const s = setup({ meetings: [meeting()], products: [{ slug: 'work', name: 'Work' }, { slug: 'side', name: 'Side' }] });
    await make(s).tick();
    expect(s.save.mock.calls[0][0]).toBe('side');
  });

  it('goes to a project that exists when its own has gone', async () => {
    fs.writeFileSync(path.join(dir, 'meetings.json'), JSON.stringify({ since: T0 - 60_000, product: 'gone' }));
    const s = setup({ meetings: [meeting()] });
    await make(s).tick();
    expect(s.save.mock.calls[0][0]).toBe('work');
  });
});

describe('each meeting arrives once', () => {
  it('is not filed twice when the list repeats it', async () => {
    seeded();
    const s = setup({ meetings: [meeting()] });
    const m = make(s);
    await m.tick();
    await m.tick();
    expect(s.store.composeItem).toHaveBeenCalledTimes(1);
  });

  it('is not filed again after a restart', async () => {
    seeded();
    const s = setup({ meetings: [meeting()] });
    await make(s).tick();
    await make(s).tick();
    expect(s.store.composeItem).toHaveBeenCalledTimes(1);
  });

  it('is not filed again when the app dies right after filing it, with another meeting still to read', async () => {
    seeded();
    const second = meeting({ id: `${T0 + 9_000_000}-2`, timestamp_ms: T0 + 9_000_000, title: 'Second' });
    const s = setup({ meetings: [meeting(), second], now: T0 + 12_000_000 });
    // The second save never returns: this process is gone before its list ends.
    s.save.mockImplementationOnce(async () => {}).mockImplementationOnce(() => new Promise(() => {}));
    void make(s).tick();
    await vi.waitFor(() => expect(s.save).toHaveBeenCalledTimes(2));

    s.store.composeItem.mockClear();
    await make(s).tick();
    expect(s.store.composeItem.mock.calls.map(([, input]) => input.title)).toEqual(['Second']);
  });

  it('keeps the project a meeting was first seen with, whatever is pressed while it transcribes', async () => {
    fs.writeFileSync(path.join(dir, 'meetings.json'), JSON.stringify({ since: T0 - 60_000, product: 'work' }));
    const s = setup({ meetings: [meeting({ status: 'transcribing', transcript_source: 'rolling', in_progress: true })], products: [{ slug: 'work', name: 'Work' }, { slug: 'side', name: 'Side' }] });
    Object.assign(s.cli, { models: vi.fn(async () => ({ ok: true, body: { models: [] } })), record: vi.fn(async () => ({ ok: true, body: {} })) });
    const m = make(s);
    await m.tick();
    await m.record({ product: 'side' });
    s.state.meetings = [meeting()];
    await m.tick();
    expect(s.save.mock.calls[0][0]).toBe('work');
  });

  it('files one that ended while Mercury was closed, at the next launch', async () => {
    seeded(T0 - 86_400_000);
    const s = setup({ meetings: [meeting()] });
    await make(s).tick();
    expect(s.store.composeItem).toHaveBeenCalledTimes(1);
    expect(s.cli.list).toHaveBeenCalledWith(T0 - 86_400_000);
  });

  it('leaves everything recorded before the very first launch alone', async () => {
    const s = setup({ meetings: [meeting()] });
    await make(s).tick();
    expect(s.cli.list).toHaveBeenCalledWith(s.now);
  });
});

describe('a meeting that is not finished', () => {
  for (const status of ['starting', 'recording', 'transcribing', 'interrupted']) {
    it(`waits while it reads ${status}, and arrives when it completes`, async () => {
      seeded();
      const s = setup({ meetings: [meeting({ status, transcript_source: 'rolling', in_progress: status !== 'interrupted' })] });
      const m = make(s);
      await m.tick();
      expect(s.store.composeItem).not.toHaveBeenCalled();

      s.state.meetings = [meeting()];
      await m.tick();
      expect(s.store.composeItem).toHaveBeenCalledTimes(1);
    });
  }

  it('holds the cursor before itself, even when a later one has been filed', async () => {
    seeded();
    const later = meeting({ id: `${T0 + 9_000_000}-2`, timestamp_ms: T0 + 9_000_000, title: 'Later' });
    const s = setup({ meetings: [later, meeting({ status: 'interrupted', transcript_source: 'rolling' })], now: T0 + 12_000_000 });
    const m = make(s);
    await m.tick();
    expect(s.store.composeItem).toHaveBeenCalledTimes(1);
    await m.tick();
    expect(s.cli.list).toHaveBeenLastCalledWith(T0);
  });

  it('does not take a complete meeting whose transcript is not the final one', async () => {
    seeded();
    const s = setup({ meetings: [meeting({ transcript_source: 'rolling' })] });
    await make(s).tick();
    expect(s.store.composeItem).not.toHaveBeenCalled();
  });
});

describe('nothing fails in silence', () => {
  it('a failed meeting says so in Needs you, once', async () => {
    seeded();
    const s = setup({ meetings: [meeting({ status: 'failed', transcript_source: 'missing', warnings: ['the model stopped'] })] });
    const m = make(s);
    await m.tick();
    await m.tick();
    expect(s.store.fileItem).toHaveBeenCalledTimes(1);
    expect(s.store.fileItem.mock.calls[0][1].title).toContain('Weekly sync');
    expect(s.store.composeItem).not.toHaveBeenCalled();
  });

  it('a meeting nobody was heard in starts no agent and says so, because a refused tap records silence', async () => {
    seeded();
    const s = setup({ meetings: [meeting()], entries: [] });
    await make(s).tick();
    expect(s.store.composeItem).not.toHaveBeenCalled();
    expect(s.store.fileItem).toHaveBeenCalledTimes(1);
    expect(s.store.fileItem.mock.calls[0][1].body).toMatch(/no words/i);
  });

  it('tries a meeting it could not save again, and says so after three tries', async () => {
    seeded();
    const s = setup({ meetings: [meeting()] });
    s.save.mockRejectedValue(new Error('disk full'));
    const m = make(s);
    await m.tick();
    await m.tick();
    expect(s.store.fileItem).not.toHaveBeenCalled();
    await m.tick();
    await m.tick();
    expect(s.save).toHaveBeenCalledTimes(3);
    expect(s.store.fileItem).toHaveBeenCalledTimes(1);
    expect(s.store.fileItem.mock.calls[0][1].body).toContain('disk full');
  });

  // Found running this on the real Hex: a list it refused left no trace at all,
  // so a Hex update that changed the format would have stopped meetings arriving
  // with nothing on any screen.
  it('says so in Needs you when Hex keeps refusing the list, once, and again only after it recovered', async () => {
    seeded();
    const s = setup();
    const refused = { ok: false, code: 'version', message: 'This Hex writes meetings in version 2' };
    const good = s.cli.list.getMockImplementation();
    s.cli.list.mockResolvedValue(refused);
    const m = make(s);
    for (let i = 0; i < 19; i += 1) await m.tick();
    expect(s.store.fileItem).not.toHaveBeenCalled();
    for (let i = 0; i < 30; i += 1) await m.tick();
    expect(s.store.fileItem).toHaveBeenCalledTimes(1);
    expect(s.store.fileItem.mock.calls[0][1].body).toContain('version 2');

    s.cli.list.mockImplementation(good);
    await m.tick();
    s.cli.list.mockResolvedValue(refused);
    for (let i = 0; i < 20; i += 1) await m.tick();
    expect(s.store.fileItem).toHaveBeenCalledTimes(2);
  });

  it('a list Hex cannot answer changes nothing and is tried at the next look', async () => {
    seeded();
    const s = setup({ meetings: [meeting()] });
    s.cli.list.mockResolvedValueOnce({ ok: false, code: 'version', message: 'unreadable' });
    const m = make(s);
    await m.tick();
    expect(s.store.composeItem).not.toHaveBeenCalled();
    await m.tick();
    expect(s.store.composeItem).toHaveBeenCalledTimes(1);
  });
});
