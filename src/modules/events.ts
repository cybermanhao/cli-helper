/**
 * Event Stream — SSE broadcast for real-time observability
 */

import type { Response } from 'express';

const sseClients = new Map<string, Set<Response>>();

export function addSseClient(sessionId: string, res: Response): void {
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set());
  }
  sseClients.get(sessionId)!.add(res);
}

export function removeSseClient(sessionId: string, res: Response): void {
  sseClients.get(sessionId)?.delete(res);
  if (sseClients.get(sessionId)?.size === 0) {
    sseClients.delete(sessionId);
  }
}

export function broadcast(sessionId: string, data: unknown): void {
  const clients = sseClients.get(sessionId);
  if (!clients) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

export function broadcastToAll(data: unknown): void {
  for (const sessionId of sseClients.keys()) {
    broadcast(sessionId, data);
  }
}
