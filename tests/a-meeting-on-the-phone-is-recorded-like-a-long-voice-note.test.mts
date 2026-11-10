// A meeting recorded on the phone is a voice note's recorder given longer: every
// second is written down as it is heard, so a page that dies keeps what was said.
// What differs is measured: the Mac's own converter read AAC in MP4 and refused
// WebM (afconvert, 2026-11-08), and the bucket takes 25 MB a file, so a long
// meeting goes up in slices that join back into one file.
import { describe, expect, it } from 'vitest';
import { fakeMicrophone } from './helpers/fake-microphone.mts';
import { voiceRecording } from '../renderer/src/team/voice-recording.ts';
import { memoryVoiceStore } from '../renderer/src/team/voice-drafts.ts';
import { awayWords, MEETING_CAPTURE, MEETING_KEY, MEETING_LIMITS, MEETING_MAX_MS, PART_BYTES, meetingAttachments, meetingTitle } from '../renderer/src/threads/meeting-recording.ts';

function box(m, world = m.env) {
  const notes = [];
  const said = [];
  const r = voiceRecording(world, MEETING_KEY, { phase: () => {}, tick: () => {}, done: (n, how) => notes.push({ ...n, how }), say: (t) => said.push(t) }, MEETING_LIMITS);
  return { r, notes, said };
}
// A recorder that writes what an iPhone writes.
function iphone(m) {
  return { ...m.env, makeRecorder: (s) => { const rec = m.env.makeRecorder(s); rec.mimeType = 'audio/mp4'; return rec; } };
}

describe('recording', () => {
  it('goes on past the five minutes a voice note stops at', async () => {
    const m = fakeMicrophone();
    const b = box(m, iphone(m));
    await b.r.start();
    m.pass(90 * 60_000);
    expect(b.said).toEqual([]);
    b.r.stop();
    await m.settle();
    expect(b.notes[0]).toMatchObject({ how: 'recorded', ms: 90 * 60_000, name: 'meeting.m4a' });
  });

  it('knows when it began', async () => {
    const m = fakeMicrophone();
    const began = m.now();
    const b = box(m, iphone(m));
    await b.r.start();
    m.pass(60_000);
    b.r.stop();
    await m.settle();
    expect(b.notes[0].startedAt).toBe(began);
  });

  it('stops itself at the limit, keeps it, and says so in a meeting\'s words', async () => {
    const m = fakeMicrophone();
    const b = box(m, iphone(m));
    await b.r.start();
    m.pass(MEETING_MAX_MS);
    await m.settle();
    expect(b.notes).toHaveLength(1);
    expect(b.said[0]).toMatch(/recordings stop at 4 hours/i);
    expect(b.said[0]).not.toMatch(/voice note/i);
  });

  it('keeps what was heard when the microphone goes, and says when', async () => {
    const m = fakeMicrophone();
    const b = box(m, iphone(m));
    await b.r.start();
    m.pass(12 * 60_000);
    m.tracks[0].end?.();
    m.recorders[0].fail();
    await m.settle();
    expect(b.notes).toHaveLength(1);
    expect(b.said[0]).toMatch(/12:00/);
    expect(b.said[0]).not.toMatch(/voice note/i);
  });

  it('comes back when the page died in the middle, and says so', async () => {
    const store = memoryVoiceStore();
    await store.begin({ id: 'died', key: MEETING_KEY, startedAt: 1000, mime: 'audio/mp4', done: false });
    await store.chunk('died', 1, new Blob(['a']), 2000);
    await store.chunk('died', 2, new Blob(['b']), 3_601_000);
    const m = fakeMicrophone();
    const b = box(m, { ...m.env, store });
    await b.r.restore();
    expect(b.notes[0]).toMatchObject({ how: 'recovered', ms: 3_600_000, name: 'meeting.m4a', startedAt: 1000 });
    expect(b.said[0]).toMatch(/meeting/i);
    expect(b.said[0]).not.toMatch(/voice note/i);
  });

  it('leaves a voice note as it was', async () => {
    const m = fakeMicrophone();
    const b = m.box();
    await b.r.start();
    m.pass(1000);
    b.r.stop();
    await m.settle();
    expect(b.notes[0].name).toBe('voice-note-1000ms.webm');
  });
});

describe('what it records', () => {
  it('is only what the Mac can read, never WebM', () => {
    expect(MEETING_CAPTURE.types.length).toBeGreaterThan(0);
    for (const t of MEETING_CAPTURE.types) expect(t).toMatch(/^audio\/mp4/);
  });

  // A phone on a table should hear the room, not be tuned to one voice at its mouth.
  it('leaves the room alone', () => {
    expect(MEETING_CAPTURE.audio).toMatchObject({ echoCancellation: false, noiseSuppression: false });
  });
});

describe('going up', () => {
  const noteOf = (text) => ({ name: 'meeting.m4a', ms: 1000, blob: new Blob([text]), dataBase64: Buffer.from(text).toString('base64'), draftId: 'd1', startedAt: 5 });
  const pack = async (blob) => Buffer.from(await blob.arrayBuffer()).toString('base64');
  const back = (files) => Buffer.concat(files.map((f) => Buffer.from(f.dataBase64, 'base64'))).toString();

  it('is one file when it fits', async () => {
    const files = await meetingAttachments(noteOf('short'), pack, 10);
    expect(files).toEqual([{ name: 'meeting.m4a', dataBase64: Buffer.from('short').toString('base64'), image: false, size: 5, draftId: 'd1' }]);
  });

  it('goes in slices, in order, when it does not', async () => {
    const files = await meetingAttachments(noteOf('0123456789abcdefghijK'), pack, 10);
    expect(files.map((f) => f.name)).toEqual(['meeting-1.m4a', 'meeting-2.m4a', 'meeting-3.m4a']);
    expect(files.map((f) => f.size)).toEqual([10, 10, 1]);
    expect(back(files)).toBe('0123456789abcdefghijK');
    expect(files.every((f) => f.draftId === 'd1')).toBe(true);
  });

  it('keeps every slice under what the bucket takes', () => {
    expect(PART_BYTES).toBeLessThan(25 * 1024 * 1024);
  });
});

describe('the words around it', () => {
  it('names a meeting with no words of its own by when it was', () => {
    expect(meetingTitle(new Date(2026, 10, 8, 14, 5).getTime())).toBe('Meeting 8 Nov, 14:05');
  });

  it('says how long the phone could not hear', () => {
    expect(awayWords(8_000)).toBe('about 8 seconds');
    expect(awayWords(95_000)).toBe('about 2 minutes');
    expect(awayWords(60_000)).toBe('about 1 minute');
  });
});
