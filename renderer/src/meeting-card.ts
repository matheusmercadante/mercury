// What the sidebar says about a recording: every state main/meetings.mts reports
// is one card with at most one button, and an idle Mercury draws none.

export interface MeetingState {
  hex: boolean;
  phase: 'idle' | 'starting' | 'recording' | 'transcribing';
  title: string | null;
  startedAt: number | null;
  product: string | null;
  problem: string | null;
  model: { from: string; to: string; size: string } | null;
  preparing: number | null;
}

export type MeetingPress = 'stop' | 'model' | 'open' | 'get';

export interface MeetingCard {
  title: string;
  text: string | null;
  live: boolean;
  clockFrom: number | null;
  press: { action: MeetingPress; label: string } | null;
  closable: boolean;
}

const NOTHING = { text: null, live: false, clockFrom: null, press: null, closable: false };

export function meetingCard(m: MeetingState | null | undefined, projectName: (slug: string) => string | null): MeetingCard | null {
  if (!m) return null;
  const where = m.product ? projectName(m.product) : null;
  if (m.phase === 'starting' || m.phase === 'recording') {
    const recording = m.phase === 'recording';
    return {
      ...NOTHING,
      title: recording ? 'Recording' : 'Starting to record',
      text: m.problem ?? ([m.title, where].filter(Boolean).join(' · ') || null),
      live: recording,
      clockFrom: recording ? m.startedAt : null,
      press: { action: 'stop', label: 'Stop' },
    };
  }
  if (m.phase === 'transcribing') return { ...NOTHING, title: 'Transcribing', text: m.problem ?? m.title };
  if (m.model) {
    return {
      ...NOTHING,
      title: 'Change Hex\'s model',
      text: `${m.model.from} does not hear all your languages. ${m.model.to} does, and Hex's dictation will use it too.`,
      press: { action: 'model', label: `Download · ${m.model.size}` },
      closable: true,
    };
  }
  if (m.preparing != null) return { ...NOTHING, title: 'Downloading the model', text: `${m.preparing} MB` };
  if (m.problem) {
    return {
      ...NOTHING,
      title: 'Could not record',
      text: m.problem,
      press: m.hex ? { action: 'open', label: 'Open Hex' } : { action: 'get', label: 'Get Hex' },
      closable: true,
    };
  }
  return null;
}

export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return hours ? `${hours}:${two(minutes)}:${two(seconds % 60)}` : `${minutes}:${two(seconds % 60)}`;
}
