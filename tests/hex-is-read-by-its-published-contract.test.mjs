// Meetings are recorded by Hex, and Mercury drives it through the command line
// Hex publishes for scripts. The replies below were copied from Hex 3.3.0 on
// 2026-11-06 (`hex status --json` with Hex stopped, `hex meetings list --json`
// and `show --json` on Hex's own sample meetings), so a change in how they are
// read fails here rather than on a person's first recording.
import { describe, expect, it, vi } from 'vitest';
import { findHex, hexCli } from '../main/hex-meetings.mts';

const NOT_RUNNING = '{\n  "version": 4,\n  "status": "error",\n  "code": "not-running",\n  "message": "Hex is not running; run `hex start`"\n}\n';
const LISTED = JSON.stringify({
  meetings: [{ application: 'Zoom', duration_ms: 40000, id: '1790000000000-1001', in_progress: false, status: 'complete', timestamp_ms: 1790000000000, title: 'Weekly sync', transcript_source: 'final', warnings: [] }],
  skipped: [], truncated: false, version: 1,
});

// `answers` maps the first words of a command to [exit code, stdout, stderr].
function fakeRun(answers) {
  return vi.fn((bin, args, options, done) => {
    const said = args.join(' ');
    const key = Object.keys(answers).find((k) => said.startsWith(k));
    const [code, out = '', err = ''] = key ? answers[key] : [1, '', `no answer for ${said}`];
    done(code === 0 ? null : Object.assign(new Error('failed'), { code }), out, err);
  });
}

describe('finding Hex', () => {
  it('is the app in Applications, then the one in the home folder', () => {
    expect(findHex({ home: '/Users/x', exists: (p) => p.startsWith('/Applications/') })).toBe('/Applications/Hex.app/Contents/MacOS/hex');
    expect(findHex({ home: '/Users/x', exists: (p) => p.startsWith('/Users/x/') })).toBe('/Users/x/Applications/Hex.app/Contents/MacOS/hex');
  });

  it('is nothing when it is not installed', () => {
    expect(findHex({ home: '/Users/x', exists: () => false })).toBe(null);
  });
});

describe('what Hex answers', () => {
  it('reads a refusal by its code and keeps Hex\'s own words', async () => {
    const run = fakeRun({ status: [3, NOT_RUNNING] });
    const out = await hexCli('/hex', { run }).status();
    expect(out).toMatchObject({ ok: false, code: 'not-running', message: 'Hex is not running; run `hex start`' });
  });

  it('takes a refusal printed on stderr just the same', async () => {
    const out = await hexCli('/hex', { run: fakeRun({ 'meetings record': [1, '', '{"version":4,"status":"error","code":"feature-off","message":"Meetings are off"}'] }) }).record();
    expect(out).toMatchObject({ ok: false, code: 'feature-off', message: 'Meetings are off' });
  });

  it('says what a command printed when the answer is not the contract', async () => {
    const out = await hexCli('/hex', { run: fakeRun({ 'meetings show': [1, '', 'hex: No meeting with id "x".'] }) }).show('x');
    expect(out).toMatchObject({ ok: false, message: 'hex: No meeting with id "x".' });
  });

  it('refuses a meeting list of a version it cannot read, rather than misreading it', async () => {
    const out = await hexCli('/hex', { run: fakeRun({ 'meetings list': [0, '{"version":2,"meetings":[]}'] }) }).list(0);
    expect(out).toMatchObject({ ok: false, code: 'version' });
  });

  it('reads the meetings of the version it knows', async () => {
    const out = await hexCli('/hex', { run: fakeRun({ 'meetings list': [0, LISTED] }) }).list(1790000000000);
    expect(out.ok).toBe(true);
    expect(out.body.meetings[0].title).toBe('Weekly sync');
  });
});

describe('what Mercury asks of Hex', () => {
  const said = (run) => run.mock.calls.map(([, args]) => args.join(' '));

  it('lists from the cursor, as many as one list can hold', async () => {
    const run = fakeRun({ 'meetings list': [0, LISTED] });
    await hexCli('/hex', { run }).list(1790000000000);
    expect(said(run)).toEqual(['meetings list --since 1790000000000 --limit 200 --json']);
  });

  it('names a recording only when there is a name', async () => {
    const run = fakeRun({ 'meetings record': [0, '{"version":4,"status":"done","changed":true}'] });
    const cli = hexCli('/hex', { run });
    await cli.record();
    await cli.record('Design sync');
    expect(run.mock.calls[0][1]).toEqual(['meetings', 'record', '--json']);
    expect(run.mock.calls[1][1]).toEqual(['meetings', 'record', '--title', 'Design sync', '--json']);
  });

  it('gives every call a deadline', async () => {
    const run = fakeRun({ '': [0, '{"version":4,"status":"done"}'] });
    const cli = hexCli('/hex', { run });
    await Promise.all([cli.status(), cli.start(), cli.record(), cli.stop(), cli.enable(), cli.models(), cli.install('parakeet_v3'), cli.open(), cli.show('a'), cli.markdown('a'), cli.list(0)]);
    expect(run.mock.calls.length).toBe(11);
    for (const [, , options] of run.mock.calls) expect(options.timeout).toBeGreaterThan(0);
  });

  it('says a call that ran out of time did so, instead of hanging or staying quiet', async () => {
    const run = vi.fn((bin, args, options, done) => done(Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }), '', ''));
    const out = await hexCli('/hex', { run }).status();
    expect(out).toMatchObject({ ok: false, code: 'timeout' });
    expect(out.message).toMatch(/did not answer/i);
  });
});
