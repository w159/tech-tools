import type { JobStatus } from './types.js';

/** Jobs sub-client: commit/install/download job polling (design doc: node-panos client contract). */
export function createJobsClient(op: (cmd: string) => Promise<unknown>) {
  async function status(id: string): Promise<JobStatus> {
    const response = (await op(`<show><jobs><id>${id}</id></jobs></show>`)) as Record<string, any>;
    const job = response?.result?.job ?? {};
    return { id, status: job.status, progress: job.progress, result: job.result };
  }

  async function wait(id: string, opts?: { timeoutMs?: number; pollMs?: number }): Promise<JobStatus> {
    const timeoutMs = opts?.timeoutMs ?? 60_000;
    const pollMs = opts?.pollMs ?? 2_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = await status(id);
      if (current.status === 'FIN') return current;
      if (Date.now() >= deadline) throw new Error(`PAN-OS job ${id} did not finish within ${timeoutMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  return { status, wait };
}
