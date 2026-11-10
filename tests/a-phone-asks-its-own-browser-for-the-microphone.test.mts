// A PHONE ASKS ITS OWN BROWSER FOR THE MICROPHONE.
//
// What broke (2026-11-08, the first press of Record meeting on a real iPhone,
// then measured in a headless browser through the published site's own door):
// the page said "Allow the microphone in System Settings, then press the mic
// again" and the browser was never asked. The recorder asks the app whether the
// computer allows the microphone, and the web app's door answers whatever it
// cannot do with an error, which the recorder reads as refused. The check before
// publishing drove a stand-in door that did not have the question at all.
//
// Now a phone goes straight to its browser, and Settings › Account has a place
// to allow the microphone ahead of a meeting, the way it has for alerts.
//
// Read on the way: every call through that door ended at 15 seconds, and an
// hour's meeting is about 22 MB (MEETING_CAPTURE's 48 kbps) to send from a phone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeMicrophone } from './helpers/fake-microphone.mts';
import { browser } from '../renderer/src/team/useVoiceRecorder.ts';
import { voiceRecording } from '../renderer/src/team/voice-recording.ts';
import { MEETING_CAPTURE, MEETING_KEY, MEETING_LIMITS } from '../renderer/src/threads/meeting-recording.ts';
import { cloudClient, doorFetch, putDeadlineMs } from '../renderer/src/cloud-rest.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const NOT_HERE = 'Your computer does this. Your phone can reply, start a thread, close, and move things to Later.';

function door(which, micAccess) {
  vi.stubGlobal('document', { documentElement: { dataset: which ? { door: which } : {} } });
  vi.stubGlobal('window', { zero: { micAccess } });
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('the recorder on a phone', () => {
  it('goes to the browser without asking the computer, whose door says it is not here', async () => {
    const micAccess = vi.fn(async () => { throw new Error(NOT_HERE); });
    door('phone', micAccess);
    expect(await browser(MEETING_CAPTURE).ask()).toBe('granted');
    expect(micAccess).not.toHaveBeenCalled();
  });

  it('still asks the computer on a computer', async () => {
    door(null, vi.fn(async () => 'settings'));
    expect(await browser(MEETING_CAPTURE).ask()).toBe('settings');
  });

  function refusalOf(name, limits) {
    const m = fakeMicrophone({ openFails: name });
    const said = [];
    const r = voiceRecording(m.env, MEETING_KEY, { phase: () => {}, tick: () => {}, done: () => {}, say: (t) => said.push(t) }, limits);
    return r.start().then(() => said);
  }

  it('tells a refused phone where to allow it, and names nothing a phone does not have', async () => {
    const [said] = await refusalOf('NotAllowedError', MEETING_LIMITS);
    expect(said).toMatch(/Settings, under Account/);
    expect(said).not.toMatch(/System Settings|press the mic/);
  });

  it.each(['NotFoundError', 'NotReadableError', 'TypeError'])('has its own words for %s', async (name) => {
    const [said] = await refusalOf(name, MEETING_LIMITS);
    expect(said).toBeTruthy();
    expect(said).not.toMatch(/System Settings|press the mic/);
  });

  it('still sends a computer to System Settings', async () => {
    const [said] = await refusalOf('NotAllowedError', undefined);
    expect(said).toMatch(/System Settings/);
  });
});

describe('the microphone row on the Account page', () => {
  let mic;
  beforeEach(async () => { vi.resetModules(); mic = await import('../renderer/src/phone-mic.ts'); });

  const tracks = () => { const list = [{ stop: vi.fn() }, { stop: vi.fn() }]; return { list, stream: { getTracks: () => list } }; };
  const named = (name) => Object.assign(new Error('no'), { name });

  it('offers to allow it when the browser has not said', async () => {
    expect(await mic.micState({ open: async () => tracks().stream, read: async () => 'prompt' })).toBe('off');
  });

  it('believes a yes and a no the browser reports', async () => {
    expect(await mic.micState({ open: async () => tracks().stream, read: async () => 'granted' })).toBe('on');
    expect(await mic.micState({ open: async () => tracks().stream, read: async () => 'denied' })).toBe('blocked');
  });

  it('treats a browser that cannot report as one not yet asked', async () => {
    expect(await mic.micState({ open: async () => tracks().stream, read: async () => { throw new TypeError('microphone is not a permission here'); } })).toBe('off');
    expect(await mic.micState({ open: async () => tracks().stream })).toBe('off');
  });

  it('says so on a browser with no microphone', async () => {
    expect(await mic.micState({})).toBe('unsupported');
    expect(await mic.allowMic({})).toBe('unsupported');
  });

  it('asks from the press and lets the microphone go at once', async () => {
    const { list, stream } = tracks();
    const open = vi.fn(async () => stream);
    expect(await mic.allowMic({ open })).toBe('on');
    expect(open).toHaveBeenCalledWith({ audio: true });
    for (const t of list) expect(t.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps a yes for this visit, whatever the browser goes on reporting', async () => {
    const { stream } = tracks();
    const stale = { open: async () => stream, read: async () => 'prompt' };
    await mic.allowMic(stale);
    expect(await mic.micState(stale)).toBe('on');
  });

  it('says blocked when the phone says no', async () => {
    expect(await mic.allowMic({ open: async () => { throw named('NotAllowedError'); } })).toBe('blocked');
  });

  it('says why when the microphone will not open for another reason', async () => {
    await expect(mic.allowMic({ open: async () => { throw named('NotReadableError'); } })).rejects.toThrow(/using the microphone/);
  });

  it('sits right under alerts on the Account page, drawn the same way', () => {
    expect(read('renderer/src/components/Settings.tsx')).toMatch(/<WebAlertsGroup \/>\s*<WebMicGroup \/>/);
    const row = read('renderer/src/components/WebMicrophone.tsx');
    for (const part of ['className="set-group" data-find="microphone"', 'className="set-group-label"', 'className="set-plate"', 'className="set-row"', 'className="set-ghost"']) expect(row).toContain(part);
  });
});

describe('a recording going up from the phone', () => {
  const session = { access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3_600_000, user: { id: 'u' } };
  const storage = { getItem: () => JSON.stringify(session), setItem: () => {}, removeItem: () => {} };

  it('has as long as a slow connection needs, and a small file keeps the usual limit', () => {
    expect(putDeadlineMs(1000)).toBe(15_000);
    expect(putDeadlineMs(24 * 1024 * 1024)).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it('is sent with a deadline of its own', async () => {
    const seen = [];
    const client = cloudClient({ url: 'https://db.example', anonKey: 'key' }, { storage, fetchImpl: async (_u, init) => { seen.push(init); return new Response('{}', { status: 200 }); } });
    await client.putFile('phone-files', 'u/d/a.m4a', new Uint8Array(10), 'audio/mp4');
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps that deadline through the door, and every other call still has one', async () => {
    const seen = [];
    const through = doorFetch(async (_u, init) => { seen.push(init); return new Response('{}'); });
    const mine = new AbortController().signal;
    await through('https://db.example/a', { signal: mine });
    await through('https://db.example/b', {});
    expect(seen[0].signal).toBe(mine);
    expect(seen[1].signal).toBeInstanceOf(AbortSignal);
    expect(seen[1].signal).not.toBe(mine);
  });

  it('is what the web app calls through', () => {
    expect(read('renderer/src/cloud-bridge.ts')).toMatch(/fetchImpl: doorFetch\(\)/);
  });
});
