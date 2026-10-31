// A PHONE BUILD GOES TO TESTFLIGHT WITHOUT ASKING.
//
// The second TestFlight build (2026-10-24) was made on Expo's servers and then
// stopped short of TestFlight: "Set ascAppId in the submit profile (eas.json)
// or re-run this command in interactive mode." The first build had found the
// app through the founder's Apple sign-in, which a build started by an agent
// does not have. With the app's App Store Connect id in the submit profile, and
// the signing kept on Expo's servers since the first build, `eas build
// --auto-submit --non-interactive` reaches TestFlight on its own.
//
// That id was Agentbox's app. Mercury has no App Store Connect app yet, and a
// Mercury build must never be sent to Agentbox's, so the profile names none
// until Mercury has its own.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const eas = JSON.parse(fs.readFileSync(new URL('../mobile/eas.json', import.meta.url), 'utf8'));

describe('the phone app\'s store build', () => {
  it("is never submitted to Agentbox's app in App Store Connect", () => {
    expect(eas.submit?.production?.ios?.ascAppId).not.toBe('6826402748');
  });
  it('is a store build in the production environment, numbered by Expo', () => {
    expect(eas.build.production).toMatchObject({ distribution: 'store', autoIncrement: true, environment: 'production' });
    expect(eas.cli.appVersionSource).toBe('remote');
  });
});
