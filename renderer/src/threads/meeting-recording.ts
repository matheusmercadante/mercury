// WHAT MAKES A MEETING ON THE PHONE DIFFERENT FROM A VOICE NOTE. The recorder is
// the same (team/voice-recording.ts); this says how long it may run, what it
// writes, and how the file goes up. The other end is main/meetings.mts.
import type { PendingAttachment } from '../attachments';
import { clock } from '../meeting-card';
import { phoneMicRefusal } from '../phone-mic';
import type { Recorded, RecordingLimits } from '../team/voice-recording';

export const MEETING_KEY = 'phone:meeting';
export const MEETING_MAX_MS = 4 * 3_600_000;
// Under the 25 MB a file the phone's storage takes.
export const PART_BYTES = 24 * 1024 * 1024;

export const MEETING_CAPTURE = {
  // What the Mac's own converter reads; it refuses WebM.
  types: ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4'],
  // About 22 MB an hour, plenty for speech.
  bits: 48_000,
  // A phone on a table should hear the room, not be tuned to one mouth.
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
};

export const MEETING_LIMITS: RecordingLimits = {
  maxMs: MEETING_MAX_MS,
  name: (_ms, ext) => `meeting.${ext}`,
  refused: phoneMicRefusal,
  atLimit: () => 'Recordings stop at 4 hours. This one is ready to send.',
  lost: (ms) => `The microphone stopped, so the recording ends at ${clock(ms)}. It is ready to send.`,
  recovered: (n) => (n === 1 ? 'A meeting you were recording when the app closed was kept. It is ready to send.' : `${n} meetings you were recording when the app closed were kept.`),
};

/** The recording as attachments: one file, or slices that join back into it. */
export async function meetingAttachments(note: Recorded, pack: (blob: Blob) => Promise<string>, partBytes = PART_BYTES): Promise<PendingAttachment[]> {
  const size = note.blob.size;
  const common = { image: false, draftId: note.draftId };
  if (size <= partBytes) return [{ name: note.name, dataBase64: note.dataBase64, size, ...common }];
  const dot = note.name.lastIndexOf('.');
  const out: PendingAttachment[] = [];
  for (let at = 0, n = 1; at < size; at += partBytes, n += 1) {
    const part = note.blob.slice(at, at + partBytes);
    out.push({ name: `${note.name.slice(0, dot)}-${n}${note.name.slice(dot)}`, dataBase64: await pack(part), size: part.size, ...common });
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function meetingTitle(at: number): string {
  const d = new Date(at);
  return `Meeting ${d.getDate()} ${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function awayWords(ms: number): string {
  if (ms < 60_000) return `about ${Math.round(ms / 1000)} seconds`;
  const minutes = Math.round(ms / 60_000);
  return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
}
