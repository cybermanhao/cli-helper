import { spawnSync } from 'child_process';
import * as os from 'os';
import { capOutput, PROJECT_ROOT } from './utils.js';

// ─── Platform detection ───────────────────────────────────────────────────────

type OsType = 'windows' | 'macos' | 'linux';
type DesktopEnv = 'gnome' | 'kde' | 'other' | null;

interface Platform { os: OsType; desktop: DesktopEnv }

export function detectPlatform(): Platform {
  const p = process.platform;
  if (p === 'win32')  return { os: 'windows', desktop: null };
  if (p === 'darwin') return { os: 'macos',   desktop: null };
  // Linux — check XDG_CURRENT_DESKTOP and DESKTOP_SESSION
  const xdg = (process.env.XDG_CURRENT_DESKTOP ?? process.env.DESKTOP_SESSION ?? '').toLowerCase();
  const desktop: DesktopEnv = xdg.includes('gnome') || xdg.includes('unity') || xdg.includes('pantheon')
    ? 'gnome'
    : xdg.includes('kde') || xdg.includes('plasma')
    ? 'kde'
    : 'other';
  return { os: 'linux', desktop };
}

// ─── Low-level command runner ─────────────────────────────────────────────────

export function runCmd(
  cmd: string,
  args_: string[],
  timeoutMs = 120000,
): { stdout: string; success: boolean; stderr?: string } {
  try {
    const r = spawnSync(cmd, args_, { shell: false, timeout: timeoutMs, encoding: 'utf8' });
    return {
      stdout: (r.stdout ?? '').trim(),
      success: (r.status ?? -1) === 0,
      stderr: r.stderr?.trim() || undefined,
    };
  } catch (err: unknown) {
    return { stdout: '', success: false, stderr: String(err) };
  }
}

// ─── show_dialog ─────────────────────────────────────────────────────────────

