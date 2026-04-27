/**
 * Notification Manager — Multi-channel alerting for Agent governance
 *
 * Channels: slack_webhook, webhook, email, system_notification
 * Events: policy_denied, policy_confirmed, command_blocked, audit_alert, delay_cancelled
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';

export type NotifyChannel = 'slack_webhook' | 'webhook' | 'email' | 'system_notification';

export type NotifyEvent =
  | 'policy_denied'
  | 'policy_confirmed'
  | 'command_blocked'
  | 'audit_alert'
  | 'delay_cancelled';

export interface NotifyConfig {
  id: string;
  name: string;
  channel: NotifyChannel;
  enabled: boolean;
  events: NotifyEvent[];
  url?: string;           // for slack_webhook / webhook
  email?: string;         // for email
  template?: string;      // optional custom message template
  rateLimitMs?: number;   // minimum interval between notifications (default: 30000)
}

const CONFIG_DIR = process.env.CLI_HELPER_CONFIG_DIR ?? path.join(os.homedir(), '.cli-helper');
const NOTIFY_CONFIG_PATH = path.join(CONFIG_DIR, 'notify-config.json');
const DEFAULT_RATE_LIMIT_MS = 30_000;

let configs: NotifyConfig[] = [];
let lastSent = new Map<string, number>(); // configId -> timestamp

function ensureDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfigs(): NotifyConfig[] {
  ensureDir();
  try {
    const raw = fs.readFileSync(NOTIFY_CONFIG_PATH, 'utf8');
    configs = JSON.parse(raw);
  } catch {
    // No config file yet — use empty defaults
    configs = [];
  }
  return configs;
}

function saveConfigs(): void {
  ensureDir();
  fs.writeFileSync(NOTIFY_CONFIG_PATH, JSON.stringify(configs, null, 2), 'utf8');
}

export function listNotifyConfigs(): NotifyConfig[] {
  return loadConfigs();
}

export function addNotifyConfig(cfg: NotifyConfig): void {
  loadConfigs();
  const idx = configs.findIndex(c => c.id === cfg.id);
  if (idx >= 0) {
    configs[idx] = cfg;
  } else {
    configs.push(cfg);
  }
  saveConfigs();
}

export function removeNotifyConfig(id: string): boolean {
  loadConfigs();
  const before = configs.length;
  configs = configs.filter(c => c.id !== id);
  if (configs.length < before) {
    saveConfigs();
    return true;
  }
  return false;
}

export function getNotifyConfig(id: string): NotifyConfig | undefined {
  return loadConfigs().find(c => c.id === id);
}

// ─── Senders ─────────────────────────────────────────────────────────────────

function sendSystemNotification(title: string, message: string): void {
  const plat = process.platform;
  try {
    if (plat === 'win32') {
      child_process.spawnSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show("${message.replace(/"/g, '`"')}", "${title.replace(/"/g, '`"')}")`
      ], { timeout: 5000 });
    } else if (plat === 'darwin') {
      child_process.spawnSync('osascript', ['-e', `display notification "${message}" with title "${title}"`], { timeout: 5000 });
    } else {
      child_process.spawnSync('notify-send', [title, message], { timeout: 5000 });
    }
  } catch {
    // Best-effort notification
  }
}

async function sendWebhook(url: string, payload: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Webhook failed: ${res.status} ${res.statusText}`);
  }
}

async function sendSlackWebhook(url: string, text: string): Promise<void> {
  await sendWebhook(url, { text });
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export interface NotifyPayload {
  event: NotifyEvent;
  title: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp?: number;
}

export async function sendNotify(payload: NotifyPayload): Promise<{ sent: number; errors: string[] }> {
  const list = loadConfigs().filter(c => c.enabled && c.events.includes(payload.event));
  const errors: string[] = [];
  let sent = 0;

  for (const cfg of list) {
    // Rate limit
    const limit = cfg.rateLimitMs ?? DEFAULT_RATE_LIMIT_MS;
    const last = lastSent.get(cfg.id) ?? 0;
    if (Date.now() - last < limit) continue;

    try {
      const text = cfg.template
        ? cfg.template
            .replace(/\{title\}/g, payload.title)
            .replace(/\{message\}/g, payload.message)
            .replace(/\{event\}/g, payload.event)
        : `[${payload.event}] ${payload.title}: ${payload.message}`;

      switch (cfg.channel) {
        case 'slack_webhook':
          if (cfg.url) await sendSlackWebhook(cfg.url, text);
          break;
        case 'webhook':
          if (cfg.url) {
            await sendWebhook(cfg.url, {
              event: payload.event,
              title: payload.title,
              message: payload.message,
              details: payload.details,
              timestamp: payload.timestamp ?? Date.now(),
            });
          }
          break;
        case 'email':
          // Email not implemented yet — would need SMTP config
          errors.push(`Email channel not implemented for ${cfg.id}`);
          continue;
        case 'system_notification':
          sendSystemNotification(payload.title, payload.message);
          break;
      }

      lastSent.set(cfg.id, Date.now());
      sent++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Notify ${cfg.id} failed: ${msg}`);
    }
  }

  return { sent, errors };
}
