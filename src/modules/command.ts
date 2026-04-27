import { spawnSync } from 'child_process';
import { resolveProjectPath, capOutput, PROJECT_ROOT, parseCommandString } from './utils.js';

export function toolRunCommand(args: {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}): object {
  const { command, cwd, timeoutMs = 30000 } = args;
  const resolvedCwd = cwd ? resolveProjectPath(cwd) : PROJECT_ROOT;

  const { command: cmd, args: cmdArgs } = parseCommandString(command);
  if (!cmd) {
    return { stdout: '', stderr: 'Empty command', exitCode: -1, success: false };
  }

  try {
    const r = spawnSync(cmd, cmdArgs, {
      shell: false,
      cwd: resolvedCwd,
      timeout: timeoutMs,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
    });

    return {
      stdout: capOutput(r.stdout ?? ''),
      stderr: capOutput(r.stderr ?? ''),
      exitCode: r.status ?? -1,
      success: (r.status ?? -1) === 0,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr: `Error spawning process: ${msg}`, exitCode: -1, success: false };
  }
}

export function toolCheckProcess(args: { processName: string }): object {
  const { processName } = args;

  try {
    const r = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], {
      shell: false,
      timeout: 10000,
      encoding: 'utf8',
    });

    if ((r.status ?? -1) !== 0) return { running: false };

    const nameLower = processName.toLowerCase();
    for (const line of (r.stdout ?? '').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split('","');
      if (parts.length < 2) continue;
      const imageName = parts[0].replace(/^"/, '').toLowerCase();
      const pid = parseInt(parts[1].replace(/"/g, ''), 10);
      if (imageName.includes(nameLower) || nameLower.includes(imageName.replace(/\.exe$/, ''))) {
        return { running: true, pid: isNaN(pid) ? undefined : pid };
      }
    }

    return { running: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { running: false, error: msg };
  }
}
