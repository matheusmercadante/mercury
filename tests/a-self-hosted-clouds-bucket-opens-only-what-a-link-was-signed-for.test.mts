// A SELF-HOSTED CLOUD'S BUCKET OPENS ONLY WHAT A LINK WAS SIGNED FOR.
//
// The self-hosted cloud server (cloud/selfhost/) keeps a run's files on its own
// disk instead of S3, and hands out links the way S3 hands out presigned URLs:
// the Mac and the sandboxes reach the files only through them. A link that
// opened another key, another method or outlived its time would hand one run's
// bundle, or a person's sign-in, to whoever held any link at all. Driven over
// real HTTP against a folder on disk.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileBucket } from '../cloud/selfhost/bucket.mjs';

let tmp: string; let server: http.Server; let base: string; let created: string[]; let clock: number;
let bucket: ReturnType<typeof fileBucket>;

beforeEach(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'selfhost-bucket-')));
  created = [];
  clock = Date.UTC(2026, 10, 12, 12);
  server = http.createServer((req, res) => {
    if (!bucket.handle(req, res)) { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  bucket = fileBucket({ dir: path.join(tmp, 'objects'), secret: 'a-secret-only-the-server-holds', baseUrl: base, now: () => clock, onCreated: async (k: string) => { created.push(k); }, maxBodyBytes: 1024 });
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

const send = (url: string, method: string, body?: string) => fetch(url, { method, body, signal: AbortSignal.timeout(5000) });

describe('a self-hosted cloud bucket', () => {
  it('a link reads, writes and sizes its own object until it expires', async () => {
    const put = await bucket.links.put('runs/u-1/r1/bundle.json', 300);
    expect((await send(put, 'PUT', 'hello')).status).toBe(200);
    const get = await bucket.links.get('runs/u-1/r1/bundle.json', 300);
    const res = await send(get, 'GET');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello');
    const head = await send(await bucket.links.head('runs/u-1/r1/bundle.json', 300), 'HEAD');
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('5');
    expect((await send(await bucket.links.get('runs/u-1/r1/missing.json', 300), 'GET')).status).toBe(404);
    clock += 301_000;
    expect((await send(get, 'GET')).status).toBe(403);
  });

  it('a link is refused for another method, another key, or a changed time', async () => {
    await bucket.objects.put('logins/u-1/claude/L1.json', '{"token":"secret"}');
    const get = await bucket.links.get('runs/u-1/r1/a.json', 300);
    expect((await send(get, 'PUT', 'x')).status).toBe(403);
    const other = get.replace(encodeURIComponent('runs/u-1/r1/a.json'), encodeURIComponent('logins/u-1/claude/L1.json'));
    expect((await send(other, 'GET')).status).toBe(403);
    const later = new URL(get); later.searchParams.set('exp', String(Number(later.searchParams.get('exp')) + 3600));
    expect((await send(later.toString(), 'GET')).status).toBe(403);
    const unsigned = new URL(get); unsigned.searchParams.delete('sig');
    expect((await send(unsigned.toString(), 'GET')).status).toBe(403);
  });

  it('a key never reaches outside the bucket folder', async () => {
    for (const k of ['../outside.json', 'runs/../../outside.json', '/etc/passwd', '', 'runs//a.json', 'runs/./a.json']) {
      await expect(bucket.objects.put(k, 'x')).rejects.toThrow(/key/);
      await expect(bucket.links.put(k, 60)).rejects.toThrow(/key/);
    }
    expect(fs.existsSync(path.join(tmp, 'outside.json'))).toBe(false);
    // A key may hold any character a project or device name does.
    await bucket.objects.put('runs/kits/dev 1/my project/w-1.json', 'kit');
    expect((await bucket.objects.get('runs/kits/dev 1/my project/w-1.json'))?.body).toBe('kit');
  });

  it('writes are conditional, as S3 makes them, so two ledger writes cannot both land', async () => {
    await bucket.objects.put('ledger/people/p.json', 'one', { ifNoneMatch: '*' });
    await expect(bucket.objects.put('ledger/people/p.json', 'two', { ifNoneMatch: '*' })).rejects.toMatchObject({ conflict: true });
    const first = await bucket.objects.get('ledger/people/p.json');
    await bucket.objects.put('ledger/people/p.json', 'two', { ifMatch: first!.etag });
    await expect(bucket.objects.put('ledger/people/p.json', 'three', { ifMatch: first!.etag })).rejects.toMatchObject({ conflict: true });
    expect((await bucket.objects.get('ledger/people/p.json'))?.body).toBe('two');
    expect(await bucket.objects.get('ledger/people/none.json')).toBe(null);
    expect(await bucket.objects.head('ledger/people/p.json')).toEqual({ size: 3 });
  });

  it('lists and sizes by prefix, and deletes', async () => {
    for (const k of ['runs/u-1/a.json', 'runs/u-1/b/c.json', 'runs/u-2/d.json', 'ledger/x.json']) await bucket.objects.put(k, 'abcd');
    expect((await bucket.objects.list('runs/u-1/')).sort()).toEqual(['runs/u-1/a.json', 'runs/u-1/b/c.json']);
    const sized = await bucket.objects.sizes('runs/', { max: 2 });
    expect(sized.items).toHaveLength(2);
    expect(sized.truncated).toBe(true);
    expect(sized.items[0]).toMatchObject({ size: 4 });
    await bucket.removeObject('runs/u-1/a.json');
    expect(await bucket.objects.list('runs/u-1/')).toEqual(['runs/u-1/b/c.json']);
    await bucket.objects.del('runs/u-1/never-there.json');
  });

  it('a done.json under runs/ landing through a link tells the server, and nothing else does', async () => {
    await send(await bucket.links.put('runs/u-1/r1/done.json', 300), 'PUT', '{}');
    await send(await bucket.links.put('runs/u-1/r1/notes.json', 300), 'PUT', '{}');
    await send(await bucket.links.put('logins/u-1/done.json', 300), 'PUT', '{}');
    expect(created).toEqual(['runs/u-1/r1/done.json']);
  });

  it('a body over the limit is refused and writes nothing', async () => {
    const res = await send(await bucket.links.put('runs/u-1/r1/big.bin', 300), 'PUT', 'x'.repeat(2048));
    expect(res.status).toBe(413);
    expect(await bucket.objects.get('runs/u-1/r1/big.bin')).toBe(null);
  });

  it('a run\'s files go after seven days, as the S3 rule did; sign-ins and the ledger stay', async () => {
    await bucket.objects.put('runs/u-1/old/done.json', 'old');
    await bucket.objects.put('logins/u-1/claude/L1.json', 'login');
    await bucket.objects.put('ledger/people/p.json', 'rec');
    clock += 6 * 86_400_000;
    await bucket.objects.put('runs/u-1/new/done.json', 'new');
    clock += 1 * 86_400_000 + 1000;
    expect(await bucket.sweep()).toBe(1);
    expect(await bucket.objects.get('runs/u-1/old/done.json')).toBe(null);
    expect((await bucket.objects.get('runs/u-1/new/done.json'))?.body).toBe('new');
    expect((await bucket.objects.get('logins/u-1/claude/L1.json'))?.body).toBe('login');
    expect((await bucket.objects.get('ledger/people/p.json'))?.body).toBe('rec');
  });
});
