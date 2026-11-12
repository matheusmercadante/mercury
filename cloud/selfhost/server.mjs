// A SELF-HOSTED CLOUD: the managed cloud's server (cloud/gateway/) on a machine
// of the owner's own, for the people it is set up for. A Mac reaches it as it
// reaches the managed cloud (~/.mercury/cloud.json names it as `gateway`).
// What AWS did is here: the bucket on this machine's disk, a container of the
// sandbox image a session, the clock's sweeps, and a door that checks the
// database's signature. Paying, the phone and teams are not.
//
//   node cloud/selfhost/server.mjs /path/to/config.json
//
// docs/cloud/SELF-HOSTED.md has the config and how to set a machine up.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway, gatewayRequestHandler } from '../gateway/gateway.mjs';
import { PLANS } from '../gateway/plans.mjs';
import { fileBucket } from './bucket.mjs';
import { dockerCli, dockerSessions } from './sessions.mjs';
import { jwksWhoIs } from './whois.mjs';

const MINUTE = 60_000;
// As the managed cloud's clock: the gateway's sweep every 5 minutes.
const EVERY = { gateway: 5 * MINUTE, sessions: MINUTE, bucket: 60 * MINUTE };

/** The one plan a self-hosted cloud gives: as many agents at once as the machine holds, and no hours to run out of. */
export const selfPlans = (agents) => Object.freeze({ none: PLANS.none, self: Object.freeze({ agents, hoursPerMonth: 1_000_000 }) });

export async function selfHostedCloud({ dataDir, secret, publicUrl, jwks, people, issuer = null, sessions, agents, now = Date.now, log = () => {} }) {
  if (!Array.isArray(people) || !people.length) throw new Error('a self-hosted cloud needs the people it is for');
  if (!(agents >= 1)) throw new Error('a self-hosted cloud needs how many agents run at once');
  let gw = null;
  const bucket = fileBucket({ dir: path.join(dataDir, 'objects'), secret, baseUrl: publicUrl, now, log, onCreated: (key) => gw.objectCreated(key) });
  gw = createGateway({
    agentcore: sessions,
    links: bucket.links,
    removeObject: bucket.removeObject,
    objects: bucket.objects,
    whoIs: jwksWhoIs({ jwks, people, issuer, now }),
    plans: selfPlans(agents),
    now,
    log,
  });
  for (const person of people) await gw.admin({ do: 'plan', person, plan: 'self' });
  const answer = gatewayRequestHandler(gw);
  const handler = (req, res) => { if (!bucket.handle(req, res)) answer(req, res); };

  const timers = [];
  function every(ms, what, fn) {
    let busy = false;
    const t = setInterval(async () => {
      if (busy) return;
      busy = true;
      try { await fn(); } catch (err) { log(`the ${what} sweep failed: ${err?.message || err}`); } finally { busy = false; }
    }, ms);
    t.unref();
    timers.push(t);
  }
  const startTimers = () => {
    every(EVERY.gateway, 'cloud', () => gw.sweep());
    every(EVERY.sessions, 'session', () => sessions.sweep());
    every(EVERY.bucket, 'bucket', () => bucket.sweep());
  };
  const stopTimers = () => { for (const t of timers.splice(0)) clearInterval(t); };
  return { handler, gw, bucket, startTimers, stopTimers };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Where a session's container answers: its address on the sessions' network, asked of docker. */
export function containerAddress({ docker, network, port = 8080, ttlMs = 30_000, now = Date.now }) {
  const seen = new Map();
  return async (name) => {
    const hit = seen.get(name);
    if (hit && now() - hit.at < ttlMs) return hit.url;
    const out = await docker(['inspect', '--format', `{{(index .NetworkSettings.Networks ${JSON.stringify(network)}).IPAddress}}`, name]);
    const ip = out.code === 0 ? out.stdout.trim() : '';
    if (!ip) { seen.delete(name); return `http://${name}.invalid:${port}`; }
    const url = `http://${ip}:${port}`;
    seen.set(name, { url, at: now() });
    return url;
  };
}

async function main(file) {
  if (!file) throw new Error('usage: node cloud/selfhost/server.mjs /path/to/config.json');
  const c = readJson(file);
  const log = (m) => console.log(m);
  const docker = dockerCli();
  const box = c.sandbox || {};
  const sessions = dockerSessions({
    docker, image: box.image, network: box.network, memory: box.memory, cpus: box.cpus, pids: box.pids, runtime: box.runtime || null, addHosts: box.addHosts || [],
    addressOf: containerAddress({ docker, network: box.network }),
    log,
  });
  const cloud = await selfHostedCloud({
    dataDir: c.dataDir,
    secret: fs.readFileSync(c.secretFile, 'utf8').trim(),
    publicUrl: c.publicUrl,
    jwks: readJson(c.jwksFile),
    people: c.people,
    issuer: c.issuer || null,
    agents: c.agents,
    sessions,
    log,
  });
  const servers = await Promise.all((c.listen || []).map(({ host, port }) => new Promise((resolve, reject) => {
    const s = http.createServer(cloud.handler);
    s.once('error', reject);
    s.listen(port, host, () => { log(`the self-hosted cloud is listening on ${host}:${port}`); resolve(s); });
  })));
  if (!servers.length) throw new Error('the config names nowhere to listen (listen: [{ host, port }])');
  cloud.startTimers();
  const stop = () => { cloud.stopTimers(); for (const s of servers) s.close(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv[2] || process.env.MERCURY_CLOUD_CONFIG).catch((err) => { console.error(err?.message || err); process.exit(1); });
}
