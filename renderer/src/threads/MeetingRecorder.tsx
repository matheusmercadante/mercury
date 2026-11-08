// RECORDING A MEETING ON THE PHONE, at the foot of the new-thread page: a row to
// press, then the same row dictation draws while it listens. When it stops the
// recording is an attachment of the thread, and the Mac makes it words.
import { useEffect } from 'react';
import type { PendingAttachment } from '../attachments';
import { RecordIcon } from '../components/SidebarMeeting';
import { Level } from '../components/WebDictation';
import { clock } from '../meeting-card';
import { toBase64, useVoiceRecorder } from '../team/useVoiceRecorder';
import { awayWords, meetingAttachments, MEETING_CAPTURE, MEETING_KEY, MEETING_LIMITS } from './meeting-recording';

// An installed web app loses the microphone when it is put away, a Safari tab
// reportedly keeps it, and neither tells the page which happened.
const AWAY_MATTERS_MS = 3000;

function useScreenStaysOn(on: boolean, say: (text: string) => void) {
  useEffect(() => {
    if (!on) return undefined;
    let lock: { release: () => Promise<void> } | null = null;
    let hiddenAt = 0;
    const take = () => { void navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {}); };
    const seen = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      take();
      if (hiddenAt && Date.now() - hiddenAt > AWAY_MATTERS_MS) say(`The phone may not have heard ${awayWords(Date.now() - hiddenAt)} while this screen was away.`);
      hiddenAt = 0;
    };
    take();
    document.addEventListener('visibilitychange', seen);
    return () => {
      document.removeEventListener('visibilitychange', seen);
      void lock?.release().catch(() => {});
    };
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function MeetingRecorder({ onSay, onRecorded }: {
  onSay: (text: string) => void;
  onRecorded: (files: PendingAttachment[], startedAt: number) => void;
}) {
  const voice = useVoiceRecorder({
    key: MEETING_KEY,
    capture: MEETING_CAPTURE,
    limits: MEETING_LIMITS,
    onSay,
    onDone: (note) => { void meetingAttachments(note, toBase64).then((files) => onRecorded(files, note.startedAt)); },
  });
  useScreenStaysOn(voice.phase === 'recording', onSay);

  if (voice.phase === 'idle') {
    return <button type="button" className="tc-icon tc-record" title="Record meeting" aria-label="Record meeting" onClick={voice.start}><RecordIcon /></button>;
  }
  const listening = voice.phase === 'recording';
  return (
    <span className="dictate-row tc-recording" role="status">
      <span className="dictate-dot" aria-hidden="true" />
      <Level level={voice.levels.at(-1) ?? 0} />
      <span className="dictate-word">{listening ? `${clock(voice.elapsed)} · Keep this screen on` : 'Starting'}</span>
      <button type="button" className="dictate-button strong" aria-label="Stop recording" disabled={!listening} onClick={voice.stop}>Stop</button>
    </span>
  );
}
