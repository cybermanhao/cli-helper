import { z } from 'zod';

const MAX_STRING = 10000;
const MAX_ARRAY = 1000;

export const RunCommandSchema = z.object({
  command: z.string().min(1).max(MAX_STRING),
  cwd: z.string().max(500).optional(),
  timeoutMs: z.number().int().min(100).max(300000).optional(),
});

export const OpenPathSchema = z.object({
  path: z.string().min(1).max(500),
});

export const CheckProcessSchema = z.object({
  processName: z.string().min(1).max(200),
});

export const ShowDialogSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(MAX_STRING),
  mode: z.enum(['ok', 'confirm', 'input', 'select', 'file_picker']).optional(),
  choices: z.array(z.string().max(200)).max(MAX_ARRAY).optional(),
  fileFilter: z.string().max(500).optional(),
  multiSelect: z.boolean().optional(),
  continueAdding: z.boolean().optional(),
});

export const ShowNotificationSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(MAX_STRING),
  type: z.enum(['info', 'warning', 'error']).optional(),
});

export const ShowAssetPickerSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(MAX_STRING),
  assets: z.array(z.object({
    label: z.string().max(200),
    imagePath: z.string().max(500),
    metadata: z.record(z.unknown()).optional(),
  })).max(MAX_ARRAY),
  multiSelect: z.boolean().optional(),
  allowUpload: z.boolean().optional(),
  uploadDir: z.string().max(500).optional(),
  showHistory: z.boolean().optional(),
});

export const UploadFilesSchema = z.object({
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(MAX_STRING),
  saveDir: z.string().min(1).max(500),
});

export const ManagePolicySchema = z.object({
  operation: z.enum(['add', 'remove']),
  id: z.string().min(1).max(200),
  name: z.string().max(200).optional(),
  scope: z.enum(['command', 'file', 'tool', 'network']).optional(),
  pattern: z.string().max(MAX_STRING).optional(),
  isRegex: z.boolean().optional(),
  action: z.enum(['allow', 'deny', 'confirm', 'notify', 'delay']).optional(),
  delayMs: z.number().int().min(0).max(300000).optional(),
  notifyMessage: z.string().max(MAX_STRING).optional(),
}).refine(
  (data) => data.operation === 'remove' || (data.scope && data.pattern && data.action),
  { message: 'scope, pattern, and action are required for add operation' },
);

export const ManageNotifyConfigSchema = z.object({
  operation: z.enum(['add', 'remove']),
  id: z.string().min(1).max(200),
  name: z.string().max(200).optional(),
  channel: z.enum(['slack_webhook', 'webhook', 'email', 'system_notification']).optional(),
  enabled: z.boolean().optional(),
  events: z.array(z.enum(['policy_denied', 'policy_confirmed', 'command_blocked', 'audit_alert', 'delay_cancelled'])).max(50).optional(),
  url: z.string().max(1000).optional(),
  template: z.string().max(MAX_STRING).optional(),
  rateLimitMs: z.number().int().min(0).max(3600000).optional(),
});

export const TestNotifySchema = z.object({
  event: z.enum(['policy_denied', 'policy_confirmed', 'command_blocked', 'audit_alert', 'delay_cancelled']),
  title: z.string().min(1).max(200).optional(),
  message: z.string().max(MAX_STRING).optional(),
});

export const WriteLogSchema = z.object({
  message: z.string().min(1).max(MAX_STRING),
  level: z.enum(['info', 'warn', 'error', 'debug']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const UpdateStateSchema = z.object({
  phase: z.string().min(1).max(200),
  currentTask: z.string().max(500).optional(),
  progress: z.record(z.unknown()).optional(),
});

export const SendToAgentSchema = z.object({
  message: z.string().min(1).max(MAX_STRING),
  metadata: z.record(z.unknown()).optional(),
});
