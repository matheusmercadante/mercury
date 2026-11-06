// One press has to end in a recording or in a sentence saying why not. Measured
// on the Mac this was built for (2026-11-06): Hex was installed but not running,
// its Meetings were off, and its model heard English only, so a Portuguese
// meeting would have come back as nonsense with nothing saying so. Hex's model is
// also the one its dictation uses, so changing it is offered and never done alone.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeetings } from '../main/meetings.mts';

const ENGLISH = { id: 'parakeet_unified_en', name: 'Parakeet Unified', languages: ['en'], size: '705 MB', installed: true, selected: true };
const V3 = { id: 'parakeet_v3', name: 'Parakeet v3', languages: ['en', 'pt', 'es'], size: '720 MB', installed: false, selected: false };

function status(over = {}) {
  return { ok: true, body: { meeting: { state: 'idle', title: null, elapsed_seconds: null }, model: { id: 'parakeet_unified_en', preparing: null, downloaded_bytes: 0 }, features: { meetings: true }, ...over } };
}

function fakeHex({ running = true, meetingsOn = true, models = [{ ...V3, selected: true, installed: true }] } = {}) {
  const hex = { running, meetingsOn };
  return Object.assign(hex, {
    status: vi.fn(async () => (hex.running ? status({ features: { meetings: hex.meetingsOn } }) : { ok: false, code: 'not-running', message: 'Hex is not running' })),
    start: vi.fn(async () => { hex.running = true; return { ok: true, body: {} }; }),
    enable: vi.fn(async () => { hex.meetingsOn = true; return { ok: true, body: {} }; }),
    models: vi.fn(async () => ({ ok: true, body: { models } })),
    install: vi.fn(async () => ({ ok: true, body: {} })),
    record: vi.fn(async () => ({ ok: true, body: { status: 'done' } })),
    stop: vi.fn(async () => ({ ok: true, body: { status: 'done' } })),
    open: vi.fn(async () => ({ ok: true, body: {} })),
    list: vi.fn(async () => ({ ok: true, body: { version: 1, meetings: [] } })),
  });
}

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meetings-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const make = (hex, over = {}) => createMeetings({
  locate: () => hex,
  store: { listProducts: () => [{ slug: 'work', name: 'Work' }], composeItem: vi.fn(), fileItem: vi.fn() },
  saveTranscript: vi.fn(), wake: vi.fn(), stateFile: path.join(dir, 'meetings.json'),
  languages: ['en', 'pt'], now: () => 1_790_000_000_000, ...over,
});

describe('the press', () => {
  it('starts recording when everything is ready', async () => {
    const hex = fakeHex();
    await make(hex).record({ product: 'work' });
    expect(hex.record).toHaveBeenCalledTimes(1);
    expect(hex.start).not.toHaveBeenCalled();
    expect(hex.enable).not.toHaveBeenCalled();
  });

  it('opens Hex first when it is not running', async () => {
    const hex = fakeHex({ running: false });
    await make(hex).record({ product: 'work' });
    expect(hex.start).toHaveBeenCalledTimes(1);
    expect(hex.record).toHaveBeenCalledTimes(1);
  });

  it('turns Hex\'s Meetings on, which the press asked for', async () => {
    const hex = fakeHex({ meetingsOn: false });
    await make(hex).record({ product: 'work' });
    expect(hex.enable).toHaveBeenCalledTimes(1);
    expect(hex.record).toHaveBeenCalledTimes(1);
  });

  it('keeps the project for when the recording ends', async () => {
    const hex = fakeHex();
    const m = make(hex);
    await m.record({ product: 'work' });
    expect(m.view().product).toBe('work');
  });
});

