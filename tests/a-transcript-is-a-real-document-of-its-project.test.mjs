// The unit tests hand `saveTranscript` a stand-in, so this one runs the real
// catalog: a transcript has to pass the catalog's own validator, be readable by
// path the way an agent reads it, and be listed in the thread's Files, which only
// counts a person's links. A try that died before its thread was made comes back
// with the same path and must not leave two catalog entries for one file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeetings, saveTranscriptIn } from '../main/meetings.mts';
import { createProject, readCreationContent, readIndex } from '../main/store/project.mjs';
import { filesInLines } from '../shared/artifact-marks.mjs';

let root;
let project;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-'));
  project = createProject('Work', root);
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const save = () => saveTranscriptIn(() => project.dir);
const doc = { title: 'Reunião de produto', path: 'transcripts/2026-11-06-1430-reuniao-de-produto.md', content: '# Reunião\n\n**You** · 00:00\nOi.\n' };

describe('a saved transcript', () => {
  it('is in the catalog as a transcript, and reads back', async () => {
    await save()(project.id, doc);
    const [entry] = readIndex(project.dir).creations.filter((c) => c.path === doc.path);
    expect(entry).toMatchObject({ kind: 'transcript', title: doc.title });
    expect(readCreationContent(project.dir, entry)).toBe(doc.content);
  });

  it('is one entry however many times it is saved', async () => {
    await save()(project.id, doc);
    await save()(project.id, { ...doc, content: 'newer' });
    const entries = readIndex(project.dir).creations.filter((c) => c.path === doc.path);
    expect(entries).toHaveLength(1);
    expect(readCreationContent(project.dir, entries[0])).toBe('newer');
  });
});

describe('the thread that reads it', () => {
  it('names the transcript the way Files counts a person\'s link', async () => {
    const stateFile = path.join(root, 'meetings.json');
    fs.writeFileSync(stateFile, JSON.stringify({ since: 0 }));
    const composeItem = vi.fn();
    const m = createMeetings({
      locate: () => ({
        status: async () => ({ ok: true, body: { meeting: { state: 'idle' }, model: {}, features: { meetings: true } } }),
        list: async () => ({ ok: true, body: { version: 1, meetings: [{ id: '1-1', title: 'Reunião de produto', timestamp_ms: 1_790_000_000_000, duration_ms: 60_000, application: null, status: 'complete', transcript_source: 'final' }] } }),
        show: async () => ({ ok: true, body: { version: 1, entries: [{ source: 'microphone', start_ms: 0, end_ms: 1, text: 'Oi.' }] } }),
        markdown: async () => ({ ok: true, body: doc.content }),
      }),
      store: { listProducts: () => [{ slug: project.id }], composeItem, fileItem: vi.fn() },
      saveTranscript: save(), wake: vi.fn(), stateFile, languages: ['pt'],
    });
    await m.tick();
    const { body } = composeItem.mock.calls[0][1];
    const files = filesInLines([{ source: 'founder', ts: 1, patch: { body } }]);
    expect(files.map((f) => f.path)).toEqual([expect.stringMatching(/^transcripts\/.*-reuniao-de-produto\.md$/)]);
  });
});
