/**
 * Session Timeline — Aggregated execution view
 *
 * Combines sessions, audit logs, choices, and delays into a unified timeline.
 */

import { listSessions, getSession, type CliSession } from './session.js';
import { queryAudit, type AuditEntry } from './audit.js';
import { getChoicesBySession, listAllChoices, type PendingChoice } from './choice.js';
import { getPendingDelays, type PendingDelay } from './delay.js';

export interface TimelineEntry {
  timestamp: number;
  type: 'session' | 'audit' | 'choice' | 'delay' | 'session-resolved';
  data: unknown;
}

export function getGlobalTimeline(limit = 100): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  // Sessions
  for (const s of listSessions()) {
    entries.push({ timestamp: s.createdAt, type: 'session', data: s });
    if (s.resolvedAt) {
      entries.push({ timestamp: s.resolvedAt, type: 'session-resolved', data: s });
    }
  }

  // Audit (recent)
  const { entries: auditEntries } = queryAudit({ limit });
  for (const a of auditEntries) {
    entries.push({ timestamp: a.timestamp, type: 'audit', data: a });
  }

  // Choices (pending only for global timeline — too many otherwise)
  for (const c of listAllChoices()) {
    entries.push({ timestamp: c.createdAt, type: 'choice', data: c });
  }

  // Delays (pending)
  for (const d of getPendingDelays()) {
    entries.push({ timestamp: d.createdAt, type: 'delay', data: d });
  }

  entries.sort((a, b) => b.timestamp - a.timestamp);
  return entries.slice(0, limit);
}

export function getSessionTimeline(sessionId: string): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  // Session
  const session = getSession(sessionId);
  if (session) {
    entries.push({ timestamp: session.createdAt, type: 'session', data: session });
    if (session.resolvedAt) {
      entries.push({ timestamp: session.resolvedAt, type: 'session-resolved', data: session });
    }
  }

  // Audit with this sessionId
  const { entries: auditEntries } = queryAudit({ sessionId, limit: 100 });
  for (const a of auditEntries) {
    entries.push({ timestamp: a.timestamp, type: 'audit', data: a });
  }

  // Choices with this sessionId
  for (const c of getChoicesBySession(sessionId)) {
    entries.push({ timestamp: c.createdAt, type: 'choice', data: c });
  }

  entries.sort((a, b) => b.timestamp - a.timestamp);
  return entries;
}
