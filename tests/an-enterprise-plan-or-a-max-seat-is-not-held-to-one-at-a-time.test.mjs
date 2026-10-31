// Reported 2026-10-31: a Mac with a Max 20x login and a Team login ran one
// Claude thread at a time on Automatic. Reading both logins' `.claude.json`
// showed why: the Team login's organisation tier is `default_raven`, which is
// not Max, and the smallest account decides. Its seat was Max 5x all along
// (`userRateLimitTier: default_claude_max_5x`), and that was never read. An
// Enterprise login (`default_raven_enterprise`) was held to one the same way.
// Pro, and a Team seat that is not Max, still run one at a time.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPlan, readPlans, slotsForPlans, holdsToOne, isEnterpriseTier } from '../main/claude-plan.mjs';

let home;
const lay = (dir, account) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: account }));
};
const PAYING = { billingType: 'stripe_subscription' };
const TEAM_MAX_SEAT = { ...PAYING, organizationType: 'claude_team', organizationRateLimitTier: 'default_raven', userRateLimitTier: 'default_claude_max_5x', seatTier: 'team_tier_1' };
const TEAM_SEAT = { ...PAYING, organizationType: 'claude_team', organizationRateLimitTier: 'default_raven', userRateLimitTier: null };
const ENTERPRISE = { ...PAYING, organizationRateLimitTier: 'default_raven_enterprise' };
const PRO = { ...PAYING, organizationType: 'claude_pro', organizationRateLimitTier: 'default_claude_pro' };
const MAX_20X = { ...PAYING, organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_20x' };

beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-seat-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('a Max seat in a Team runs what the Mac carries', () => {
  it('reads the seat as Max and keeps the organisation plan as its name', () => {
    lay(home, TEAM_MAX_SEAT);
    expect(readPlan('default', { home })).toMatchObject({ known: true, max: true, label: 'Raven', tier: 'default_raven' });
  });

  it('is not held to one, alone or beside a Max login', () => {
    lay(home, MAX_20X);
    lay(path.join(home, '.claude-team'), TEAM_MAX_SEAT);
    expect(slotsForPlans(readPlans([path.join(home, '.claude-team')], { home }), 6)).toBe(6);
    expect(slotsForPlans(readPlans(['default', path.join(home, '.claude-team')], { home }), 6)).toBe(6);
  });

  it('a Team seat that is not Max is still one at a time', () => {
    lay(home, TEAM_SEAT);
    expect(readPlan('default', { home })).toMatchObject({ known: true, max: false, enterprise: false });
    expect(slotsForPlans(readPlans(['default'], { home }), 6)).toBe(1);
  });

  it('a Max seat whose subscription ended has no say', () => {
    lay(home, { ...TEAM_MAX_SEAT, billingType: 'none' });
    expect(readPlan('default', { home })).toMatchObject({ ended: true, max: false });
  });
});

describe('Enterprise runs what the Mac carries and keeps its own name', () => {
  it('reads as Enterprise, not as Max', () => {
    lay(home, ENTERPRISE);
    expect(readPlan('default', { home })).toMatchObject({ known: true, max: false, enterprise: true, label: 'Enterprise' });
  });

  it('is not held to one', () => {
    lay(home, ENTERPRISE);
    expect(slotsForPlans(readPlans(['default'], { home }), 6)).toBe(6);
  });

  it('enterprise is a whole word', () => {
    expect(isEnterpriseTier('default_raven_enterprise')).toBe(true);
    expect(isEnterpriseTier('claude_enterprise')).toBe(true);
    expect(isEnterpriseTier('default_raven')).toBe(false);
    expect(isEnterpriseTier('enterprisey_thing')).toBe(false);
    expect(isEnterpriseTier(null)).toBe(false);
  });
});

describe('Pro still holds every login to one, and is the one named', () => {
  it('Pro beside Enterprise or a Max seat is one at a time', () => {
    lay(home, PRO);
    lay(path.join(home, '.claude-ent'), ENTERPRISE);
    lay(path.join(home, '.claude-team'), TEAM_MAX_SEAT);
    const plans = readPlans(['default', path.join(home, '.claude-ent'), path.join(home, '.claude-team')], { home });
    expect(slotsForPlans(plans, 6)).toBe(1);
  });

  // main/config.mjs names the login that set the number, so the Agents page
  // says why it reads one.
  it('names Pro as the reason, not the Enterprise or Team login listed first', () => {
    lay(home, ENTERPRISE);
    lay(path.join(home, '.claude-team'), TEAM_MAX_SEAT);
    lay(path.join(home, '.claude-pro'), PRO);
    const plans = readPlans(['default', path.join(home, '.claude-team'), path.join(home, '.claude-pro')], { home });
    expect(plans.find(holdsToOne)?.label).toBe('Pro');
  });
});
