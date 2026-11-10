// Reported 2026-10-31: a Mac with a Max 20x login and a Team login ran one
// Claude thread at a time on Automatic. Reading both logins' `.claude.json`
// showed why: the Team login's organisation tier is `default_raven`, which is
// not Max. Its seat was Max 5x all along (`userRateLimitTier:
// default_claude_max_5x`), and that was never read.
//
// Since Agentbox's sync of 2026-11-09 the plan no longer sets how many agents
// run (tests/a-pro-plan-runs-as-many-agents-as-the-computer-carries.test.mts),
// so what is left of that fix is the reading: the accounts list shows a Max
// seat as Max (main/settings.mts sends `plan.max`), and keeps the
// organisation's plan as its name.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPlan } from '../main/claude-plan.mts';

let home: string;
const lay = (dir: string, account: Record<string, unknown>) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: account }));
};
const PAYING = { billingType: 'stripe_subscription' };
const TEAM_MAX_SEAT = { ...PAYING, organizationType: 'claude_team', organizationRateLimitTier: 'default_raven', userRateLimitTier: 'default_claude_max_5x', seatTier: 'team_tier_1' };
const TEAM_SEAT = { ...PAYING, organizationType: 'claude_team', organizationRateLimitTier: 'default_raven', userRateLimitTier: null };
const ENTERPRISE = { ...PAYING, organizationRateLimitTier: 'default_raven_enterprise' };

beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-seat-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('a Max seat in a Team reads as Max', () => {
  it('reads the seat as Max and keeps the organisation plan as its name', () => {
    lay(home, TEAM_MAX_SEAT);
    expect(readPlan('default', { home })).toMatchObject({ known: true, max: true, label: 'Raven', tier: 'default_raven' });
  });

  it('a Team seat that is not Max does not', () => {
    lay(home, TEAM_SEAT);
    expect(readPlan('default', { home })).toMatchObject({ known: true, max: false });
  });

  it('a Max seat whose subscription ended is not Max', () => {
    lay(home, { ...TEAM_MAX_SEAT, billingType: 'none' });
    expect(readPlan('default', { home })).toMatchObject({ ended: true, max: false });
  });

  it('Enterprise keeps its own name and is not read as Max', () => {
    lay(home, ENTERPRISE);
    expect(readPlan('default', { home })).toMatchObject({ known: true, max: false, label: 'Enterprise' });
  });
});
