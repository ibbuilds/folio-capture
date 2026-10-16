import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';

type OwnerProbe = {
  platform?: NodeJS.Platform;
  signal?: (pid: number) => void;
  listing?: (pid: number) => string | null;
};

/** Windows can reuse a dead Node PID for a protected service and report EPERM.
 * Only a successful process listing proving a different executable releases it.
 * Permission failures or ambiguous output continue to protect the saved owner. */
export function runtimeOwnerAlive(pid: number, probe: OwnerProbe = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    if (probe.signal) probe.signal(pid);
    else process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code !== 'EPERM' || (probe.platform ?? process.platform) !== 'win32') return true;
    let listing: string | null = null;
    try {
      if (probe.listing) listing = probe.listing(pid);
      else {
        const result = spawnSync(
          join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tasklist.exe'),
          ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
          { encoding: 'utf8', windowsHide: true, timeout: 5000 },
        );
        if (result.status === 0 && !result.error) listing = result.stdout;
      }
    } catch {
      return true;
    }
    const entry = listing
      ?.split(/\r?\n/)
      .map((line) => /^"([^"\r\n]+)","(\d+)",/.exec(line))
      .find((match) => match && Number(match[2]) === pid);
    if (!entry) return true;
    return entry[1].toLowerCase() === basename(process.execPath).toLowerCase();
  }
}
