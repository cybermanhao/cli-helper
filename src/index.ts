/**
 * cli-helper-mcp — Generic agent workflow MCP server
 *
 * Focus: User interaction primitives (dialog, notification)
 * Platform: Windows / macOS / Linux (GNOME/KDE auto-detected)
 *
 * ─── FUTURE TOOLS (not yet implemented) ────────────────────────────────────
 *
 * Process management:
 *   spawn_process(command, cwd?) →{ pid } —non-blocking background process
 *   process_status(pid) →{ running, exitCode? }
 *   process_kill(pid)
 *
 * Environment inspection:
 *   which(executable) →{ path? } —resolve executable path
 *   env_check(vars[]) →{ [var]: value | null } —check env var presence
 *
 * Persistent agent state (file-backed KV):
 *   kv_set(key, value, namespace?)
 *   kv_get(key, namespace?) →{ value? }
 *   flag_set(name) / flag_check(name) →{ set: bool } —simple boolean flags
 *
 * Clipboard:
 *   clipboard_write(text) —write text to clipboard
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createSession, updateSession } from './modules/session.js';
import { createChoice, resolveChoice } from './modules/choice.js';
import {
  evaluatePolicy, listPolicies, addPolicy, removePolicy,
  type Policy, type PolicyScope, type PolicyAction,
} from './modules/policy.js';
import { logAudit, queryAudit, type AuditEntry } from './modules/audit.js';
import { createDelay } from './modules/delay.js';
import { createSnapshot, diffSnapshots, storeSessionChanges } from './modules/snapshot.js';
import { sendNotify, addNotifyConfig, removeNotifyConfig, type NotifyConfig, type NotifyEvent } from './modules/notify.js';
import { getGlobalTimeline, getSessionTimeline } from './modules/timeline.js';
import { PROJECT_ROOT, resolveProjectPath } from './modules/utils.js';
import { toolShowDialog, toolShowNotification } from './modules/dialog.js';
import { toolRunCommand, toolCheckProcess } from './modules/command.js';
import { toolReadInbox, toolWriteLog, toolUpdateState, toolSendToAgent } from './modules/agent-tools.js';
import {
  RunCommandSchema, OpenPathSchema, CheckProcessSchema,
  ShowDialogSchema, ShowNotificationSchema, ShowAssetPickerSchema,
  UploadFilesSchema, ManagePolicySchema, ManageNotifyConfigSchema,
  TestNotifySchema, WriteLogSchema, UpdateStateSchema, SendToAgentSchema,
} from './modules/schemas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT ?? '7842', 10);

import type { AssetPickerItem } from './picker/types.js';
import { pickerContexts, buildPickerHtml } from './modules/picker.js';
import { uploadContexts, buildUploadHtml } from './modules/upload.js';

const IMAGE_EXTS_SET = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

async function toolShowAssetPicker(args: {
  title: string;
  message: string;
  assets: AssetPickerItem[];
  multiSelect?: boolean;
  allowUpload?: boolean;
  uploadDir?: string;
  showHistory?: boolean;
}): Promise<object> {
  const { title, message, multiSelect = false, allowUpload = false, uploadDir, showHistory = false } = args;
  let assets = [...(args.assets ?? [])];

  if (allowUpload && !uploadDir) return { error: 'uploadDir is required when allowUpload is true' };

  // Prepend history items (existing files in uploadDir, not already in assets)
  if (showHistory && uploadDir && fs.existsSync(uploadDir)) {
    const existingPaths = new Set(assets.map(a => a.imagePath));
    const histFiles = fs.readdirSync(uploadDir)
      .filter(f => IMAGE_EXTS_SET.has(path.extname(f).toLowerCase()))
      .map(f => path.join(uploadDir!, f))
      .filter(p => !existingPaths.has(p))
      .sort();
    const histItems: AssetPickerItem[] = histFiles.map(p => ({
      label: path.basename(p),
      imagePath: p,
      metadata: { _src: 'history' },
    }));
    assets = [...assets, ...histItems];
  }

  if (assets.length === 0 && !allowUpload) return { error: 'No assets provided' };

  const absUploadDir = uploadDir ? path.resolve(uploadDir) : undefined;
  if (absUploadDir) fs.mkdirSync(absUploadDir, { recursive: true });

  const session = createSession('show_asset_picker', { title, message, assets });
  const sessionId = session.id;

  type PickResult = {
    selections: Array<{ label: string; index: number; imagePath: string }>;
    uploadedFiles: Array<{ name: string; path: string }>;
    cancelled: boolean;
  };

  const choiceHandle = createChoice<PickResult>(sessionId, 'asset_picker', { title, message });
  pickerContexts.set(sessionId, { items: assets, multiSelect, uploadDir: absUploadDir, choiceId: choiceHandle.id });
  setTimeout(() => {
    if (pickerContexts.has(sessionId)) {
      pickerContexts.delete(sessionId);
      // Choice timeout is handled by createChoice
    }
  }, 600000);


  const url = `http://localhost:${DASHBOARD_PORT}/picker/${sessionId}`;
  spawnSync('cmd.exe', ['/c', 'start', '""', url], { shell: false, timeout: 5000 });

  let result: PickResult;
  try {
    result = await choiceHandle.promise;
    updateSession(sessionId, { status: 'completed', result, resolvedAt: Date.now() });
  } catch {
    result = { selections: [], uploadedFiles: [], cancelled: true };
    updateSession(sessionId, { status: 'cancelled', resolvedAt: Date.now() });
  }

  pickerContexts.delete(sessionId);

  if (result.cancelled) return { cancelled: true, count: 0, pickerUrl: url };
  return {
    selections: result.selections,
    uploadedFiles: result.uploadedFiles,
    count: result.selections.length,
    pickerUrl: url,
  };
}

// ─── upload_files ────────────────────────────────────────────────────────────
//
// Opens a browser tab with a drag-and-drop upload zone.
// Files are POSTed as base64 JSON, saved to saveDir, Promise resolves with paths.

async function toolUploadFiles(args: {
  title: string;
  message: string;
  saveDir: string;
}): Promise<object> {
  const { title, message, saveDir } = args;
  const absDir = path.resolve(saveDir);
  fs.mkdirSync(absDir, { recursive: true });

  const session = createSession('upload_files', { title, message, saveDir });
  const uploadSessionId = session.id;

  type UploadResult = { files: Array<{ name: string; path: string; size: number }>; cancelled: boolean };
  const choiceHandle = createChoice<UploadResult>(uploadSessionId, 'upload_files', { title, message });
  uploadContexts.set(uploadSessionId, { saveDir: absDir, choiceId: choiceHandle.id });

  setTimeout(() => {
    if (uploadContexts.has(uploadSessionId)) {
      uploadContexts.delete(uploadSessionId);
    }
  }, 600000);

  const url = `http://localhost:${DASHBOARD_PORT}/upload/${uploadSessionId}`;
  spawnSync('cmd.exe', ['/c', 'start', '""', url], { shell: false, timeout: 5000 });

  let result: UploadResult;
  try {
    result = await choiceHandle.promise;
    updateSession(uploadSessionId, { status: 'completed', result, resolvedAt: Date.now() });
  } catch {
    result = { files: [], cancelled: true };
    updateSession(uploadSessionId, { status: 'cancelled', resolvedAt: Date.now() });
  }

  uploadContexts.delete(uploadSessionId);
  if (result.cancelled) return { cancelled: true, count: 0 };
  return { files: result.files, count: result.files.length };
}

// ─── Agent state & inbox ─────────────────────────────────────────────────────
//
// Three files in PROJECT_ROOT/agent-workspace/:
//   inbox.json       —user →agent messages (written by dashboard / user)
//   agent-log.jsonl  —agent →user progress log (append-only)
//   state.json       —agent current state snapshot (overwritten each update)
//
// Tools:
//   read_inbox()              —agent reads unread user messages, marks read
//   write_log(msg, level?)    —agent appends a progress entry
//   update_state(state)       —agent overwrites current state snapshot

// ─── run_command ─────────────────────────────────────────────────────────────

// ─── open_path ───────────────────────────────────────────────────────────────

function toolOpenPath(args: { path: string }): object {
  const target = resolveProjectPath(args.path);

  try {
    fs.statSync(target); // validate path exists

    const platform = process.platform;
    let command: string;
    let cmdArgs: string[];

    const normalized = target.replace(/\//g, '\\');

    if (platform === 'win32') {
      // Use 'start' command for both files and folders on Windows
      // 'explorer.exe' exit codes are unreliable for GUI programs
      command = 'cmd.exe';
      cmdArgs = ['/c', 'start', '""', normalized];
    } else if (platform === 'darwin') {
      command = 'open';
      cmdArgs = [target];
    } else {
      // Linux and other Unix-like systems
      command = 'xdg-open';
      cmdArgs = [target];
    }

    const r = spawnSync(command, cmdArgs, { shell: false, timeout: 10000 });
    // GUI programs often return non-zero exit codes even on success
    // Treat as success if no spawn error occurred
    const success = r.error === undefined;
    return { opened: success, command: `${command} ${cmdArgs.join(' ')}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { opened: false, error: msg };
  }
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'cli-helper-mcp', version: '2.1.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'show_asset_picker',
      description:
        'Show a browser preview of multiple image assets side-by-side, then prompt the user to select one. ' +
        'Opens a styled HTML page in the default browser (non-blocking) so the user can compare visuals, ' +
        'then shows a numbered selection dialog. Returns the selected asset label and path.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Picker window title' },
          message: { type: 'string', description: 'Instruction shown to the user' },
          assets: {
            type: 'array',
            description: 'Assets to compare',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Display name / version label' },
                imagePath: { type: 'string', description: 'Absolute path to the image file' },
                metadata: {
                  type: 'object',
                  description: 'Optional key-value metadata shown under the image (e.g. model, score)',
                  additionalProperties: { type: 'string' },
                },
              },
              required: ['label', 'imagePath'],
            },
          },
          multiSelect: {
            type: 'boolean',
            description: 'Allow selecting multiple items (default: false)',
          },
          allowUpload: {
            type: 'boolean',
            description: 'Show inline drag-and-drop upload zone in the picker page. Uploaded images appear in the grid immediately and can be selected. Requires uploadDir.',
          },
          uploadDir: {
            type: 'string',
            description: 'Absolute directory path where uploaded files will be saved. Required when allowUpload is true.',
          },
          showHistory: {
            type: 'boolean',
            description: 'Scan uploadDir for previously uploaded images and display them in the grid with a "历史" badge. Useful for revisiting past uploads across sessions.',
          },
        },
        required: ['title', 'message', 'assets'],
      },
    },
    {
      name: 'show_dialog',
      description:
        'Show a synchronous dialog to the user and return their response. ' +
        'Blocks until the user responds. Modes: ok (acknowledge), confirm (yes/no/cancel), ' +
        'input (free text), select (numbered choice list), ' +
        'file_picker (native Windows file browser —returns pipe-separated absolute paths or "" if cancelled).',
      inputSchema: {
        type: 'object',
        properties: {
          title:      { type: 'string', description: 'Dialog window title' },
          message:    { type: 'string', description: 'Message to display' },
          mode: {
            type: 'string',
            enum: ['ok', 'confirm', 'input', 'select', 'file_picker'],
            description: 'Dialog mode (default: ok)',
          },
          choices: {
            type: 'array',
            items: { type: 'string' },
            description: 'Options for select mode',
          },
          fileFilter: {
            type: 'string',
            description: 'File type filter for file_picker, e.g. "Images|*.png;*.jpg;*.jpeg". Default: common image formats.',
          },
          multiSelect: {
            type: 'boolean',
            description: 'Allow selecting multiple files in file_picker (default: true)',
          },
          continueAdding: {
            type: 'boolean',
            description: 'file_picker only: after each pick, ask "Add more?" and merge all batches into one result',
          },
        },
        required: ['title', 'message'],
      },
    },
    {
      name: 'show_notification',
      description:
        'Show a non-blocking Windows balloon notification. Returns immediately.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Notification title' },
          message: { type: 'string', description: 'Notification body' },
          type: {
            type: 'string',
            enum: ['info', 'warning', 'error'],
            description: 'Icon type (default: info)',
          },
        },
        required: ['title', 'message'],
      },
    },
    {
      name: 'run_command',
      description: 'Run any shell command and return stdout, stderr, and exit code.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          cwd: {
            type: 'string',
            description: 'Working directory (absolute or relative to project root)',
          },
          timeoutMs: {
            type: 'number',
            description: 'Timeout in milliseconds (default 30000)',
          },
        },
        required: ['command'],
      },
    },
    {
      name: 'check_process',
      description: 'Check if a Windows process is running by name.',
      inputSchema: {
        type: 'object',
        properties: {
          processName: {
            type: 'string',
            description: 'Process name to search for (e.g. "SlayTheSpire2", "Godot")',
          },
        },
        required: ['processName'],
      },
    },
    {
      name: 'read_inbox',
      description:
        'Read unread user messages from the agent inbox and mark them as read. ' +
        'Call this before major decisions to check if the user left any instructions.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'write_log',
      description: 'Append a progress entry to the agent activity log (visible in dashboard).',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Log message' },
          level: { type: 'string', enum: ['info', 'warn', 'error', 'debug'], description: 'Log level (default: info)' },
          metadata: { type: 'object', description: 'Optional structured data', additionalProperties: true },
        },
        required: ['message'],
      },
    },
    {
      name: 'update_state',
      description:
        'Overwrite the agent state snapshot (visible in dashboard as current status). ' +
        'Call at the start of each phase to keep the dashboard up to date.',
      inputSchema: {
        type: 'object',
        properties: {
          phase: { type: 'string', description: 'Current phase name (e.g. "generating", "deploying", "idle")' },
          currentTask: { type: 'string', description: 'Human-readable description of the current task' },
          progress: { type: 'object', description: 'Optional progress data', additionalProperties: true },
        },
        required: ['phase'],
      },
    },
    {
      name: 'send_to_agent',
      description:
        'Write a message to the agent inbox. Use this to send instructions to the agent ' +
        'while it is running autonomously. The agent will read it before its next major decision.',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Instruction or feedback for the agent' },
          metadata: { type: 'object', description: 'Optional structured data', additionalProperties: true },
        },
        required: ['message'],
      },
    },
    {
      name: 'open_path',
      description: 'Open a file or folder in Windows Explorer / default application.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to open (absolute or relative to project root)',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'upload_files',
      description:
        'Open a browser-based drag-and-drop file upload page. ' +
        'User drops or selects images, they are saved to saveDir, and their paths are returned. ' +
        'Use this when you need the user to provide reference images or other files.',
      inputSchema: {
        type: 'object',
        properties: {
          title:   { type: 'string', description: 'Upload page title' },
          message: { type: 'string', description: 'Instruction shown to the user' },
          saveDir: { type: 'string', description: 'Absolute directory path to save uploaded files' },
        },
        required: ['title', 'message', 'saveDir'],
      },
    },
    {
      name: 'manage_policy',
      description:
        'Add, remove, or update a policy rule for the Policy Engine. ' +
        'Policies control whether commands, file operations, tool calls, and network requests ' +
        'are allowed, denied, require confirmation, notify, or are delayed. ' +
        'Scope: "command" | "file" | "tool" | "network". ' +
        'Action: "allow" | "deny" | "confirm" | "notify" | "delay". ' +
        'pattern: string to match (literal substring by default, set isRegex=true for regex).',
      inputSchema: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['add', 'remove'],
            description: 'Operation type: add a new policy or remove an existing one',
          },
          id: { type: 'string', description: 'Unique policy identifier (required for add and remove)' },
          name: { type: 'string', description: 'Human-readable policy name (default: id)' },
          scope: {
            type: 'string',
            enum: ['command', 'file', 'tool', 'network'],
            description: 'Policy scope (required for add)',
          },
          pattern: { type: 'string', description: 'Pattern or value to match against (required for add)' },
          isRegex: {
            type: 'boolean',
            description: 'Treat pattern as a regular expression (default: false)',
          },
          action: {
            type: 'string',
            enum: ['allow', 'deny', 'confirm', 'notify', 'delay'],
            description: 'Action to take when matched (required for add)',
          },
          delayMs: {
            type: 'number',
            description: 'Delay in milliseconds for "delay" action (default: 5000)',
          },
          notifyMessage: {
            type: 'string',
            description: 'Optional human-readable message shown to the user on notify/delay/confirm',
          },
        },
        required: ['operation', 'id'],
      },
    },
    {
      name: 'list_policies',
      description: 'List all active policy rules in the Policy Engine. Returns array of policy definitions.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'manage_notify_config',
      description:
        'Add, remove, or update a notification configuration. ' +
        'Channels: slack_webhook, webhook, system_notification. ' +
        'Events: policy_denied, policy_confirmed, command_blocked, audit_alert, delay_cancelled.',
      inputSchema: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['add', 'remove'], description: 'Operation type' },
          id: { type: 'string', description: 'Unique config identifier' },
          name: { type: 'string', description: 'Human-readable name' },
          channel: { type: 'string', enum: ['slack_webhook', 'webhook', 'system_notification'], description: 'Notification channel' },
          enabled: { type: 'boolean', description: 'Whether this config is active' },
          events: { type: 'array', items: { type: 'string', enum: ['policy_denied', 'policy_confirmed', 'command_blocked', 'audit_alert', 'delay_cancelled'] }, description: 'Events to subscribe to' },
          url: { type: 'string', description: 'Webhook URL (for slack_webhook / webhook)' },
          template: { type: 'string', description: 'Optional custom message template with {title}, {message}, {event}' },
          rateLimitMs: { type: 'number', description: 'Minimum ms between notifications (default: 30000)' },
        },
        required: ['operation', 'id'],
      },
    },
    {
      name: 'test_notify',
      description: 'Send a test notification using all enabled configs. Returns delivery results.',
      inputSchema: {
        type: 'object',
        properties: {
          event: { type: 'string', enum: ['policy_denied', 'policy_confirmed', 'command_blocked', 'audit_alert', 'delay_cancelled'], description: 'Event type to test' },
          message: { type: 'string', description: 'Test message' },
        },
        required: ['event'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  let result: unknown;
  let session: import('./modules/session.js').CliSession | undefined;

  // Async tools (asset_picker, upload_files) create their own sessions internally
  const isAsync = name === 'show_asset_picker' || name === 'upload_files';
  if (!isAsync) {
    session = createSession(name, args);
    (args as any).sessionId = session.id;
  }

  try {
    switch (name) {
      case 'read_inbox':
        result = toolReadInbox();
        break;
      case 'write_log':
        result = toolWriteLog(args as { message: string; level?: 'info' | 'warn' | 'error' | 'debug'; metadata?: Record<string, unknown> });
        break;
      case 'update_state':
        result = toolUpdateState(args as { phase: string; currentTask?: string; progress?: Record<string, unknown> });
        break;
      case 'send_to_agent':
        result = toolSendToAgent(args as { message: string; metadata?: Record<string, unknown> });
        break;
      case 'show_asset_picker':
        result = await toolShowAssetPicker(
          args as { title: string; message: string; assets: AssetPickerItem[]; multiSelect?: boolean }
        );
        break;
      case 'show_dialog':
        result = toolShowDialog(
          args as { title: string; message: string; mode?: 'confirm' | 'ok' | 'input' | 'select' | 'file_picker'; choices?: string[]; fileFilter?: string; multiSelect?: boolean; continueAdding?: boolean }
        );
        break;
      case 'show_notification':
        result = toolShowNotification(
          args as { title: string; message: string; type?: 'info' | 'warning' | 'error' }
        );
        break;
      case 'run_command': {
        const cmdArgs = RunCommandSchema.parse(args);
        const resolvedCwd = cmdArgs.cwd ? resolveProjectPath(cmdArgs.cwd) : PROJECT_ROOT;
        const cmdEval = evaluatePolicy('command', cmdArgs.command);
        if (cmdEval.action === 'deny') {
          result = { blocked: true, reason: cmdEval.message ?? 'Policy denied this command' };
          recordAudit(name, args, result, cmdEval, 'command', cmdArgs.command);
          break;
        }
        if (cmdEval.action === 'notify' || cmdEval.action === 'delay') {
          toolShowNotification({
            title: '策略通知',
            message: cmdEval.message ?? `正在执行命令: ${cmdArgs.command}`,
            type: cmdEval.action === 'delay' ? 'warning' : 'info',
          });
        }
        if (cmdEval.action === 'delay') {
          const { promise } = createDelay('command', cmdArgs.command, cmdEval.delayMs ?? 5000);
          const proceed = await promise;
          if (!proceed) {
            result = { blocked: true, reason: 'User cancelled during delay' };
            recordAudit(name, args, result, cmdEval, 'command', cmdArgs.command);
            break;
          }
        }
        if (cmdEval.action === 'confirm') {
          const confirm = toolShowDialog({
            title: '策略确认',
            message: cmdEval.message ?? `允许执行命令: ${cmdArgs.command}？`,
            mode: 'confirm',
          }) as any;
          if (confirm.response !== 'Yes') {
            result = { blocked: true, reason: 'User cancelled confirmation' };
            recordAudit(name, args, result, cmdEval, 'command', cmdArgs.command);
            break;
          }
        }
        // Snapshot before/after to detect file changes
        let beforeSnap: import('./modules/snapshot.js').Snapshot | undefined;
        try { beforeSnap = createSnapshot(resolvedCwd); } catch { /* ignore */ }

        result = toolRunCommand(cmdArgs);

        if (beforeSnap && session) {
          try {
            const afterSnap = createSnapshot(resolvedCwd);
            const diff = diffSnapshots(beforeSnap, afterSnap);
            if (diff.added.length || diff.modified.length || diff.removed.length) {
              storeSessionChanges(session.id, diff);
            }
          } catch { /* ignore */ }
        }

        recordAudit(name, args, result, cmdEval, 'command', cmdArgs.command);
        break;
      }

      case 'check_process':
        result = toolCheckProcess(CheckProcessSchema.parse(args));
        break;

      case 'open_path': {
        const pathArgs = OpenPathSchema.parse(args);
        const pathEval = evaluatePolicy('file', pathArgs.path);
        if (pathEval.action === 'deny') {
          result = { blocked: true, reason: pathEval.message ?? 'Policy denied this path' };
          recordAudit(name, args, result, pathEval, 'file', pathArgs.path);
          break;
        }
        if (pathEval.action === 'notify' || pathEval.action === 'delay') {
          toolShowNotification({
            title: '策略通知',
            message: pathEval.message ?? `正在打开路径: ${pathArgs.path}`,
            type: pathEval.action === 'delay' ? 'warning' : 'info',
          });
        }
        if (pathEval.action === 'delay') {
          const { promise } = createDelay('file', pathArgs.path, pathEval.delayMs ?? 5000);
          const proceed = await promise;
          if (!proceed) {
            result = { blocked: true, reason: 'User cancelled during delay' };
            recordAudit(name, args, result, pathEval, 'file', pathArgs.path);
            break;
          }
        }
        if (pathEval.action === 'confirm') {
          const confirm = toolShowDialog({
            title: '策略确认',
            message: pathEval.message ?? `允许打开路径: ${pathArgs.path}？`,
            mode: 'confirm',
          }) as any;
          if (confirm.response !== 'Yes') {
            result = { blocked: true, reason: 'User cancelled confirmation' };
            recordAudit(name, args, result, pathEval, 'file', pathArgs.path);
            break;
          }
        }
        result = toolOpenPath(pathArgs);
        recordAudit(name, args, result, pathEval, 'file', pathArgs.path);
        break;
      }

      case 'upload_files':
        result = await toolUploadFiles(UploadFilesSchema.parse(args));
        break;

      case 'manage_policy':
        result = toolManagePolicy(ManagePolicySchema.parse(args));
        break;

      case 'list_policies':
        result = toolListPolicies();
        break;

      case 'manage_notify_config':
        result = toolManageNotifyConfig(ManageNotifyConfigSchema.parse(args));
        break;

      case 'test_notify':
        result = await toolTestNotify(TestNotifySchema.parse(args));
        break;

      default:
        result = { error: `Unknown tool: ${name}` };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result = { error: `Unexpected error in ${name}: ${msg}` };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
});

