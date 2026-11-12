// THE BUCKET OF A SELF-HOSTED CLOUD: S3's part, on the server's own disk.
// The gateway reads the ledger through `objects`; the Mac and the sandboxes
// read and write a run's files only through `links`, which expire and open one
// key for one method, as presigned URLs do.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

const DAY_MS = 86_400_000;
// The S3 rule this replaces (scripts/cloud-setup.mjs): a run's files last a week.
const RUNS_MAX_AGE_MS = 7 * DAY_MS;
const OPS = { GET: 'get', HEAD: 'head', PUT: 'put' };

const conflict = () => Object.assign(new Error('changed meanwhile'), { conflict: true });

function segmentsOf(key) {
  const parts = typeof key === 'string' ? key.split('/') : [];
  if (!parts.length || parts.some((p) => p === '' || p === '.' || p === '..')) throw new Error(`not a key the bucket takes: ${JSON.stringify(key)}`);
  return parts;
}

export function fileBucket({ dir, secret, baseUrl, now = Date.now, onCreated = async () => {}, maxBodyBytes = 2 * 1024 ** 3, log = () => {} }) {
  if (!secret) throw new Error('the bucket needs a secret to sign its links');
  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
  const fileOf = (key) => path.join(root, ...segmentsOf(key).map(encodeURIComponent));
  const keyOf = (rel) => rel.split(path.sep).map(decodeURIComponent).join('/');

  const locks = new Map();
  const locked = (key, fn) => {
    const run = (locks.get(key) || Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
    return run;
  };

  const hashOf = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  const read = (file) => { try { return fs.readFileSync(file); } catch (err) { if (err.code === 'ENOENT') return null; throw err; } };
  const stamp = (file) => { const t = now() / 1000; fs.utimesSync(file, t, t); };
  const tmpOf = (file) => `${file}.${crypto.randomBytes(6).toString('hex')}.part`;

  function removeEmptyParents(file) {
    for (let d = path.dirname(file); d.startsWith(root + path.sep); d = path.dirname(d)) {
      try { fs.rmdirSync(d); } catch { return; }
    }
  }

  function walk(start, out = []) {
    let entries;
    try { entries = fs.readdirSync(start, { withFileTypes: true }); } catch (err) { if (err.code === 'ENOENT') return out; throw err; }
    for (const e of entries) {
      const full = path.join(start, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (!e.name.endsWith('.part')) out.push(full);
    }
    return out;
  }

  function filesUnder(prefix) {
    const whole = prefix.split('/').slice(0, -1);
    const start = whole.length ? path.join(root, ...whole.map(encodeURIComponent)) : root;
    return walk(start).map((file) => ({ file, key: keyOf(path.relative(root, file)) })).filter((f) => f.key.startsWith(prefix));
  }

  const objects = {
    async get(key) {
      const body = read(fileOf(key));
      return body ? { body: body.toString('utf8'), etag: hashOf(body) } : null;
    },
    async head(key) {
      try { return { size: fs.statSync(fileOf(key)).size }; } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
    },
    async put(key, body, { ifMatch, ifNoneMatch } = {}) {
      const file = fileOf(key);
      return locked(key, async () => {
        if (ifMatch || ifNoneMatch) {
          const cur = read(file);
          if (ifNoneMatch === '*' && cur) throw conflict();
          if (ifMatch && (!cur || hashOf(cur) !== ifMatch)) throw conflict();
        }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = tmpOf(file);
        fs.writeFileSync(tmp, body);
        fs.renameSync(tmp, file);
        stamp(file);
      });
    },
    async del(key) {
      const file = fileOf(key);
      try { fs.unlinkSync(file); } catch (err) { if (err.code !== 'ENOENT') throw err; }
      removeEmptyParents(file);
    },
    async list(prefix) { return filesUnder(prefix).map((f) => f.key); },
    async sizes(prefix, { max = Infinity } = {}) {
      const all = filesUnder(prefix).sort((a, b) => (a.key < b.key ? -1 : 1));
      const items = all.slice(0, max).map(({ file, key }) => { const s = fs.statSync(file); return { key, size: s.size, at: s.mtimeMs }; });
      return { items, truncated: all.length > max };
    },
  };

  const sign = (op, key, exp) => crypto.createHmac('sha256', secret).update(`${op}\n${key}\n${exp}`).digest('base64url');
  const link = (op) => async (key, seconds) => {
    segmentsOf(key);
    const exp = Math.floor(now() / 1000) + Math.max(1, Math.floor(seconds));
    return `${baseUrl.replace(/\/+$/, '')}/b/${encodeURIComponent(key)}?op=${op}&exp=${exp}&sig=${sign(op, key, exp)}`;
  };
  const links = { get: link('get'), put: link('put'), head: link('head') };

  function allowed(req, url, key) {
    const op = OPS[req.method];
    const exp = Number(url.searchParams.get('exp'));
    const given = Buffer.from(url.searchParams.get('sig') || '');
    if (!op || url.searchParams.get('op') !== op || !Number.isInteger(exp) || exp < now() / 1000) return null;
    const want = Buffer.from(sign(op, key, exp));
    return given.length === want.length && crypto.timingSafeEqual(given, want) ? op : null;
  }

  async function receive(req, res, key, file) {
    let size = 0;
    const tmp = tmpOf(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const cap = new Transform({ transform(chunk, _enc, done) { size += chunk.length; done(null, size > maxBodyBytes ? undefined : chunk); } });
    try {
      await pipeline(req, cap, fs.createWriteStream(tmp));
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
    if (size > maxBodyBytes) {
      fs.rmSync(tmp, { force: true });
      res.writeHead(413).end();
      return;
    }
    await locked(key, async () => { fs.renameSync(tmp, file); stamp(file); });
    if (key.startsWith('runs/') && key.endsWith('/done.json')) {
      try { await onCreated(key); } catch (err) { log(`the server did not take ${key}: ${err?.message || err}`); }
    }
    res.writeHead(200).end();
  }

  /** Answers a link's request, or returns false for a path that is not the bucket's. */
  function handle(req, res) {
    const url = new URL(req.url, 'http://bucket');
    if (!url.pathname.startsWith('/b/')) return false;
    let key; let file;
    try { key = decodeURIComponent(url.pathname.slice(3)); file = fileOf(key); } catch { res.writeHead(400).end(); return true; }
    const op = allowed(req, url, key);
    if (!op) { req.resume(); res.writeHead(403).end(); return true; }
    if (op === 'put') {
      receive(req, res, key, file).catch((err) => { log(`a write to ${key} failed: ${err?.message || err}`); if (!res.headersSent) res.writeHead(500).end(); });
      return true;
    }
    let stat;
    try { stat = fs.statSync(file); } catch { res.writeHead(404).end(); return true; }
    res.writeHead(200, { 'content-length': stat.size, 'content-type': 'application/octet-stream' });
    if (op === 'head') res.end();
    else fs.createReadStream(file).pipe(res);
    return true;
  }

  /** Removes a run's files older than a week; returns how many went. */
  async function sweep() {
    let gone = 0;
    const cutoff = now() - RUNS_MAX_AGE_MS;
    for (const { file } of filesUnder('runs/')) {
      if (fs.statSync(file).mtimeMs < cutoff) { fs.rmSync(file, { force: true }); removeEmptyParents(file); gone += 1; }
    }
    return gone;
  }

  return { objects, links, removeObject: (key) => objects.del(key), handle, sweep };
}
