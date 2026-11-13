// MERCURY'S OWN HOME NEVER GOES TO THE CLOUD.
//
// What was wrong (2026-11-13, the sync that brought Agentbox's key cards):
// shared/sign-in-places.mts lists the folders that hold sign-ins, and names
// Agentbox's home (~/.agentbox) but not this copy's. Mercury keeps its cloud
// key and cloud sign-ins in ~/.mercury (cloud-key, cloud-logins.json, as
// main/store/home.mts appHome names it), so a cloud run could ask for that
// folder's files as a key's source or as a file to send, and one press would
// have handed them over.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nameSlug } from '../shared/product-name.mjs';
import { pathHoldsSignIns } from '../shared/sign-in-places.mts';
import { keySource } from '../shared/cloud-key-sources.mts';
import { fileToSend } from '../shared/cloud-sent-files.mts';

let tmp: string; let home: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'own-home-')));
  home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(home, `.${nameSlug}`), { recursive: true });
  fs.writeFileSync(path.join(home, `.${nameSlug}`, 'cloud-key'), 'stand-in-cloud-key');
  fs.mkdirSync(path.join(home, `${nameSlug}-notes`), { recursive: true });
  fs.writeFileSync(path.join(home, `${nameSlug}-notes`, 'todo.txt'), 'nothing secret');
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe("this copy's own home folder holds sign-ins", () => {
  it.each([`~/.${nameSlug}/cloud-key`, `/Users/x/.${nameSlug}/cloud-logins.json`, `/Users/x/.${nameSlug.toUpperCase()}/cloud.json`])('%s holds sign-ins', (p) => {
    expect(pathHoldsSignIns(p)).toBe(true);
  });

  it('is never a place a key comes from', () => {
    expect(keySource({ place: 'file', from: `~/.${nameSlug}/cloud-key` })).toBeNull();
  });

  it('is never a file sent to a cloud thread', () => {
    expect(fileToSend(`~/.${nameSlug}/cloud-key`, { home }).error).toMatch(/holds sign-ins/);
  });

  it('leaves a folder that only has the name in it alone', () => {
    expect(pathHoldsSignIns(`~/${nameSlug}-notes/todo.txt`)).toBe(false);
    expect(fileToSend(`~/${nameSlug}-notes/todo.txt`, { home }).error).toBeUndefined();
    expect(keySource({ place: 'file', from: `~/${nameSlug}-notes/todo.txt` })).not.toBeNull();
  });
});
