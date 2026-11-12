// A SELF-HOSTED CLOUD LETS IN ONLY ITS OWNER'S SIGNED-IN SESSION.
//
// The self-hosted cloud server runs where it cannot reach the database, so it
// cannot ask the database who a session is (cloud/gateway/lambda.mjs
// supabaseWhoIs). It checks the session's signature against the database's
// public keys instead, and lets in only the people it was set up for. A token
// it took on trust would let anyone holding the database's public anon key, or
// any signed-in stranger, start runs on the owner's machine and sign-ins.
// Signed for real with a P-256 key, as the database signs.
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { jwksWhoIs } from '../cloud/selfhost/whois.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const NOW = Date.UTC(2026, 10, 12, 12);
const ISSUER = 'https://db.example.test/auth/v1';

const pair = () => crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const theirs = pair();
const other = pair();
const jwkOf = (k: crypto.KeyObject, kid: string) => ({ ...k.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' });
const jwks = { keys: [jwkOf(theirs.publicKey, 'k1')] };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims: Record<string, unknown>, { key = theirs.privateKey, kid = 'k1', alg = 'ES256' } = {}) {
  const head = `${b64({ alg, kid, typ: 'JWT' })}.${b64(claims)}`;
  const sig = crypto.sign('sha256', Buffer.from(head), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${sig}`;
}
const session = (over: Record<string, unknown> = {}) => ({ sub: OWNER, email: 'owner@example.test', role: 'authenticated', aud: 'authenticated', iss: ISSUER, exp: NOW / 1000 + 3600, ...over });

const whoIs = jwksWhoIs({ jwks, people: [OWNER], issuer: ISSUER, now: () => NOW });

describe('a self-hosted cloud\'s door', () => {
  it('lets in the owner\'s signed-in session', async () => {
    expect(await whoIs(token(session()))).toEqual({ id: OWNER, email: 'owner@example.test' });
  });

  it('keeps out a signed-in stranger, an expired session and one with no expiry', async () => {
    expect(await whoIs(token(session({ sub: STRANGER })))).toBe(null);
    expect(await whoIs(token(session({ exp: NOW / 1000 - 1 })))).toBe(null);
    expect(await whoIs(token(session({ exp: undefined })))).toBe(null);
  });

  it('keeps out the public anon key and another issuer\'s session', async () => {
    expect(await whoIs(token({ role: 'anon', iss: ISSUER, exp: NOW / 1000 + 3600 }))).toBe(null);
    expect(await whoIs(token(session({ role: 'service_role' })))).toBe(null);
    expect(await whoIs(token(session({ iss: 'https://another.example.test/auth/v1' })))).toBe(null);
  });

  it('keeps out a session signed by any other key, or not signed the way the database signs', async () => {
    expect(await whoIs(token(session(), { key: other.privateKey }))).toBe(null);
    expect(await whoIs(token(session(), { kid: 'k-unknown' }))).toBe(null);
    const unsigned = `${b64({ alg: 'none', kid: 'k1' })}.${b64(session())}.`;
    expect(await whoIs(unsigned)).toBe(null);
    const hmac = `${b64({ alg: 'HS256', kid: 'k1' })}.${b64(session())}`;
    expect(await whoIs(`${hmac}.${crypto.createHmac('sha256', 'x').update(hmac).digest('base64url')}`)).toBe(null);
  });

  it('turns away whatever is not a token at all', async () => {
    for (const t of ['', 'abc', 'a.b.c', 'Bearer x', null, undefined]) expect(await whoIs(t as string)).toBe(null);
  });
});