describe('when it cannot record', () => {
  it('says Hex is not installed, and asks nothing of it', async () => {
    const m = make(null, { locate: () => null });
    await m.record({ product: 'work' });
    expect(m.view()).toMatchObject({ hex: false, problem: expect.stringMatching(/hex/i) });
  });

  it('shows Hex\'s own words when it refuses', async () => {
    const hex = fakeHex();
    hex.record.mockResolvedValueOnce({ ok: false, code: 'failed', message: 'Allow Hex in System Settings, then try again' });
    const m = make(hex);
    await m.record({ product: 'work' });
    expect(m.view().problem).toBe('Allow Hex in System Settings, then try again');
  });

  it('shows why Hex would not open', async () => {
    const hex = fakeHex({ running: false });
    hex.start.mockResolvedValueOnce({ ok: false, code: 'failed', message: 'Hex did not answer in 20 s' });
    const m = make(hex);
    await m.record({ product: 'work' });
    expect(hex.record).not.toHaveBeenCalled();
    expect(m.view().problem).toBe('Hex did not answer in 20 s');
  });

  it('clears the problem on the next press', async () => {
    const hex = fakeHex();
    hex.record.mockResolvedValueOnce({ ok: false, code: 'failed', message: 'no' });
    const m = make(hex);
    await m.record({ product: 'work' });
    await m.record({ product: 'work' });
    expect(m.view().problem).toBe(null);
  });

  it('can be put away', async () => {
    const hex = fakeHex();
    hex.record.mockResolvedValueOnce({ ok: false, code: 'failed', message: 'no' });
    const m = make(hex);
    await m.record({ product: 'work' });
    m.dismiss();
    expect(m.view().problem).toBe(null);
  });
});

describe('a model that cannot hear the meeting', () => {
  it('stops the press and offers the switch, because the model is also the dictation\'s', async () => {
    const hex = fakeHex({ models: [ENGLISH, V3] });
    const m = make(hex);
    await m.record({ product: 'work' });
    expect(hex.record).not.toHaveBeenCalled();
    expect(hex.install).not.toHaveBeenCalled();
    expect(m.view().model).toEqual({ from: 'Parakeet Unified', to: 'Parakeet v3', size: '720 MB' });
  });

  it('switches only when asked, and the offer goes', async () => {
    const hex = fakeHex({ models: [ENGLISH, V3] });
    const m = make(hex);
    await m.record({ product: 'work' });
    await m.useModel();
    expect(hex.install).toHaveBeenCalledWith('parakeet_v3');
    expect(m.view().model).toBe(null);
  });

  it('says so when the download fails, which Hex reports only on its status', async () => {
    const hex = fakeHex({ models: [ENGLISH, V3] });
    const m = make(hex);
    await m.record({ product: 'work' });
    await m.useModel();
    hex.status.mockResolvedValue(status({ model: { id: 'parakeet_unified_en', preparing: null, error: 'the download stopped' } }));
    await m.tick();
    expect(m.view().problem).toBe('the download stopped');
  });

  it('does not bring up an old model error nobody here asked about', async () => {
    const hex = fakeHex();
    hex.status.mockResolvedValue(status({ model: { id: 'parakeet_v3', preparing: null, error: 'an old failure' } }));
    const m = make(hex);
    await m.tick();
    expect(m.view().problem).toBe(null);
  });

  it('stops watching for an error once the new model is in place', async () => {
    const hex = fakeHex({ models: [ENGLISH, V3] });
    const m = make(hex);
    await m.record({ product: 'work' });
    await m.useModel();
    hex.status.mockResolvedValue(status({ model: { id: 'parakeet_v3', preparing: null, error: null } }));
    await m.tick();
    hex.status.mockResolvedValue(status({ model: { id: 'parakeet_v3', preparing: null, error: 'later and unrelated' } }));
    await m.tick();
    expect(m.view().problem).toBe(null);
  });

  it('is not offered on a Mac that only reads English', async () => {
    const hex = fakeHex({ models: [ENGLISH, V3] });
    await make(hex, { languages: ['en'] }).record({ product: 'work' });
    expect(hex.record).toHaveBeenCalledTimes(1);
  });

  it('takes a model that hears every language as hearing this one', async () => {
    const hex = fakeHex({ models: [{ id: 'whisper_large_v3_turbo', name: 'Whisper', languages: ['*'], size: '845 MB', installed: true, selected: true }] });
    await make(hex).record({ product: 'work' });
    expect(hex.record).toHaveBeenCalledTimes(1);
  });

  it('records anyway when Hex offers nothing better, rather than refusing for ever', async () => {
    const hex = fakeHex({ models: [ENGLISH] });
    await make(hex).record({ product: 'work' });
    expect(hex.record).toHaveBeenCalledTimes(1);
  });
});