export function toolShowDialog(args: {
  title: string;
  message: string;
  mode?: 'ok' | 'confirm' | 'input' | 'select' | 'file_picker';
  choices?: string[];
  fileFilter?: string;
  multiSelect?: boolean;
  continueAdding?: boolean;
}): { response: string; success: boolean; stderr?: string; count?: number } {
  const { title, message, mode = 'ok', choices = [] } = args;
  const multi = args.multiSelect === true;
  const plat = detectPlatform();

  // ── file_picker continueAdding loop ──────────────────────────────────────
  if (mode === 'file_picker' && args.continueAdding) {
    const allPaths: string[] = [];
    let round = 1;
    while (true) {
      const pickResult = toolShowDialog({ ...args, continueAdding: false,
        title: round === 1 ? title : `${title} (批次 ${round})` }) as any;
      const batch = (pickResult.response as string).split('|').filter(Boolean);
      allPaths.push(...batch);
      if (batch.length === 0) break; // user cancelled — stop
      // Ask if they want to add more
      const more = toolShowDialog({
        title: '继续添加？',
        message: `已选 ${allPaths.length} 张。继续添加更多图片吗？`,
        mode: 'confirm',
      }) as any;
      if (more.response !== 'Yes') break;
      round++;
    }
    return { response: allPaths.join('|'), success: allPaths.length > 0, count: allPaths.length };
  }

  // ── Windows ──────────────────────────────────────────────────────────────
  if (plat.os === 'windows') {
    let script: string;
    const eMsg   = message.replace(/'/g, "''").replace(/"/g, '`"');
    const eTitle = title.replace(/'/g, "''").replace(/"/g, '`"');

    if (mode === 'file_picker') {
      const filter = (args.fileFilter ?? 'Images (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp|All files (*.*)|*.*')
        .replace(/'/g, "''").replace(/"/g, '`"');
      script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$d = New-Object System.Windows.Forms.OpenFileDialog',
        `$d.Title = "${eTitle}"`,
        `$d.Filter = "${filter}"`,
        `$d.Multiselect = $${multi ? 'true' : 'false'}`,
        `$d.InitialDirectory = "${PROJECT_ROOT.replace(/\\/g, '\\\\')}"`,
        'if ($d.ShowDialog() -eq "OK") { Write-Output ($d.FileNames -join "|") } else { Write-Output "" }',
      ].join('; ');
    } else if (mode === 'input') {
      script = [
        'Add-Type -AssemblyName Microsoft.VisualBasic',
        `$result = [Microsoft.VisualBasic.Interaction]::InputBox("${eMsg}", "${eTitle}", "")`,
        'Write-Output $result',
      ].join('; ');
    } else if (mode === 'select' && choices.length > 0) {
      const listBody   = choices.map((c, i) => `${i + 1}. ${c}`).join('\\n');
      const fullMsg    = `${eMsg}\\n\\n${listBody}\\n\\nEnter number:`;
      const choicesJson = JSON.stringify(choices).replace(/'/g, "''");
      script = [
        'Add-Type -AssemblyName Microsoft.VisualBasic',
        `$input = [Microsoft.VisualBasic.Interaction]::InputBox("${fullMsg}", "${eTitle}", "")`,
        `$choices = '${choicesJson}' | ConvertFrom-Json`,
        '$idx = [int]$input - 1',
        'if ($idx -ge 0 -and $idx -lt $choices.Count) { Write-Output $choices[$idx] } else { Write-Output "" }',
      ].join('; ');
    } else {
      const buttons = mode === 'confirm' ? 'YesNoCancel' : 'OK';
      script = [
        'Add-Type -AssemblyName PresentationFramework',
        `$result = [System.Windows.MessageBox]::Show("${eMsg}", "${eTitle}", "${buttons}", "Question")`,
        'Write-Output $result',
      ].join('; ');
    }
    // file_picker needs STA thread for WinForms + must NOT use -NonInteractive (blocks GUI)
    const psFlags = mode === 'file_picker'
      ? ['-NoProfile', '-STA', '-Command', script]
      : ['-NoProfile', '-NonInteractive', '-Command', script];
    const r = runCmd('powershell', psFlags);
    return { response: r.stdout, success: r.success, stderr: r.stderr };
  }

  // ── macOS ─────────────────────────────────────────────────────────────────
  if (plat.os === 'macos') {
    const eMsg   = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const eTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    if (mode === 'file_picker') {
      const exts = (args.fileFilter ?? '').match(/\*\.\w+/g) ?? ['*.png','*.jpg','*.jpeg','*.webp'];
      const utis  = exts.map(e => `"${e.replace('*.', '')}"` ).join(', ');
      const multi_ = multi ? 'with multiple selections allowed' : '';
      const script = `choose file of type {${utis}} with prompt "${eMsg}" ${multi_}`;
      const r = runCmd('osascript', ['-e', script]);
      // osascript returns comma-separated alias paths like "Macintosh HD:Users:..."
      // Convert colon-separated Mac paths to POSIX
      const paths = r.stdout.split(', ').map(p => p.trim()).filter(Boolean)
        .map(p => {
          const posix = p.replace(/^[^:]+:/, '/').replace(/:/g, '/');
          return posix;
        }).join('|');
      return { response: paths, success: r.success, stderr: r.stderr };
    } else if (mode === 'input') {
      const r = runCmd('osascript', ['-e',
        `display dialog "${eMsg}" with title "${eTitle}" default answer "" buttons {"Cancel","OK"} default button "OK"`
      ]);
      const match = r.stdout.match(/text returned:([^,]*)/);
      return { response: match ? match[1].trim() : '', success: r.success && !!match };
    } else if (mode === 'select' && choices.length > 0) {
      const list = choices.map(c => `"${c.replace(/"/g, '\\"')}"`).join(', ');
      const r = runCmd('osascript', ['-e',
        `choose from list {${list}} with prompt "${eMsg}" with title "${eTitle}"`
      ]);
      return { response: r.stdout === 'false' ? '' : r.stdout, success: r.success };
    } else if (mode === 'confirm') {
      const r = runCmd('osascript', ['-e',
        `display dialog "${eMsg}" with title "${eTitle}" buttons {"Cancel","No","Yes"} default button "Yes"`
      ]);
      const btn = r.stdout.match(/button returned:(\w+)/)?.[1] ?? 'Cancel';
      return { response: btn, success: r.success };
    } else {
      runCmd('osascript', ['-e',
        `display dialog "${eMsg}" with title "${eTitle}" buttons {"OK"} default button "OK"`
      ]);
      return { response: 'OK', success: true };
    }
  }

  // ── Linux ─────────────────────────────────────────────────────────────────
  const useKdialog = plat.desktop === 'kde';

  if (mode === 'file_picker') {
    if (useKdialog) {
      const multiFlag = multi ? '--multiple --separate-output' : '';
      const r = runCmd('kdialog', ['--getopenfilename', os.homedir(), '--title', title, ...(multi ? ['--multiple', '--separate-output'] : [])]);
      return { response: r.stdout.split('\n').filter(Boolean).join('|'), success: r.success };
    } else {
      // zenity
      const r = runCmd('zenity', [
        '--file-selection', '--title', title,
        '--file-filter', args.fileFilter ?? '*.png *.jpg *.jpeg *.webp',
        ...(multi ? ['--multiple', '--separator', '|'] : []),
      ]);
      return { response: r.stdout, success: r.success };
    }
  } else if (mode === 'input') {
    if (useKdialog) {
      const r = runCmd('kdialog', ['--inputbox', message, '', '--title', title]);
      return { response: r.stdout, success: r.success };
    } else {
      const r = runCmd('zenity', ['--entry', '--title', title, '--text', message]);
      return { response: r.stdout, success: r.success };
    }
  } else if (mode === 'select' && choices.length > 0) {
    if (useKdialog) {
      const menuArgs = choices.flatMap((c, i) => [`${i + 1}`, c]);
      const r = runCmd('kdialog', ['--menu', message, '--title', title, ...menuArgs]);
      const idx = parseInt(r.stdout) - 1;
      return { response: choices[idx] ?? '', success: r.success };
    } else {
      const r = runCmd('zenity', ['--list', '--title', title, '--text', message, '--column', 'Option', ...choices]);
      return { response: r.stdout, success: r.success };
    }
  } else if (mode === 'confirm') {
    if (useKdialog) {
      const r = runCmd('kdialog', ['--yesnocancel', message, '--title', title]);
      const response = r.stdout.trim().toLowerCase() === 'yes' ? 'Yes' : (r.stdout.trim() === '' ? 'Cancel' : 'No');
      return { response, success: true };
    } else {
      const r = runCmd('zenity', ['--question', '--title', title, '--text', message]);
      return { response: r.success ? 'Yes' : 'No', success: true };
    }
  } else {
    if (useKdialog) {
      runCmd('kdialog', ['--msgbox', message, '--title', title]);
    } else {
      runCmd('zenity', ['--info', '--title', title, '--text', message]);
    }
    return { response: 'OK', success: true };
  }
}

