/**
 * Chat history service — persists per-session message history to disk.
 *
 * Each session is a JSON sidecar at:
 *   {workdir}/chat-history/{namespace}/{apiKeyHash}/{chatSessionId}.json
 *
 * The apiKeyHash is the first 16 hex characters of SHA-256(apiKey).
 * This scopes history per API-key holder so two users sharing a namespace
 * never see each other's sessions, while the same user on any device
 * gets the same history as long as they use the same API key.
 */

import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'upload';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface ChatHistory {
  chatSessionId: string;
  namespace: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummary {
  chatSessionId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
}

// ---------------------------------------------------------------------------
// API key hashing
// ---------------------------------------------------------------------------

/** Produces a stable 16-char hex token from an API key. Non-reversible. */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function historyDir(workdir: string, namespace: string, apiKeyHash: string): string {
  return path.join(workdir, 'chat-history', namespace, apiKeyHash);
}

function historyPath(
  workdir: string,
  namespace: string,
  apiKeyHash: string,
  chatSessionId: string,
): string {
  return path.join(historyDir(workdir, namespace, apiKeyHash), `${chatSessionId}.json`);
}

// ---------------------------------------------------------------------------
// Internal persistence
// ---------------------------------------------------------------------------

async function loadOrCreate(
  workdir: string,
  namespace: string,
  apiKeyHash: string,
  chatSessionId: string,
): Promise<ChatHistory> {
  try {
    const raw = await readFile(historyPath(workdir, namespace, apiKeyHash, chatSessionId), 'utf-8');
    return JSON.parse(raw) as ChatHistory;
  } catch {
    const now = new Date().toISOString();
    return { chatSessionId, namespace, messages: [], createdAt: now, updatedAt: now };
  }
}

async function persist(
  workdir: string,
  namespace: string,
  apiKeyHash: string,
  history: ChatHistory,
): Promise<void> {
  const filePath = historyPath(workdir, namespace, apiKeyHash, history.chatSessionId);
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
  apiKeyHash: string,
  chatSessionId: string,
  userContent: string,
  assistantContent: string,
  assistantMetadata?: Record<string, unknown>,
): Promise<void> {
  const history = await loadOrCreate(workdir, namespace, apiKeyHash, chatSessionId);
  const now = new Date().toISOString();
  const assistantMsg: ChatMessage = {
    id: randomUUID(),
    role: 'assistant',
    content: assistantContent,
    timestamp: now,
  };
  if (assistantMetadata) assistantMsg.metadata = assistantMetadata;
  history.messages.push(
    { id: randomUUID(), role: 'user', content: userContent, timestamp: now },
    assistantMsg,
  );
  await persist(workdir, namespace, apiKeyHash, history);
}

/** Append a single upload card message to the session history. */
export async function appendUploadMessage(
  workdir: string,
  namespace: string,
  apiKeyHash: string,
  chatSessionId: string,
  upload: { id: string; displayName: string; fileSize: number; fileNames: string[] },
): Promise<void> {
  const history = await loadOrCreate(workdir, namespace, apiKeyHash, chatSessionId);
  history.messages.push({
    id: upload.id,
    role: 'upload',
    content: '',
    timestamp: new Date().toISOString(),
    metadata: {
      displayName: upload.displayName,
      fileSize: upload.fileSize,
      fileNames: upload.fileNames,
    },
  });
  await persist(workdir, namespace, apiKeyHash, history);
}

/** Load the full message history for a session. Returns null if none exists. */
export async function loadHistory(
  workdir: string,
  namespace: string,
  apiKeyHash: string,
  chatSessionId: string,
): Promise<ChatHistory | null> {
  try {
    const raw = await readFile(historyPath(workdir, namespace, apiKeyHash, chatSessionId), 'utf-8');
    return JSON.parse(raw) as ChatHistory;
  } catch {
    return null;
  }
}

/** Delete the history file for a session. No-ops if the file does not exist. */
export async function clearHistory(
  workdir: string,
  namespace: string,
  apiKeyHash: string,
  chatSessionId: string,
): Promise<void> {
  try {
    await unlink(historyPath(workdir, namespace, apiKeyHash, chatSessionId));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/**
 * List all sessions for a given namespace + API key, sorted by most recently
 * updated first. Returns an empty array if no sessions exist yet.
 */
export async function listSessions(
  workdir: string,
  namespace: string,
  apiKeyHash: string,
): Promise<SessionSummary[]> {
  const dir = historyDir(workdir, namespace, apiKeyHash);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }

  const summaries: SessionSummary[] = [];
  for (const file of files.filter((f) => f.endsWith('.json'))) {
    try {
      const raw = await readFile(path.join(dir, file), 'utf-8');
      const history = JSON.parse(raw) as ChatHistory;
      const chatMessages = history.messages.filter((m) => m.role !== 'upload');
      const firstUserMsg = chatMessages.find((m) => m.role === 'user');
      summaries.push({
        chatSessionId: history.chatSessionId,
        createdAt: history.createdAt,
        updatedAt: history.updatedAt,
        messageCount: chatMessages.length,
        preview: firstUserMsg ? firstUserMsg.content.slice(0, 80) : '',
      });
    } catch {
      // Skip corrupt or incomplete files
    }
  }

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Returns the chatSessionId of the most recently updated session for this
 * namespace + API key, or null if no sessions exist.
 */
export async function latestSession(
  workdir: string,
  namespace: string,
  apiKeyHash: string,
): Promise<string | null> {
  const sessions = await listSessions(workdir, namespace, apiKeyHash);
  return sessions.length > 0 ? sessions[0].chatSessionId : null;
}