// ─── Audit Helper ─────────────────────────────────────────────────────────────

function recordAudit(
  tool: string,
  args: unknown,
  result: unknown,
  policyEval?: { policy?: { id?: string } | null; action?: string },
  scope?: string,
  target?: string
): void {
  const blocked = !!(result as any)?.blocked;
  const hasError = !!(result as any)?.error;
  let auditResult: AuditEntry['result'] = 'allowed';
  if (blocked) auditResult = 'denied';
  else if (hasError) auditResult = 'error';
  else if (policyEval?.action === 'confirm') auditResult = 'confirmed';
  else if (policyEval?.action === 'notify') auditResult = 'notified';
  else if (policyEval?.action === 'delay') auditResult = 'delayed';

  logAudit({
    sessionId: (args as any)?.sessionId,
    tool,
    scope: scope as any,
    target,
    policyId: policyEval?.policy?.id,
    policyAction: policyEval?.action,
    result: auditResult,
    blocked,
    details: {
      args: typeof args === 'object' ? { ...args as object, sessionId: undefined } : undefined,
      result: typeof result === 'object' ? result : undefined,
    },
  });

  // Fire-and-forget notifications
  if (blocked) {
    sendNotify({
      event: 'command_blocked',
      title: 'Agent action blocked',
      message: `${tool}${target ? ' →' + target : ''} was blocked`,
      details: { tool, target, policyId: policyEval?.policy?.id, policyAction: policyEval?.action },
    }).catch(() => {});
  }
  if (auditResult === 'confirmed') {
    sendNotify({
      event: 'policy_confirmed',
      title: 'Agent action confirmed',
      message: `${tool}${target ? ' →' + target : ''} was confirmed by user`,
      details: { tool, target, policyId: policyEval?.policy?.id },
    }).catch(() => {});
  }
}

