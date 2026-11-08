// A recording from the phone reaches the Mac as one long file, and Hex's headless
// service takes at most 17.5 minutes of 16 kHz audio per request and has no voice
// detector of its own (read in its source, 2026-11-08), so a model left alone with
// room noise invents words. So the Mac cuts the audio into short pieces at its
// quietest moments, where no word is split, and skips pieces nobody spoke in.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cutAtPauses, heardSpeech, noiseFloor, RATE, readWav, transcribeRecording, wavOf } from '../main/meeting-audio.mts';

const seconds = (s) => Math.round(s * RATE);
function tone(s, amplitude = 8000) {
  const out = new Int16Array(seconds(s));
  for (let i = 0; i < out.length; i += 1) out[i] = Math.round(amplitude * Math.sin((2 * Math.PI * 220 * i) / RATE));
  return out;
}
const silence = (s) => new Int16Array(seconds(s));
function join(...parts) {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function noise(s, amplitude) {
  const out = new Int16Array(seconds(s));
  // Repeatable, so a test that fails fails the same way twice.
  let x = 12345;
  for (let i = 0; i < out.length; i += 1) { x = (x * 1103515245 + 12345) & 0x7fffffff; out[i] = ((x % (2 * amplitude + 1)) - amplitude); }
  return out;
}
const lengths = (samples) => cutAtPauses(samples).map(([a, b]) => (b - a) / RATE);

describe('cutting a recording', () => {
  it('cuts in the pause, not in the speech', () => {
    const samples = join(tone(30), silence(1), tone(30));
    const pieces = cutAtPauses(samples);
    expect(pieces).toHaveLength(2);
    const cut = pieces[0][1] / RATE;
    expect(cut).toBeGreaterThan(30);
    expect(cut).toBeLessThan(31);
  });

  it('still cuts speech that never pauses, so no piece grows past the limit', () => {
    for (const s of lengths(tone(120))) expect(s).toBeLessThanOrEqual(45);
  });

  it('leaves a short recording whole', () => {
    expect(cutAtPauses(tone(20))).toEqual([[0, seconds(20)]]);
  });

  it('loses no sample between pieces', () => {
    const samples = join(tone(50), silence(2), tone(70), silence(1), tone(33));
    const pieces = cutAtPauses(samples);
    expect(pieces[0][0]).toBe(0);
    expect(pieces.at(-1)[1]).toBe(samples.length);
    for (let i = 1; i < pieces.length; i += 1) expect(pieces[i][0]).toBe(pieces[i - 1][1]);
  });

  it('answers nothing for an empty recording', () => {
    expect(cutAtPauses(new Int16Array(0))).toEqual([]);
  });
});

describe('knowing whether anyone spoke', () => {
  const floorOf = (samples) => noiseFloor(samples);

  it('hears a voice over room noise', () => {
    const samples = join(noise(10, 60), tone(2), noise(10, 60));
    expect(heardSpeech(samples, floorOf(samples))).toBe(true);
  });

  it('hears nothing in room noise alone', () => {
    const room = noise(30, 60);
    expect(heardSpeech(noise(30, 60), floorOf(room))).toBe(false);
  });

  it('hears nothing in digital silence', () => {
    const quiet = silence(30);
    expect(heardSpeech(quiet, floorOf(quiet))).toBe(false);
  });

  it('does not take a click for a voice', () => {
    const samples = join(noise(10, 60), tone(0.05), noise(10, 60));
    expect(heardSpeech(samples, floorOf(samples))).toBe(false);
  });

  // A quiet room's floor is near silence, and the ear of the rule must not be set by it alone.
  it('does not take a faint hiss for a voice just because the room was silent', () => {
    const samples = join(silence(20), noise(5, 8));
    expect(heardSpeech(samples, floorOf(samples))).toBe(false);
  });
});

describe('reading and writing the audio', () => {
  it('round-trips the samples', () => {
    const samples = tone(1);
    expect([...readWav(wavOf(samples)).subarray(0, 50)]).toEqual([...samples.subarray(0, 50)]);
    expect(readWav(wavOf(samples)).length).toBe(samples.length);
  });

  // Measured on what afconvert writes: a FLLR padding chunk comes before the data.
  it('finds the samples behind a chunk it does not know', () => {
    const plain = wavOf(tone(0.1));
    const padding = Buffer.concat([Buffer.from('FLLR'), Buffer.from([8, 0, 0, 0]), Buffer.alloc(8)]);
    const padded = Buffer.concat([plain.subarray(0, 36), padding, plain.subarray(36)]);
    expect(readWav(padded).length).toBe(seconds(0.1));
  });

  it('refuses what is not the format it asked for, rather than reading noise', () => {
    expect(() => readWav(Buffer.from('not a wav file at all, sorry about that'))).toThrow(/wav/i);
    const stereo = wavOf(tone(0.1));
    stereo.writeUInt16LE(2, 22);
    expect(() => readWav(stereo)).toThrow(/mono/i);
  });
});

describe('transcribing the file', () => {
  const made = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-recording-'));
    const paths = files.map((bytes, i) => { const p = path.join(dir, `part-${i}.m4a`); fs.writeFileSync(p, bytes); return p; });
    return { dir, paths };
  };
  const service = (answers) => {
    const said = [];
    return {
      said,
      open: async () => ({ transcribe: async (wav) => { said.push(readWav(wav).length); return answers.shift() ?? ''; }, close: () => { said.push('closed'); } }),
    };
  };

  it('joins the parts in order, in one file, before converting', async () => {
    const { dir, paths } = made([Buffer.from('first-'), Buffer.from('second')]);
    let joined = null;
    const convert = async (from, to) => { joined = fs.readFileSync(from, 'utf8'); fs.writeFileSync(to, wavOf(tone(5))); };
    await transcribeRecording(paths, { convert, service: service(['oi']).open, tmp: dir });
    expect(joined).toBe('first-second');
  });

  it('answers each piece with where it starts, skipping the ones nobody spoke in', async () => {
    const { dir, paths } = made([Buffer.from('x')]);
    const samples = join(noise(40, 60), tone(20), silence(1), tone(20));
    const convert = async (from, to) => fs.writeFileSync(to, wavOf(samples));
    const s = service(['primeira', 'segunda', 'terceira']);
    const out = await transcribeRecording(paths, { convert, service: s.open, tmp: dir });
    expect(out.durationMs).toBe(Math.round((samples.length / RATE) * 1000));
    expect(out.pieces.length).toBeGreaterThan(0);
    expect(out.pieces[0].atMs).toBeGreaterThan(0);
    expect(s.said.at(-1)).toBe('closed');
  });

  // Speech has gaps, which is what sets the floor, so the samples here have one.
  const spoken = (s) => join(silence(3), tone(s));

  it('leaves out a piece the model found no words in', async () => {
    const { dir, paths } = made([Buffer.from('x')]);
    const convert = async (from, to) => fs.writeFileSync(to, wavOf(spoken(17)));
    const s = service(['   ']);
    const out = await transcribeRecording(paths, { convert, service: s.open, tmp: dir });
    expect(s.said).toHaveLength(2);
    expect(out.pieces).toEqual([]);
  });

  it('closes the service and clears its files when a piece fails', async () => {
    const { dir, paths } = made([Buffer.from('x')]);
    const convert = async (from, to) => fs.writeFileSync(to, wavOf(spoken(17)));
    let closed = false;
    const broken = async () => ({ transcribe: async () => { throw new Error('the model stopped'); }, close: () => { closed = true; } });
    await expect(transcribeRecording(paths, { convert, service: broken, tmp: dir })).rejects.toThrow('the model stopped');
    expect(closed).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('mercury-recording-'))).toEqual([]);
  });

  it('never opens the service for a recording with nothing to hear', async () => {
    const { dir, paths } = made([Buffer.from('x')]);
    const convert = async (from, to) => fs.writeFileSync(to, wavOf(silence(30)));
    let opened = false;
    const out = await transcribeRecording(paths, { convert, service: async () => { opened = true; throw new Error('no'); }, tmp: dir });
    expect(opened).toBe(false);
    expect(out.pieces).toEqual([]);
  });

  // What this Mac's own converter does with what a browser's recorder writes.
  it.runIf(process.platform === 'darwin')('reads a real file through the Mac\'s own converter', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-recording-'));
    const input = path.join(dir, 'in.m4a');
    fs.writeFileSync(path.join(dir, 'in.wav'), wavOf(join(silence(2), tone(2))));
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', path.join(dir, 'in.wav'), input]);
    const s = service(['ok']);
    const out = await transcribeRecording([input], { service: s.open, tmp: dir });
    expect(Math.abs(out.durationMs - 4000)).toBeLessThan(200);
    expect(out.pieces).toEqual([{ atMs: 0, text: 'ok' }]);
  });
});
