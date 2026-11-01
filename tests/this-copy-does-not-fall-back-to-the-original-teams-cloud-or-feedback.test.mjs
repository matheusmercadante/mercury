// THIS COPY DOES NOT FALL BACK TO THE ORIGINAL TEAM'S CLOUD OR FEEDBACK (w-78b5ec0ef7, 2026-10-31).
//
// This fork is used by one person. With nothing configured, a copy run from
// source still offered a sign-in to the original team's cloud (its server and
// database, shared/cloud-address.mjs), and the Feedback card posted to that
// team's server function. Measured from this checkout:
// cloudAccountConfig(appDir) answered CLOUD_ADDRESS and feedbackUrl({}, undefined, {})
// answered FEEDBACK_ADDRESS.
//
// shared/hosted-services.mjs now switches each fallback off. Nothing behind
// it is deleted: a switch set to true brings the service back, and an address
// you configure yourself is still used with the switch off.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { HOSTED_SERVICES } from '../shared/hosted-services.mjs';
import { CLOUD_ADDRESS } from '../shared/cloud-address.mjs';
import { cloudAccountConfig } from '../main/cloud/config.mjs';
import { FEEDBACK_ADDRESS, feedbackUrl, sendFeedback } from '../main/feedback.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ON = { cloud: true, feedback: true };
const OFF = { cloud: false, feedback: false };

const emptyFolder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-'));
const folderWithCloud = (cloud) => {
  const dir = emptyFolder();
  fs.mkdirSync(path.join(dir, 'cloud'));
  fs.writeFileSync(path.join(dir, 'cloud', 'cloud.public.json'), JSON.stringify(cloud));
  return dir;
};
const ownCloud = { gateway: 'https://gateway.mine.example', supabaseUrl: 'https://mine.supabase.co', anonKey: 'anon-mine' };

describe('the switches this copy ships with', () => {
  it('has the original team cloud and feedback off', () => {
    expect(HOSTED_SERVICES).toEqual({ cloud: false, feedback: false });
    expect(Object.isFrozen(HOSTED_SERVICES)).toBe(true);
  });
});

describe('the cloud', () => {
  it('is not offered from a checkout with nothing configured', () => {
    expect(cloudAccountConfig(emptyFolder(), { home: emptyFolder() })).toBeNull();
  });

  it('is not what a release of this checkout would bake in', () => {
    // scripts/release.mjs bakes cloudAccountConfig(repo) into the packaged app.
    const home = emptyFolder();
    const mine = path.join(repo, 'cloud', 'cloud.public.json');
    expect(fs.existsSync(mine)).toBe(false);
    expect(cloudAccountConfig(repo, { home })).toBeNull();
  });

  it('comes back when its switch is on', () => {
    expect(cloudAccountConfig(emptyFolder(), { home: emptyFolder(), hosted: ON })).toEqual(CLOUD_ADDRESS);
  });

  it('is still one you configured yourself with the switch off', () => {
    expect(cloudAccountConfig(folderWithCloud(ownCloud), { home: emptyFolder(), hosted: OFF })).toEqual(ownCloud);
  });

  it('is not a half-written file of yours', () => {
    expect(cloudAccountConfig(folderWithCloud({ gateway: 'https://gateway.mine.example' }), { home: emptyFolder(), hosted: OFF })).toBeNull();
  });
});

describe('feedback', () => {
  it('has nowhere to go from a checkout with nothing configured', () => {
    expect(feedbackUrl({}, undefined, {})).toBeNull();
    expect(feedbackUrl({}, null, {}, OFF)).toBeNull();
  });

  it('says so rather than sending anywhere', async () => {
    const calls = [];
    const out = await sendFeedback({ url: feedbackUrl({}, undefined, {}), payload: { text: 'hi', files: [] }, fetchImpl: async (u) => { calls.push(u); return { ok: true }; } });
    expect(out.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('goes to the original team again when its switch is on', () => {
    expect(feedbackUrl({}, null, {}, ON)).toBe(FEEDBACK_ADDRESS);
  });

  it('still goes where you point it with the switch off', () => {
    expect(feedbackUrl({ feedbackUrl: 'https://mine.example/f' }, null, {}, OFF)).toBe('https://mine.example/f');
    expect(feedbackUrl({}, 'https://baked.example/f', {}, OFF)).toBe('https://baked.example/f');
  });

  it('is not offered on screen when it has nowhere to go', () => {
    const ipc = fs.readFileSync(path.join(repo, 'main', 'ipc.mjs'), 'utf8');
    expect(ipc).toMatch(/feedback: !!feedbackUrl\(config\)/);
    const app = fs.readFileSync(path.join(repo, 'renderer', 'src', 'App.tsx'), 'utf8');
    expect(app).not.toMatch(/onFeedback=\{\(\) => setFeedbackOpen\(true\)\}/);
    expect(app.match(/onFeedback=\{openFeedback\}/g)).toHaveLength(2);
  });
});
