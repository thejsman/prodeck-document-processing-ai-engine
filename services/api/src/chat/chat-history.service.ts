/**
 * Chat history service — persists per-session message history to disk.
 *
 * Each session is a JSON sidecar at:
 *   {workdir}/chat-history/{namespace}/{chatSessionId}.json
 *
 * Follows the same filesystem JSON sidecar pattern used by workflow instances
 * and episodic memory throughout the project.
 */

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatHistory {
  chatSessionId: string;
  namespace: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function historyPath(
  workdir: string,
  namespace: string,
  chatSessionId: string,
): string {
  return path.join(workdir, 'chat-history', namespace, `${chatSessionId}.json`);
}

// ---------------------------------------------------------------------------
// Internal persistence
// ---------------------------------------------------------------------------

async function loadOrCreate(
  workdir: string,
  namespace: string,
  chatSessionId: string,
): Promise<ChatHistory> {
  try {
    const raw = await readFile(historyPath(workdir, namespace, chatSessionId), 'utf-8');
    return JSON.parse(raw) as ChatHistory;
  } catch {
    const now = new Date().toISOString();
    return { chatSessionId, namespace, messages: [], createdAt: now, updatedAt: now };
  }
}

async function persist(workdir: string, history: ChatHistory): Promise<void> {
  const filePath = historyPath(workdir, history.namespace, history.chatSessionId);
  history.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Append a single user message + the assistant reply in one atomic write.
 * Both messages are written together to avoid a race between two separate
 * read-modify-write cycles.
 */
export async function appendChatTurn(
  workdir: string,
  namespace: string,
  chatSessionId: string,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  const history = await loadOrCreate(workdir, namespace, chatSessionId);
  const now = new Date().toISOString();
  history.messages.push(
    { id: randomUUID(), role: 'user', content: userContent, timestamp: now },
    { id: randomUUID(), role: 'assistant', content: assistantContent, timestamp: now },
  );
  await persist(workdir, history);
}

/** Load the full message history for a session. Returns null if none exists. */
export async function loadHistory(
  workdir: string,
  namespace: string,
  chatSessionId: string,
): Promise<ChatHistory | null> {
  try {
    const raw = await readFile(historyPath(workdir, namespace, chatSessionId), 'utf-8');
    return JSON.parse(raw) as ChatHistory;
  } catch {
    return null;
  }
}

/** Delete the history file for a session. No-ops if the file does not exist. */
export async function clearHistory(
  workdir: string,
  namespace: string,
  chatSessionId: string,
): Promise<void> {
  try {
    await unlink(historyPath(workdir, namespace, chatSessionId));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