// ─── Policy Engine Tools ──────────────────────────────────────────────────────

function toolManagePolicy(args: {
  operation: 'add' | 'remove';
  id: string;
  name?: string;
  scope?: PolicyScope;
  pattern?: string;
  isRegex?: boolean;
  action?: PolicyAction;
  delayMs?: number;
  notifyMessage?: string;
}): object {
  const { operation, id } = args;

  if (operation === 'remove') {
    const ok = removePolicy(id);
    return { success: ok, operation, id };
  }

  if (!args.scope || !args.pattern || !args.action) {
    return { error: 'Missing required fields: scope, pattern, action' };
  }

  const policy: Policy = {
    id,
    name: args.name ?? id,
    scope: args.scope,
    pattern: args.pattern,
    isRegex: args.isRegex ?? false,
    action: args.action,
    delayMs: args.delayMs,
    notifyMessage: args.notifyMessage,
  };

  addPolicy(policy);
  return { success: true, operation, policy };
}

function toolListPolicies(): object {
  return { policies: listPolicies() };
}

// ─── Notification Tools ───────────────────────────────────────────────────────

function toolManageNotifyConfig(args: {
  operation: 'add' | 'remove';
  id: string;
  name?: string;
  channel?: 'slack_webhook' | 'webhook' | 'email' | 'system_notification';
  enabled?: boolean;
  events?: string[];
  url?: string;
  template?: string;
  rateLimitMs?: number;
}): object {
  const { operation, id } = args;

  if (operation === 'remove') {
    const ok = removeNotifyConfig(id);
    return { success: ok, operation, id };
  }

  if (!args.channel || !args.events || args.events.length === 0) {
    return { error: 'Missing required fields: channel, events' };
  }

  const cfg: NotifyConfig = {
    id,
    name: args.name ?? id,
    channel: args.channel,
    enabled: args.enabled ?? true,
    events: args.events as NotifyEvent[],
    url: args.url,
    template: args.template,
    rateLimitMs: args.rateLimitMs,
  };

  addNotifyConfig(cfg);
  return { success: true, operation, config: cfg };
}

async function toolTestNotify(args: { event: string; message?: string }): Promise<object> {
  const { event, message } = args;
  const result = await sendNotify({
    event: event as NotifyEvent,
    title: 'Test notification',
    message: message ?? 'This is a test notification from cli-helper.',
  });
  return { sent: result.sent, errors: result.errors };
}



// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.env.CLI_HELPER_MODE ?? 'stdio';
  const { startHttpServer, startSseServer } = await import('./server.js');

  if (mode === 'sse') {
    await startSseServer();
  } else {
    await startHttpServer('stdio');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('cli-helper-mcp v2 started\n');
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});

export { server as mcpServer };