// ─── show_notification ───────────────────────────────────────────────────────

export function toolShowNotification(args: {
  title: string;
  message: string;
  type?: 'info' | 'warning' | 'error';
}): object {
  const { title, message, type = 'info' } = args;
  const plat = detectPlatform();

  if (plat.os === 'windows') {
    const iconType     = type === 'error' ? 'Error' : type === 'warning' ? 'Warning' : 'Info';
    const eTitle   = title.replace(/"/g, '`"');
    const eMessage = message.replace(/"/g, '`"');
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$n = New-Object System.Windows.Forms.NotifyIcon',
      '$n.Icon = [System.Drawing.SystemIcons]::Information',
      '$n.Visible = $true',
      `$n.ShowBalloonTip(4000, "${eTitle}", "${eMessage}", [System.Windows.Forms.ToolTipIcon]::${iconType})`,
      'Start-Sleep -Milliseconds 500',
      '$n.Dispose()',
    ].join('; ');
    const r = runCmd('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], 10000);
    return { sent: r.success, stderr: r.stderr };
  }

  if (plat.os === 'macos') {
    const eTitle   = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const eMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const r = runCmd('osascript', ['-e',
      `display notification "${eMessage}" with title "${eTitle}"`
    ], 5000);
    return { sent: r.success, stderr: r.stderr };
  }

  // Linux — notify-send
  const urgency = type === 'error' ? 'critical' : type === 'warning' ? 'normal' : 'low';
  const r = runCmd('notify-send', ['--urgency', urgency, title, message], 5000);
  return { sent: r.success, stderr: r.stderr };
}
