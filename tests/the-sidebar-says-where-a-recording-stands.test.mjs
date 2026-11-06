// A recording is the one thing here that must never run unnoticed, and a press
// that did not start one has to say why on the spot. So every state main reports
// is one card, with at most one button, and an idle Mercury draws none.
import { describe, expect, it } from 'vitest';
import { clock, meetingCard } from '../renderer/src/meeting-card.ts';

const idle = { hex: true, phase: 'idle', title: null, startedAt: null, product: 'work', problem: null, model: null, preparing: null };
const projectName = (slug) => (slug === 'work' ? 'Work' : null);
const card = (over) => meetingCard({ ...idle, ...over }, projectName);

describe('the card', () => {
  it('is not drawn when nothing is happening, or where there is no state at all', () => {
    expect(card({})).toBe(null);
    expect(meetingCard(null, projectName)).toBe(null);
    expect(meetingCard(undefined, projectName)).toBe(null);
  });

  it('while recording, shows it live and offers Stop', () => {
    const c = card({ phase: 'recording', title: 'Design sync', startedAt: 1000 });
    expect(c).toMatchObject({ title: 'Recording', live: true, clockFrom: 1000, press: { action: 'stop', label: 'Stop' }, closable: false });
    expect(c.text).toBe('Design sync · Work');
  });

  it('counts nothing while Hex is still starting, and can still be stopped', () => {
    expect(card({ phase: 'starting' })).toMatchObject({ title: 'Starting to record', clockFrom: null, press: { action: 'stop' } });
  });

  it('while transcribing, is not live and has nothing to press', () => {
    expect(card({ phase: 'transcribing', title: 'Design sync' })).toMatchObject({ title: 'Transcribing', live: false, press: null, closable: false });
  });

  it('keeps Stop under a problem while the recording goes on', () => {
    const c = card({ phase: 'recording', title: 'Design sync', startedAt: 1, problem: 'could not stop' });
    expect(c.text).toBe('could not stop');
    expect(c.press.action).toBe('stop');
  });

  it('says Hex\'s own words when it refused, and opens Hex to fix it', () => {
    expect(card({ problem: 'Allow Hex in System Settings' })).toMatchObject({ title: 'Could not record', text: 'Allow Hex in System Settings', press: { action: 'open', label: 'Open Hex' }, closable: true });
  });

  it('offers Hex itself when it is not installed', () => {
    expect(card({ hex: false, problem: 'Meetings are recorded by Hex' })).toMatchObject({ press: { action: 'get', label: 'Get Hex' }, closable: true });
  });

  it('offers the model, saying it changes dictation too', () => {
    const c = card({ model: { from: 'Parakeet Unified', to: 'Parakeet v3', size: '720 MB' } });
    expect(c.press).toEqual({ action: 'model', label: 'Download · 720 MB' });
    expect(c.text).toContain('Parakeet v3');
    expect(c.text).toMatch(/dictation/i);
    expect(c.closable).toBe(true);
  });

  // Measured on the built card: 13px text in a 170px button, with room for about
  // 24 letters. "Download Parakeet v3 · 720 MB" lost both its ends.
  it('keeps every button short enough for the card', () => {
    const states = [
      { phase: 'recording', startedAt: 1 }, { phase: 'starting' }, { problem: 'no' }, { hex: false, problem: 'no' },
      { model: { from: 'A', to: 'Whisper large-v3-turbo', size: '845 MB' } },
    ];
    for (const state of states) expect(card(state).press.label.length).toBeLessThanOrEqual(24);
  });

  it('shows a model downloading', () => {
    expect(card({ preparing: 412 })).toMatchObject({ title: 'Downloading the model', text: '412 MB', press: null });
  });
});

describe('the clock', () => {
  it('reads minutes and seconds, and hours once there are any', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(59_999)).toBe('0:59');
    expect(clock(60_000)).toBe('1:00');
    expect(clock(754_000)).toBe('12:34');
    expect(clock(3_600_000)).toBe('1:00:00');
    expect(clock(3_725_000)).toBe('1:02:05');
  });

  it('never runs backwards when two clocks disagree', () => {
    expect(clock(-5000)).toBe('0:00');
  });
});
