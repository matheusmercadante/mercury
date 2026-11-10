// A MERCURY THREAD'S LINK GOES ON ITS TEAM'S OWN WEB APP.
//
// Agentbox's Share… (synced 2026-11-10, Agentbox a3c6f7c9) copies
// https://app.agentbox.ac/t/<owner>/<thread>. Mercury's team lives in its own
// database behind its own web app (phoneSite in cloud/team.config.json, the
// one a file's link already uses through main/file-link.mts linkSiteFor), so
// that address would open Agentbox's web app, which has none of this team's
// threads and offers to open them in Agentbox. The window names its team's
// site, and a link on it is made, and recognised, as ours.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { threadLink, threadOfLink, threadToOpen, threadLinksGoOn } from '../renderer/src/threads/share-rules.ts';
import { whereALinkGoes } from '../renderer/src/link-click.ts';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8');
const plain = { metaKey: false, ctrlKey: false, shiftKey: false };

describe("a Mercury thread's link", () => {
  it("is Agentbox's address until the window names its team's site", () => {
    expect(threadLink('p-maya', 'w-1')).toBe('https://app.agentbox.ac/t/p-maya/w-1');
  });

  it("is the team's web app once it is named, and opens the thread when clicked in the app", () => {
    threadLinksGoOn('https://mercury-phone.pages.dev/');
    const link = threadLink('p-maya', 'w-1a2b3c4d5e');
    expect(link).toBe('https://mercury-phone.pages.dev/t/p-maya/w-1a2b3c4d5e');
    expect(threadOfLink(link)).toEqual({ owner: 'p-maya', id: 'w-1a2b3c4d5e' });
    expect(threadToOpen(link, plain)).toEqual({ owner: 'p-maya', id: 'w-1a2b3c4d5e' });
    expect(whereALinkGoes(link!)).toBe('thread');
    // One made before, on Agentbox's address, still opens here.
    expect(threadOfLink('https://app.agentbox.ac/t/p-maya/w-1')).toEqual({ owner: 'p-maya', id: 'w-1' });
  });

  it('keeps the site when the window has none to name, as the phone\'s does', () => {
    threadLinksGoOn(undefined);
    threadLinksGoOn(null);
    threadLinksGoOn('not an address');
    expect(threadLink('p-maya', 'w-1')).toBe('https://mercury-phone.pages.dev/t/p-maya/w-1');
  });

  it('takes no plain-http site but this computer\'s stand-in, and no stranger reads as ours', () => {
    threadLinksGoOn('http://phone.example');
    expect(threadLink('p-maya', 'w-1')).toBe('https://mercury-phone.pages.dev/t/p-maya/w-1');
    expect(threadOfLink('http://mercury-phone.pages.dev/t/p-maya/w-1')).toBeNull();
    expect(threadOfLink('https://evil.example/t/p-maya/w-1')).toBeNull();
    threadLinksGoOn('http://127.0.0.1:5199');
    expect(threadLink('p-maya', 'w-1')).toBe('http://127.0.0.1:5199/t/p-maya/w-1');
    expect(threadOfLink('http://127.0.0.1:5199/t/p-maya/w-1')).toEqual({ owner: 'p-maya', id: 'w-1' });
  });

  it("goes back to Agentbox's address for a team on Agentbox's own web app", () => {
    threadLinksGoOn('https://agentbox-phone.pages.dev');
    expect(threadLink('p-maya', 'w-1')).toBe('https://app.agentbox.ac/t/p-maya/w-1');
  });

  it("is named by the Mac's window from its team, and by the web app from its own address", () => {
    expect(read('renderer/src/App.tsx')).toMatch(/threadLinksGoOn\(snap\?\.team\?\.phoneSite\)/);
    expect(read('renderer/src/main.tsx')).toMatch(/if \(cloud\) threadLinksGoOn\(location\.origin\)/);
  });
});
