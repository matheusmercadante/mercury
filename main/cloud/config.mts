// WHERE A MAC'S CLOUD RUNS ARE SET UP, AND WHETHER THEY CAN RUN AT ALL.
//
// scripts/cloud-setup.mjs writes ~/.mercury/cloud.json (the bucket, the
// runtime, the profile it signs as); it is never in git, because it names an
// AWS account. Each account's sign-in for the cloud is made and kept in the
// cloud, never on this Mac (main/cloud/logins.mts).
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { Name, envName } from '../../shared/product-name.mjs';
import { cloudFolder } from './folder.mts';
import { CLOUD_ADDRESS } from '../../shared/cloud-address.mts';
import { HOSTED_SERVICES } from '../../shared/hosted-services.mts';
import { replaceFileSync } from '../replace-file.mts';
import { cloudMachineFrom } from '../../shared/cloud-machine.mts';
import type { CloudMachine } from '../../shared/cloud-machine.mts';
import type { CloudAccountConfig } from './account.mts';
import type { CloudConfig } from './clients.mts';

type Env = NodeJS.ProcessEnv;

export { cloudFolder };

// `home` is the supervisor's own idea of the home folder (config.home), so a
// supervisor built for a test, with a home that is not the developer's, never
// reads the developer's real setup.
export function cloudConfigPath(env: Env = process.env, home: string = os.homedir()): string {
  return env[envName('CLOUD_CONFIG')] || path.join(cloudFolder(home), 'cloud.json');
}

// Either the owner's own AWS account (bucket, runtime, region), or the
// managed cloud's server (`gateway`, its address), whose key sits beside it.
export function readCloudConfig(env: Env = process.env, home: string = os.homedir()): CloudConfig | null {
  try {
    const c = JSON.parse(fs.readFileSync(cloudConfigPath(env, home), 'utf8'));
    return (c?.bucket && c?.runtimeArn && c?.region) || typeof c?.gateway === 'string' ? c : null;
  } catch {
    return null;
  }
}

/**
 * Where Agentbox Cloud is: the server's address and the database's public
 * address and key. A checkout's cloud/, this Mac's own copy, or a release's
 * baked package.json (scripts/release.mjs) can name another cloud; without
 * one it is the cloud every copy ships with (shared/cloud-address.mts), or
 * none while its switch in shared/hosted-services.mts is off.
 */
export function cloudAccountConfig(appDir: string, { home = os.homedir(), hosted = HOSTED_SERVICES }: { home?: string; hosted?: { cloud: boolean } } = {}): CloudAccountConfig | null {
  const whole = (c: Partial<CloudAccountConfig> | null | undefined): c is CloudAccountConfig => typeof c?.gateway === 'string' && typeof c.supabaseUrl === 'string' && typeof c.anonKey === 'string';
  for (const file of [path.join(appDir, 'cloud', 'cloud.public.json'), path.join(cloudFolder(home), 'cloud.public.json')]) {
    try {
      const c = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (whole(c)) return c;
    } catch { /* try the next */ }
  }
  try {
    const baked = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).bakedCloud;
    if (whole(baked)) return baked;
  } catch { /* none */ }
  return hosted.cloud ? { ...CLOUD_ADDRESS } : null;
}

export const cloudKeyPath =(env: Env = process.env, home: string = os.homedir()): string => path.join(path.dirname(cloudConfigPath(env, home)), 'cloud-key');

// WHAT THE CLOUD IMAGE SAID IT CAN DO at its last start, per cloud. A run can
// only learn it from a start, so the next run reads what the last one heard;
// an image rebuilt without something says so at its first start.
const capsPath = (env: Env, home: string) => path.join(path.dirname(cloudConfigPath(env, home)), 'cloud-image.json');
const cloudId = (config: CloudConfig | null | undefined) => String(config?.runtimeArn || config?.gateway || '');

export function imageCaps(config: CloudConfig | null | undefined, env: Env = process.env, home: string = os.homedir()): string[] {
  return heardCaps(config, env, home) ?? [];
}

