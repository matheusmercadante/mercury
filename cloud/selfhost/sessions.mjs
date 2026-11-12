// THE SESSIONS OF A SELF-HOSTED CLOUD: AgentCore's part, with one container
// of the sandbox image a session. The gateway calls `invoke` and `stop` as it
// called AgentCore; `sweep` ends what AgentCore ended on its own.
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

// AgentCore's own limits: a session idle this long, or alive this long, ends.
const IDLE_MS = 15 * 60_000;
const MAX_MS = 8 * 3_600_000;

// From the session id, so a server that started again finds its containers.
const nameOf = (sessionId) => `mercury-s-${crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 24)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The docker CLI, with a deadline on every command. */
export function dockerCli({ bin = 'docker', timeoutMs = 120_000 } = {}) {
  return (args) => new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr || err?.message || '') });
    });
  });
}

export function dockerSessions({
  docker, image, network, memory, cpus, pids, runtime = null,
  addressOf = (name) => `http://${name}:8080`,
  now = Date.now, idleMs = IDLE_MS, maxMs = MAX_MS,
  readyMs = 60_000, pollMs = 500, timeoutMs = 75_000, fetchImpl = fetch, log = () => {},
}) {
  const starting = new Map();

  async function pingOf(name) {
    try {
      const res = await fetchImpl(`${addressOf(name)}/ping`, { signal: AbortSignal.timeout(Math.min(timeoutMs, 5000)) });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  async function comesUp(name) {
    const until = Date.now() + readyMs;
    while (Date.now() < until) {
      if (await pingOf(name)) return true;
      await sleep(pollMs);
    }
    return false;
  }

  async function start(sessionId, name) {
    const seen = await docker(['inspect', '--format', '{{.State.Running}}', name]);
    if (seen.code === 0 && seen.stdout.trim() === 'true') return;
    if (seen.code === 0) await docker(['rm', '-f', name]);
    const out = await docker([
      'run', '-d', '--name', name,
      '--label', `mercury.session=${sessionId}`, '--label', `mercury.started=${now()}`,
      '--network', network,
      '--memory', memory, '--memory-swap', memory, '--cpus', String(cpus), '--pids-limit', String(pids),
      '--security-opt', 'no-new-privileges',
      ...(runtime ? ['--runtime', runtime] : []),
      image,
    ]);
    if (out.code !== 0) throw new Error(`could not start the session's container: ${out.stderr.trim()}`);
    if (!(await comesUp(name))) {
      await docker(['rm', '-f', name]);
      throw new Error(`the session's container did not come up in ${Math.round(readyMs / 1000)} s`);
    }
    log(`started ${name} for ${sessionId}`);
  }

  function ensure(sessionId, name) {
    if (!starting.has(name)) starting.set(name, start(sessionId, name).finally(() => starting.delete(name)));
    return starting.get(name);
  }

  async function invoke(sessionId, payload) {
    const name = nameOf(sessionId);
    await ensure(sessionId, name);
    const res = await fetchImpl(`${addressOf(name)}/invocations`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`the session's container answered ${res.status}`);
    return res.json();
  }

  async function stop(sessionId) {
    const out = await docker(['rm', '-f', nameOf(sessionId)]);
    if (out.code !== 0 && !/No such container/i.test(out.stderr)) throw new Error(`could not stop the session's container: ${out.stderr.trim()}`);
  }

  /** Ends sessions idle 15 minutes, alive 8 hours, or no longer answering; returns how many. */
  async function sweep() {
    const out = await docker(['ps', '-a', '--filter', 'label=mercury.session', '--format', '{{.Names}}\t{{.Label "mercury.session"}}\t{{.Label "mercury.started"}}']);
    let gone = 0;
    for (const line of out.stdout.split('\n').filter(Boolean)) {
      const [name, sessionId, started] = line.split('\t');
      let why = now() - Number(started) > maxMs ? 'ran 8 hours' : null;
      if (!why) {
        const ping = await pingOf(name);
        if (!ping) why = 'stopped answering';
        else if (ping.status !== 'HealthyBusy') {
          const at = Number(ping.time_of_last_update);
          if (now() - (at < 1e12 ? at * 1000 : at) > idleMs) why = 'idle 15 minutes';
        }
      }
      if (!why) continue;
      await docker(['rm', '-f', name]);
      gone += 1;
      log(`ended ${name} (${sessionId}): ${why}`);
    }
    return gone;
  }

  return { invoke, stop, sweep };
}
