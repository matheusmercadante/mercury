// THE MACHINE A CLOUD RUN HAS, as its sandbox measured it at a start
// (cloud/sandbox/machine.mjs). The Mac keeps the last one each cloud said
// (main/cloud/config.mts noteCloudMachine) and tells the next run's agent
// (main/cloud/run.mts cloudNote).
export interface CloudMachine { cores: number; memoryGB: number; swapGB: number; diskGB: number }

// The managed cloud's machine: what an agent is told when its cloud has not said.
export const MANAGED_MACHINE: CloudMachine = { cores: 2, memoryGB: 8, swapGB: 0, diskGB: 5 };

/** The machine in what a cloud said, or null when it is not one. */
export function cloudMachineFrom(raw: unknown): CloudMachine | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const n = (v: unknown, least: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= least;
  if (!n(m.cores, 0.1) || !n(m.memoryGB, 0.1) || !n(m.swapGB, 0) || !n(m.diskGB, 0)) return null;
  return { cores: m.cores, memoryGB: m.memoryGB, swapGB: m.swapGB, diskGB: m.diskGB };
}
