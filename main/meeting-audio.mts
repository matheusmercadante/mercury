// A RECORDING MADE ON THE PHONE, TURNED INTO WORDS ON THIS MAC. The phone's file
// is one long AAC stream. Hex's headless service takes short WAV clips and has no
// voice detector of its own, so the audio is cut here into pieces at its quietest
// moments, and a piece nobody spoke in never reaches the model, which would invent
// words for it.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HexService } from './hex-meetings.mts';

export const RATE = 16_000;
const FRAME = 320;                // 20 ms
const PAUSE_FRAMES = 10;          // the 200 ms a pause is measured over
const SHORTEST_PIECE_S = 15;
const LONGEST_PIECE_S = 35;
// Past this the last stretch is not worth a cut of its own.
const LAST_PIECE_S = 45;
const SPEECH_FRAMES = 8;          // 160 ms, under which it is a click
const SPEECH_OVER_FLOOR_DB = 12;
const QUIETEST_SPEECH_DB = -50;
const SILENCE_DB = -120;
const CONVERT_MS = 10 * 60_000;

export interface Heard { durationMs: number; pieces: { atMs: number; text: string }[] }

type Convert = (from: string, to: string) => Promise<unknown>;

/** The samples of a 16-bit mono WAV, walking its chunks: afconvert puts padding before the data. */
export function readWav(buf: Buffer): Int16Array {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a wav file');
  let format = false;
  for (let at = 12; at + 8 <= buf.length;) {
    const id = buf.toString('latin1', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') {
      if (buf.readUInt16LE(at + 10) !== 1) throw new Error('a wav file that is not mono');
      if (buf.readUInt16LE(at + 22) !== 16) throw new Error('a wav file that is not 16-bit');
      format = true;
    }
    if (id === 'data') {
      if (!format) throw new Error('a wav file with no format before its data');
      const end = Math.min(buf.length, at + 8 + size);
      const bytes = buf.subarray(at + 8, end - ((end - at - 8) % 2));
      return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('a wav file with no audio in it');
}

export function wavOf(samples: Int16Array): Buffer {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(36 + samples.byteLength, 4);
  head.write('WAVEfmt ', 8, 'latin1');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'latin1');
  head.writeUInt32LE(samples.byteLength, 40);
  return Buffer.concat([head, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)]);
}

function levels(samples: Int16Array): Float64Array {
  const out = new Float64Array(Math.floor(samples.length / FRAME));
  for (let f = 0; f < out.length; f += 1) {
    let sum = 0;
    for (let i = f * FRAME; i < (f + 1) * FRAME; i += 1) sum += samples[i] * samples[i];
    out[f] = sum ? 10 * Math.log10(sum / FRAME / (32768 * 32768)) : SILENCE_DB;
  }
  return out;
}

/** The start and end sample of each piece, every sample in exactly one. */
export function cutAtPauses(samples: Int16Array): [number, number][] {
  if (!samples.length) return [];
  const db = levels(samples);
  const perSecond = RATE / FRAME;
  const cuts: number[] = [];
  let at = 0;
  while (db.length - at > LAST_PIECE_S * perSecond) {
    const from = at + SHORTEST_PIECE_S * perSecond;
    const to = at + LONGEST_PIECE_S * perSecond;
    let best = from;
    let quietest = Infinity;
    for (let f = from; f < to; f += 1) {
      let sum = 0;
      for (let i = f; i < f + PAUSE_FRAMES; i += 1) sum += db[i];
      if (sum < quietest) { quietest = sum; best = f; }
    }
    at = best + Math.floor(PAUSE_FRAMES / 2);
    cuts.push(at * FRAME);
  }
  return [...cuts, samples.length].map((end, i, all) => [i ? all[i - 1] : 0, end]);
}

/** The room's own level: what the quietest tenth of the recording sits at. */
export function noiseFloor(samples: Int16Array): number {
  const db = levels(samples).sort();
  return db.length ? db[Math.floor(db.length / 10)] : SILENCE_DB;
}

/** Whether a stretch holds at least a syllable above the room. */
export function heardSpeech(samples: Int16Array, floor: number): boolean {
  const over = Math.max(floor + SPEECH_OVER_FLOOR_DB, QUIETEST_SPEECH_DB);
  let frames = 0;
  for (const level of levels(samples)) {
    if (level > over) frames += 1;
    if (frames >= SPEECH_FRAMES) return true;
  }
  return false;
}

const afconvert: Convert = (from, to) => new Promise((resolve, reject) => {
  execFile('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', from, to], { timeout: CONVERT_MS }, (err, _out, said) => {
    if (err) reject(new Error(`this Mac could not read the recording: ${String(said || err.message).trim().slice(0, 160)}`));
    else resolve(undefined);
  });
});

/** The parts are slices of one file, so they are joined before anything reads them. */
export async function transcribeRecording(files: string[], { service, convert = afconvert, tmp = os.tmpdir() }: {
  service: () => Promise<HexService>;
  convert?: Convert;
  tmp?: string;
}): Promise<Heard> {
  const work = await fs.promises.mkdtemp(path.join(tmp, 'mercury-recording-'));
  try {
    const joined = path.join(work, 'recording.m4a');
    for (const file of files) await fs.promises.appendFile(joined, await fs.promises.readFile(file));
    const wav = path.join(work, 'recording.wav');
    await convert(joined, wav);
    const samples = readWav(await fs.promises.readFile(wav));
    const durationMs = Math.round((samples.length / RATE) * 1000);
    const floor = noiseFloor(samples);
    const spoken = cutAtPauses(samples).filter(([a, b]) => heardSpeech(samples.subarray(a, b), floor));
    if (!spoken.length) return { durationMs, pieces: [] };

    const hex = await service();
    try {
      const pieces: Heard['pieces'] = [];
      for (const [a, b] of spoken) {
        const text = (await hex.transcribe(wavOf(samples.subarray(a, b)))).trim();
        if (text) pieces.push({ atMs: Math.round((a / RATE) * 1000), text });
      }
      return { durationMs, pieces };
    } finally {
      hex.close();
    }
  } finally {
    await fs.promises.rm(work, { recursive: true, force: true });
  }
}
