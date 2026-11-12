// THE MACHINE A RUN HAS, AS THE SANDBOX MEASURES IT.
//
// A start's answer says it, and the Mac tells the next run's agent
// (main/cloud/run.mts cloudNote): a self-hosted cloud's container is not the
// managed cloud's 8 GB machine, and an agent that plans for one on the other
// is stopped by the memory guard halfway
// (tests/a-cloud-run-is-told-the-machine-it-really-has).
//
// The container's own limits when it has them (cgroup v2), else the
// machine's; the disk is what is free under the run's work folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GB = 2 ** 30;
const read = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return null; } };
const limit = (text) => (text && /^\d+$/.test(text) ? Number(text) : null);
const kb = (meminfo, field) => {
  const n = meminfo?.match(new RegExp(`^${field}:\\s+(\\d+) kB`, 'm'))?.[1];
  return n == null ? null : Number(n) * 1024;
};
// Whole gigabytes, but under two a tenth counts.
const gb = (bytes) => (bytes >= 2 * GB ? Math.round(bytes / GB) : Math.round((bytes / GB) * 10) / 10);

// The nearest folder that exists: a run's work folder is made at its first start.
function existing(dir) {
  let d = path.resolve(dir);
  while (!fs.existsSync(d) && path.dirname(d) !== d) d = path.dirname(d);
  return d;
}

export function machineSize({
  cgroup = '/sys/fs/cgroup', proc = '/proc', dir = '/tmp',
  statfs = fs.statfsSync, cpuCount = os.availableParallelism,
} = {}) {
  const meminfo = read(path.join(proc, 'meminfo'));

  const [quota, period] = (read(path.join(cgroup, 'cpu.max')) || '').split(/\s+/);
  const cores = /^\d+$/.test(quota || '') && Number(period) > 0
    ? Math.round((Number(quota) / Number(period)) * 10) / 10
    : cpuCount();

  const memory = limit(read(path.join(cgroup, 'memory.max'))) ?? kb(meminfo, 'MemTotal') ?? os.totalmem();

  const machineSwap = kb(meminfo, 'SwapTotal') ?? 0;
  const swapLimit = limit(read(path.join(cgroup, 'memory.swap.max')));
  const swap = swapLimit == null ? machineSwap : Math.min(swapLimit, machineSwap);

  let free = 0;
  try { const s = statfs(existing(dir)); free = Number(s.bavail) * Number(s.bsize); } catch { /* unknown: none counted */ }

  return { cores, memoryGB: gb(memory), swapGB: gb(swap), diskGB: Math.max(0, Math.floor(free / GB)) };
}
