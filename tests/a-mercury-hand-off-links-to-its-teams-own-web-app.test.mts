// A MERCURY HAND-OFF LINKS TO ITS TEAM'S OWN WEB APP (sync of 2026-11-12,
// Agentbox d7040fc0).
//
// Agentbox moved a thread's link into shared/thread-link.mts, so the main
// process writes one too: "Give it to someone else" opens the task it makes
// with the thread's link (main/team/index.mts handOn). Written on Agentbox's
// address, the teammate's link would open Agentbox's web app, which has none
// of this team's threads. It goes on the team's own site, the one a file's
// link uses (linkSiteFor), and the teammate's window, which names the same
// site (threadLinksGoOn), opens it as the thread.
import { it, expect, beforeEach, afterEach, describe } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as disk from '../main/store/work-items.mts';
import { Store } from '../main/store.mts';
import { createMemoryCloud, signUpMemory, memoryBackend } from '../main/team/memory-cloud.mts';
import { createTeamService } from '../main/team/index.mts';
import { memorySession } from '../main/team/session.mts';
import { isGivenTask } from '../shared/team-rules.mts';
import { threadLinksGoOn, threadOfLink } from '../shared/thread-link.mts';

const SITE = 'https://mercury-phone.pages.dev';

async function aMac(cloud: ReturnType<typeof createMemoryCloud>, personId: string, shareSite?: string) {
  const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mercury-hand-off-'));
  const accountRoot = path.join(storeRoot, 'accounts', 'a');
  fs.mkdirSync(path.join(accountRoot, 'website'), { recursive: true });
  fs.writeFileSync(path.join(accountRoot, 'website', 'project.json'), JSON.stringify({ schemaVersion: 1, id: 'website', name: 'Website', seenBy: 'team' }));
  const store = await new Store({ storeRoot, accountId: 'a', accountRoot, products: [] }).init();
  const service = createTeamService({
    session: memorySession(() => memoryBackend(cloud, personId)),
    store, disk, accountRoot, stateFile: path.join(storeRoot, '.team-sync.json'), intervalMs: 3_600_000,
    ...(shareSite === undefined ? {} : { shareSite }),
  });
  return { personId, store, service, storeRoot };
}

type Mac = Awaited<ReturnType<typeof aMac>>;
let macs: Mac[] = [];

async function aTeam(shareSite?: string) {
  const cloud = createMemoryCloud();
  const theo = await aMac(cloud, signUpMemory(cloud, { email: 'theo@nw.test', name: 'Theo Park' }), shareSite);
  const lena = await aMac(cloud, signUpMemory(cloud, { email: 'lena@nw.test', name: 'Lena Ito' }), shareSite);
  macs = [theo, lena];
  await theo.service.signIn();
  await theo.service.createTeam('Northwind');
  await theo.service.invite('lena@nw.test');
  await lena.service.signIn();
  await lena.service.acceptInvite(theo.service.state().team!.id);
  disk.setLineAuthor(theo.personId);
  return { theo, lena };
}

async function handedOn({ theo, lena }: { theo: Mac; lena: Mac }) {
  const t = theo.store.composeItem('website', { title: 'Why does the CSV import drop rows?', body: 'Find out why rows go missing.' });
  await theo.service.handOn({ product: 'website', id: t.id, to: lena.personId });
  for (let k = 0; k < 2; k += 1) for (const m of macs) await m.service.syncNow();
  const task = lena.store.listItems().find((i) => isGivenTask(i, lena.store.listProducts().find((p) => p.slug === i.product)));
  const link = /^\[[^\]]*\]\(([^)\s]+)\)/.exec(task?.body ?? '')?.[1];
  return { t, link };
}

beforeEach(() => { disk._internals.forgetFolds(); });
afterEach(async () => {
  disk.setLineAuthor(null);
  for (const m of macs) { await m.service.signOut(); fs.rmSync(m.storeRoot, { recursive: true, force: true }); }
  macs = [];
});

describe("a Mercury hand-off's link", () => {
  it("is on the team's own web app, and the teammate's window opens it as the thread", async () => {
    const team = await aTeam(SITE);
    const { t, link } = await handedOn(team);
    expect(link).toBe(`${SITE}/t/${team.theo.personId}/${t.id}`);
    // Lena's window names her team's site, as App.tsx does from snap.team.phoneSite.
    threadLinksGoOn(SITE);
    expect(threadOfLink(link)).toEqual({ owner: team.theo.personId, id: t.id });
  });

  it("stays on Agentbox's address for a team with no site of its own", async () => {
    // The window and the main process share this module here, unlike in the
    // app; naming Agentbox's own site puts the window's choice back.
    threadLinksGoOn('https://app.agentbox.ac');
    const team = await aTeam();
    const { t, link } = await handedOn(team);
    expect(link).toBe(`https://app.agentbox.ac/t/${team.theo.personId}/${t.id}`);
  });
});