// Null when this cloud has never answered a start from this Mac.
function heardCaps(config: CloudConfig | null | undefined, env: Env, home: string): string[] | null {
  try {
    const caps = JSON.parse(fs.readFileSync(capsPath(env, home), 'utf8'))[cloudId(config)]?.caps;
    return Array.isArray(caps) ? caps.filter((c) => typeof c === 'string') : null;
  } catch { return null; }
}

// What a run goes by. A cloud never heard from is tried with no repository:
// a project without one would otherwise never start the run that asks. An
// image that cannot take one refuses the start, and that answer is kept.
export function imageCapsToTry(config: CloudConfig | null | undefined, env: Env = process.env, home: string = os.homedir()): string[] {
  return heardCaps(config, env, home) ?? ['plain'];
}

interface HeardImage { caps?: string[]; at?: number; machine?: CloudMachine }

function heardImages(env: Env, home: string): Record<string, HeardImage> {
  try { return JSON.parse(fs.readFileSync(capsPath(env, home), 'utf8')) || {}; } catch { return {}; }
}

function writeHeard(all: Record<string, HeardImage>, env: Env, home: string): void {
  const file = capsPath(env, home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  replaceFileSync(tmp, file);
}

export function noteImageCaps(config: CloudConfig | null | undefined, caps: string[], env: Env = process.env, home: string = os.homedir()): void {
  const all = heardImages(env, home);
  const id = cloudId(config);
  const now = [...new Set(caps)].sort();
  if (JSON.stringify(all[id]?.caps) === JSON.stringify(now)) return;
  all[id] = { ...all[id], caps: now, at: Date.now() };
  writeHeard(all, env, home);
}

// THE MACHINE A RUN HAS on this cloud, as its sandbox measured it at its last
// start (cloud/sandbox/machine.mjs), so the next run's agent is told what it
// will really have (main/cloud/run.mts cloudNote). Null when this cloud has
// not said: its agent is told the managed cloud's machine.
export function cloudMachine(config: CloudConfig | null | undefined, env: Env = process.env, home: string = os.homedir()): CloudMachine | null {
  return cloudMachineFrom(heardImages(env, home)[cloudId(config)]?.machine);
}

export function noteCloudMachine(config: CloudConfig | null | undefined, machine: unknown, env: Env = process.env, home: string = os.homedir()): void {
  const m = cloudMachineFrom(machine);
  if (!m) return;
  const all = heardImages(env, home);
  const id = cloudId(config);
  if (JSON.stringify(all[id]?.machine) === JSON.stringify(m)) return;
  all[id] = { ...all[id], machine: m };
  writeHeard(all, env, home);
}

export function readCloudKey(env: Env = process.env, home: string = os.homedir()): string | null {
  try { return fs.readFileSync(cloudKeyPath(env, home), 'utf8').trim() || null; } catch { return null; }
}

/**
 * The server said this key is not known (it went unused, or another Mac
 * signed this one out): this Mac is signed out of the cloud, as if by its own
 * hand, so nothing keeps sending threads there with it. A key a newer sign-in
 * put in its place is left alone.
 */
export function forgetCloudKey(key: string | null | undefined, env: Env = process.env, home: string = os.homedir()): boolean {
  if (!key || readCloudKey(env, home) !== key) return false;
  fs.rmSync(cloudKeyPath(env, home), { force: true });
  if (typeof readCloudConfig(env, home)?.gateway === 'string') fs.rmSync(cloudConfigPath(env, home), { force: true });
  return true;
}

export function writeCloudKey(key: string, env: Env = process.env, home: string = os.homedir()): void {
  const file = cloudKeyPath(env, home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, key, { mode: 0o600 });
  replaceFileSync(tmp, file);
}

// The keychain service the first cloud build kept its own Claude tokens
// under. Nothing writes it now; main/cloud/logins.mts deletes what is left.
export const OLD_TOKEN_SERVICE = `${Name} cloud: Claude sign-in`;