describe('while it records', () => {
  const during = (state, elapsed = 754) => status({ meeting: { state, title: 'Design sync', elapsed_seconds: elapsed } });

  it('shows what Hex says, counted from when it began', async () => {
    const hex = fakeHex();
    hex.status.mockResolvedValue(during('recording'));
    const m = make(hex);
    await m.tick();
    expect(m.view()).toMatchObject({ phase: 'recording', title: 'Design sync', startedAt: 1_790_000_000_000 - 754_000 });
  });

  it('shows a recording Hex started on its own', async () => {
    const hex = fakeHex();
    hex.status.mockResolvedValue(during('recording', 5));
    const m = make(hex);
    await m.tick();
    expect(m.view().phase).toBe('recording');
  });

  it('goes back to idle when Hex has been closed', async () => {
    const hex = fakeHex();
    hex.status.mockResolvedValueOnce(during('recording'));
    const m = make(hex);
    await m.tick();
    hex.status.mockResolvedValueOnce({ ok: false, code: 'not-running', message: 'Hex is not running' });
    await m.tick();
    expect(m.view()).toMatchObject({ phase: 'idle', title: null, startedAt: null });
  });

  it('stop asks Hex to stop and shows the transcription', async () => {
    const hex = fakeHex();
    hex.status.mockResolvedValueOnce(during('recording'));
    const m = make(hex);
    await m.tick();
    hex.status.mockResolvedValue(during('transcribing'));
    await m.stop();
    expect(hex.stop).toHaveBeenCalledTimes(1);
    expect(m.view().phase).toBe('transcribing');
  });

  it('says so when stopping was refused', async () => {
    const hex = fakeHex();
    hex.stop.mockResolvedValueOnce({ ok: false, code: 'failed', message: 'could not stop' });
    const m = make(hex);
    await m.stop();
    expect(m.view().problem).toBe('could not stop');
  });

  it('shows a model being downloaded', async () => {
    const hex = fakeHex();
    hex.status.mockResolvedValue(status({ model: { id: 'parakeet_v3', preparing: 'Downloading', downloaded_bytes: 412_000_000 } }));
    const m = make(hex);
    await m.tick();
    expect(m.view().preparing).toBe(412);
  });

  it('tells the screen when something changed, and only then', async () => {
    const hex = fakeHex();
    const onChange = vi.fn();
    hex.status.mockResolvedValue(during('recording'));
    const m = make(hex, { onChange });
    await m.tick();
    await m.tick();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('does not redraw the window for the second Hex rounds its clock to', async () => {
    const hex = fakeHex();
    const onChange = vi.fn();
    let at = 1_790_000_000_000;
    const m = make(hex, { onChange, now: () => at });
    hex.status.mockResolvedValue(during('recording', 100));
    await m.tick();
    const started = m.view().startedAt;
    at += 3_400;
    hex.status.mockResolvedValue(during('recording', 103));
    await m.tick();
    expect(m.view().startedAt).toBe(started);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('keeps the card through one status Hex could not answer', async () => {
    const hex = fakeHex();
    hex.status.mockResolvedValueOnce(during('recording'));
    const m = make(hex);
    await m.tick();
    hex.status.mockResolvedValueOnce({ ok: false, code: 'timeout', message: 'Hex did not answer in time.' });
    await m.tick();
    expect(m.view().phase).toBe('recording');
  });

  it('goes back to idle when Hex has been removed', async () => {
    const hex = fakeHex();
    let installed = hex;
    hex.status.mockResolvedValueOnce(during('recording'));
    const m = make(hex, { locate: () => installed });
    await m.tick();
    installed = null;
    await m.tick();
    expect(m.view()).toMatchObject({ hex: false, phase: 'idle', startedAt: null });
  });

  it('looks often while something is happening and rarely when nothing is', async () => {
    const hex = fakeHex();
    const m = make(hex);
    await m.tick();
    const idle = m.nextLookMs();
    hex.status.mockResolvedValue(during('recording'));
    await m.tick();
    expect(m.nextLookMs()).toBeLessThan(idle);
  });

  it('is one look at a time, however many are asked for', async () => {
    const hex = fakeHex();
    const m = make(hex);
    await Promise.all([m.tick(), m.tick(), m.tick()]);
    expect(hex.status).toHaveBeenCalledTimes(1);
  });
});
