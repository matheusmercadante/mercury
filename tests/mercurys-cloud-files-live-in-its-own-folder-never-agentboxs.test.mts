// MERCURY'S CLOUD FILES LIVE IN ITS OWN FOLDER, NEVER AGENTBOX'S.
//
// Mercury never reads Agentbox's data folder or env vars (CLAUDE.md), because
// the installed Agentbox can run beside it on the same Mac. The cloud files
// (cloud.json, its key, the account's address, the hub, the saved keys,
// sign-ins and usage) were still read from ~/.agentbox and named by
// AGENTBOX_CLOUD_CONFIG and AGENTBOX_HUB: an Agentbox set up for its own cloud
// would have sent Mercury's runs there, and Mercury's cloud key would have sat
// where Agentbox reads it. Measured on a Mac whose Mercury had to be set up
// under ~/.agentbox to reach its own self-hosted cloud.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudConfigPath, readCloudConfig, cloudAccountConfig, cloudKeyPath, cloudFolder } from '../main/cloud/config.mts';
import { readHubAddress } from '../main/hub-address.mts';
import { cloudKeysPath } from '../main/cloud/keys.mts';
import { cloudLoginsPath } from '../main/cloud/logins.mts';
import { cloudUsagePath } from '../main/cloud/usage.mts';
import { nameSlug, envName } from '../shared/product-name.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const KEY = 'k'.repeat(64);
let home: string; let appDir: string;
const ours = () => path.join(home, `.${nameSlug}`);
const agentboxs = () => path.join(home, '.agentbox');
const write = (file: string, data: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); };

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-folder-')));
  appDir = path.join(home, 'app');
  fs.mkdirSync(appDir);
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('the cloud files', () => {
  it('are named in Mercury\'s own folder', () => {
    expect(cloudFolder(home)).toBe(ours());
    expect(cloudConfigPath({}, home)).toBe(path.join(ours(), 'cloud.json'));
    expect(cloudKeyPath({}, home)).toBe(path.join(ours(), 'cloud-key'));
    expect(cloudKeysPath(home)).toBe(path.join(ours(), 'cloud-keys.json'));
    expect(cloudLoginsPath(home)).toBe(path.join(ours(), 'cloud-logins.json'));
    expect(cloudUsagePath({ home })).toBe(path.join(ours(), 'cloud-usage.jsonl'));
  });

  it('are read from Mercury\'s folder, and a copy in Agentbox\'s is not read', () => {
    write(path.join(agentboxs(), 'cloud.json'), { gateway: 'http://agentboxs.example' });
    write(path.join(agentboxs(), 'cloud.public.json'), { gateway: 'http://agentboxs.example', supabaseUrl: 'https://a.example', anonKey: 'a' });
    write(path.join(agentboxs(), 'hub.json'), { url: 'https://hub.agentboxs.example', key: KEY });
    expect(readCloudConfig({}, home)).toBe(null);
    expect(cloudAccountConfig(appDir, { home, hosted: { cloud: false } })).toBe(null);
    expect(readHubAddress({}, home)).toBe(null);

    write(path.join(ours(), 'cloud.json'), { gateway: 'http://ours.example' });
    write(path.join(ours(), 'cloud.public.json'), { gateway: 'http://ours.example', supabaseUrl: 'https://o.example', anonKey: 'o' });
    write(path.join(ours(), 'hub.json'), { url: 'https://hub.ours.example', key: KEY });
    expect(readCloudConfig({}, home)).toEqual({ gateway: 'http://ours.example' });
    expect(cloudAccountConfig(appDir, { home, hosted: { cloud: false } })).toMatchObject({ gateway: 'http://ours.example' });
    expect(readHubAddress({}, home)).toMatchObject({ url: 'https://hub.ours.example' });
  });

  it('are named by Mercury\'s env vars, and Agentbox\'s are not read', () => {
    const elsewhere = path.join(home, 'elsewhere', 'cloud.json');
    write(elsewhere, { gateway: 'http://elsewhere.example' });
    expect(cloudConfigPath({ AGENTBOX_CLOUD_CONFIG: elsewhere }, home)).toBe(path.join(ours(), 'cloud.json'));
    expect(cloudConfigPath({ [envName('CLOUD_CONFIG')]: elsewhere }, home)).toBe(elsewhere);
    expect(readHubAddress({ AGENTBOX_HUB: 'https://hub.agentboxs.example', AGENTBOX_HUB_KEY: KEY }, home)).toBe(null);
    expect(readHubAddress({ [envName('HUB')]: 'https://hub.ours.example', [envName('HUB_KEY')]: KEY }, home)).toMatchObject({ url: 'https://hub.ours.example' });
  });

  // A project's own `.agentbox/cloud-setup.sh` is a file in its repository,
  // not Agentbox's data folder, and stays as it is.
  it('are never named under Agentbox\'s folder in the app\'s code', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(repo, dir), { withFileTypes: true })) {
        const rel = path.join(dir, e.name);
        if (e.isDirectory()) walk(rel);
        else if (/\.(mts|mjs|ts)$/.test(e.name)) {
          const text = fs.readFileSync(path.join(repo, rel), 'utf8');
          if (/['"`]\.agentbox['"`]|\bAGENTBOX_(CLOUD_CONFIG|HUB)\b/.test(text)) offenders.push(rel);
        }
      }
    };
    for (const dir of ['main', 'shared', 'mcp', 'bin']) walk(dir);
    expect(offenders).toEqual([]);
  });
});
