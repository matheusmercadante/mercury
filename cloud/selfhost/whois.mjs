// WHO A SESSION IS, for a self-hosted cloud that cannot reach the database:
// the session's signature is checked against the database's public keys (its
// JWKS), and only the people the server was set up for get in.
import crypto from 'node:crypto';

const part = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

export function jwksWhoIs({ jwks, people, issuer = null, now = Date.now }) {
  const keys = new Map();
  for (const k of jwks?.keys || []) {
    if (k?.kty === 'EC' && k.crv === 'P-256' && typeof k.kid === 'string') keys.set(k.kid, crypto.createPublicKey({ key: k, format: 'jwk' }));
  }
  if (!keys.size) throw new Error('the cloud server needs the database\'s public P-256 keys (its JWKS) to check who signs in');
  const allowed = new Set(people);
  return async (token) => {
    try {
      const [h, p, s] = String(token ?? '').split('.');
      if (!h || !p || !s) return null;
      const head = part(h);
      const key = head?.alg === 'ES256' ? keys.get(head.kid) : null;
      if (!key) return null;
      const signed = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
      if (!signed) return null;
      const c = part(p);
      if (typeof c?.exp !== 'number' || c.exp * 1000 <= now()) return null;
      if (c.role !== 'authenticated' || (issuer && c.iss !== issuer) || !allowed.has(c.sub)) return null;
      return { id: c.sub, email: typeof c.email === 'string' ? c.email : null };
    } catch {
      return null;
    }
  };
}
