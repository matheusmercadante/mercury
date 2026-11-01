// MERCURY IS A FORK OF AGENTBOX, AND THE AGENTBOX IT CAME FROM IS STILL
// INSTALLED AND RUNNING ON THE SAME MAC.
//
// Measured on 2026-10-31, from a thread the installed Agentbox started: its
// data folder is ~/Library/Application Support/Agentbox, its store is
// ~/Agentbox, and every process it starts inherits AGENTBOX_HOME, POWERUP_HOME,
// ASTRAL_HOME and ZERO_HOME, all four set to ~/Agentbox. Upstream keeps those
// old names in WAS so its own renames find the data an install already has. A
// fork that kept them would read POWERUP_HOME when started from an Agentbox
// terminal and run a second supervisor on Agentbox's store, and its single-
// instance lock would sit in a different folder, so nothing would stop it.
// Packed, it would also update itself from Agentbox's release feed and install
// Agentbox over Mercury.app.
//
// So: no name of Agentbox's is read for data, env or a folder, the bundle and
// the update feed are Mercury's own, and the branches Mercury makes are the
// ones it recognises.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME, WAS, nameSlug, readEnv, envNames } from '../shared/product-name.mjs';
import { appHome, defaultStoreRoot, storeRootEnv } from '../main/store/home.mjs';
import { JOIN_SCHEME, JOIN_SITE } from '../shared/room-links.mjs';
import { SHIPPED_FROM } from '../main/ship-conflict-brief.mjs';
import { ticketReference, ticketPieces } from '../renderer/src/ticket-references';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
const AGENTBOX_NAMES = ['Agentbox', 'Powerup', 'Astral', 'Zero'];
// What the installed Agentbox exports into every thread, as measured.
const AGENTBOX_ENV = {
  AGENTBOX_HOME: '/Users/you/Agentbox',
  POWERUP_HOME: '/Users/you/Agentbox',
  ASTRAL_HOME: '/Users/you/Agentbox',
  ZERO_HOME: '/Users/you/Agentbox',
};

describe('the name', () => {
  it('is Mercury, on the bundle and the command', () => {
    expect(NAME).toBe('Mercury');
    expect(nameSlug).toBe('mercury');
    expect(pkg.productName).toBe('Mercury');
    expect(pkg.build.productName).toBe('Mercury');
    expect(pkg.name).toContain('mercury');
    expect(Object.keys(pkg.bin)).toEqual(['mercury']);
    expect(fs.existsSync(path.join(repo, pkg.bin.mercury))).toBe(true);
  });

  it('has the store server script under the name the supervisor asks for', () => {
    expect(fs.existsSync(path.join(repo, 'mcp', `${nameSlug}-mcp.sh`))).toBe(true);
  });
});

describe("Agentbox's store root", () => {
  it('is not read from any of the variables Agentbox exports', () => {
    expect(readEnv('HOME', AGENTBOX_ENV)).toBeUndefined();
  });

  it("is overruled by Mercury's own variable", () => {
    expect(readEnv('HOME', { ...AGENTBOX_ENV, MERCURY_HOME: '/Users/you/Mercury' })).toBe('/Users/you/Mercury');
  });

  it('is not handed on to what Mercury starts', () => {
    expect(envNames('HOME')).toEqual(['MERCURY_HOME']);
    expect(Object.keys(storeRootEnv('/Users/you/Mercury'))).toEqual(['MERCURY_HOME']);
  });

  it('is not taken from an Agentbox dot-folder in the home', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mercury-beside-'));
    try {
      for (const was of AGENTBOX_NAMES) fs.mkdirSync(path.join(home, `.${was.toLowerCase()}`));
      expect(appHome(home, { platform: 'darwin', env: {} })).toBe(path.join(home, '.mercury'));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('is a folder of its own by default', () => {
    expect(defaultStoreRoot({ home: '/Users/you', platform: 'darwin', env: {} })).toBe('/Users/you/Mercury');
    expect(defaultStoreRoot({ home: '/home/you', platform: 'linux', env: {} })).toBe('/home/you/.local/share/mercury');
  });
});

describe("Agentbox's data folder", () => {
  // main/main.mjs walks WAS for an older Chromium data folder, and that folder
  // holds the single-instance lock.
  it('is not on the list of names Mercury falls back to', () => {
    for (const was of AGENTBOX_NAMES) expect(WAS).not.toContain(was);
  });
});

describe('the bundle', () => {
  it('has an id of its own, so macOS keeps it apart from Agentbox.app', () => {
    expect(pkg.build.appId).not.toBe('ac.astral.app');
    expect(pkg.build.appId).toMatch(/mercury$/);
  });

  it("updates from Mercury's releases and never from Agentbox's", () => {
    expect(pkg.build.publish).toEqual([{ provider: 'github', owner: 'matheusmercadante', repo: 'mercury' }]);
  });

  it('answers links on its own scheme', () => {
    expect(JOIN_SCHEME).toBe('mercury');
    expect(pkg.build.protocols).toEqual([{ name: 'Mercury', schemes: ['mercury'] }]);
  });

  // The invite page exists only on Agentbox's site. A link built from the name
  // would hand an invite token to whoever owns mercury.ac.
  it("sends invite links to the page that exists, not a domain made from the name", () => {
    expect(JOIN_SITE).toBe('https://agentbox.ac/join/');
  });
});

describe('the branches Mercury makes', () => {
  it('are recognised as threads', () => {
    expect(ticketReference('mercury/w-0123456789')).toBe('w-0123456789');
    expect(ticketReference('w-0123456789')).toBe('w-0123456789');
    expect(ticketPieces('shipped mercury/w-0123456789 today').map((p) => p.id).filter(Boolean)).toEqual(['w-0123456789']);
  });

  it("do not include Agentbox's, whose threads are not in this inbox", () => {
    expect(ticketReference('agentbox/w-0123456789')).toBeNull();
    expect(ticketPieces('shipped agentbox/w-0123456789 today').map((p) => p.id).filter(Boolean)).toEqual([]);
  });

  it("are the ones a ship merge names", () => {
    expect('Merge origin/main into mercury/w-0123456789'.match(SHIPPED_FROM)?.[1]).toBe('w-0123456789');
    expect('Merge origin/main into agentbox/w-0123456789'.match(SHIPPED_FROM)).toBeNull();
  });
});

// The phone app's defaults were Agentbox's own: its App Store bundle id, its
// Expo account and project, and its App Store Connect app, so a Mercury build
// or submit would have gone to Agentbox's.
describe('the phone app', () => {
  const ENV = ['MOBILE_BUNDLE_ID', 'EAS_PROJECT_ID', 'EAS_OWNER'];

  it('is its own app, not built or sent to Agentbox\'s accounts', async () => {
    const held = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    for (const k of ENV) delete process.env[k];
    try {
      const { default: config } = await import('../mobile/app.config.ts');
      expect(config.name).toBe('Mercury');
      expect(config.ios.bundleIdentifier).toBe(pkg.build.appId);
      expect(config.android.package).toBe(pkg.build.appId);
      expect(config.owner).toBeUndefined();
      expect(config.extra.eas.projectId).toBeUndefined();
    } finally {
      for (const [k, v] of Object.entries(held)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    const eas = JSON.parse(fs.readFileSync(path.join(repo, 'mobile', 'eas.json'), 'utf8'));
    expect(eas.submit?.production?.ios?.ascAppId).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(path.join(repo, 'mobile', 'package.json'), 'utf8')).name).toBe('mercury-mobile');
  });
});
