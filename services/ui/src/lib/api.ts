/**
 * Typed fetch wrappers for the AI Engine API.
 *
 * All requests route through Next.js rewrites:
 *   /api/* -> http://<API_URL>/*
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateSection {
  title: string;
  query: string;
  instruction: string;
}

export interface TemplateInfo {
  /** Filename slug — used for API routing (GET/POST /templates/:id). */
  id: string;
  /** Human-readable display name from the YAML `name:` field. */
  name: string;
  version: string;
  description: string;
  sections: TemplateSection[];
}

export type ProposalStatus = 'draft' | 'under_review' | 'approved' | 'finalized';

export interface ProposalFile {
  fileName: string;
  client: string;
  version: number | null;
  createdAt: string;
  sizeBytes: number;
  status: ProposalStatus | null;
  lockedSections: string[];
}

export interface ProposalMeta {
  status: ProposalStatus;
  lockedSections: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SectionDiff {
  title: string;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
  oldContent?: string;
  newContent?: string;
}

export interface ProposalDocument {
  type: string;
  source: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface GenerateProposalRequest {
  client: string;
  industry?: string;
  namespace?: string;
  template?: string;
  overwrite?: boolean;
  pricing?: {
    teamSize: number;
    durationWeeks: number;
    ratePerWeek: number;
  } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(apiKey: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function fetchNamespaces(apiKey: string): Promise<string[]> {
  const res = await fetch('/api/namespaces', {
    headers: authHeaders(apiKey),
  });
  const data = await handleResponse<{ namespaces: string[] }>(res);
  return data.namespaces;
}

export async function createNamespace(apiKey: string, name: string): Promise<string> {
  const res = await fetch('/api/namespaces', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ name }),
  });
  const data = await handleResponse<{ namespace: string }>(res);
  return data.namespace;
}

export async function fetchTemplates(apiKey: string): Promise<TemplateInfo[]> {
  const res = await fetch('/api/templates', {
    headers: authHeaders(apiKey),
  });
  const data = await handleResponse<{ templates: TemplateInfo[] }>(res);
  return data.templates;
}

export interface TemplateDetail {
  name: string;
  content: string;
  parsed: TemplateInfo;
}

export async function fetchTemplate(apiKey: string, name: string): Promise<TemplateDetail> {
  const res = await fetch(`/api/templates/${encodeURIComponent(name)}`, { headers: authHeaders(apiKey) });
  return handleResponse<TemplateDetail>(res);
}

export async function saveTemplate(apiKey: string, name: string, content: string): Promise<TemplateInfo> {
  const res = await fetch(`/api/templates/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ content }),
  });
  return handleResponse<TemplateInfo>(res);
}

export async function generateTemplate(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch('/api/templates/generate', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ prompt }),
  });
  const data = await handleResponse<{ yaml: string }>(res);
  return data.yaml;
}

export async function modifyTemplate(apiKey: string, templateYaml: string, instruction: string): Promise<string> {
  const res = await fetch('/api/templates/modify', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ templateYaml, instruction }),
  });
  const data = await handleResponse<{ yaml: string }>(res);
  return data.yaml;
}

export async function fetchProposals(apiKey: string): Promise<ProposalFile[]> {
  const res = await fetch('/api/proposals', {
    headers: authHeaders(apiKey),
  });
  const data = await handleResponse<{ proposals: ProposalFile[] }>(res);
  return data.proposals;
}

export async function generateProposal(apiKey: string, request: GenerateProposalRequest): Promise<ProposalDocument> {
  const res = await fetch('/api/generate-proposal', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(request),
  });
  const data = await handleResponse<{ document: ProposalDocument }>(res);
  return data.document;
}

export async function fetchProposalMeta(apiKey: string, fileName: string): Promise<ProposalMeta> {
  const res = await fetch(`/api/proposals/${encodeURIComponent(fileName)}/meta`, { headers: authHeaders(apiKey) });
  const data = await handleResponse<{ meta: ProposalMeta }>(res);
  return data.meta;
}

export async function lockSection(apiKey: string, fileName: string, section: string): Promise<ProposalMeta> {
  const res = await fetch(`/api/proposals/${encodeURIComponent(fileName)}/lock-section`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ section }),
  });
  const data = await handleResponse<{ meta: ProposalMeta }>(res);
  return data.meta;
}

export async function unlockSection(apiKey: string, fileName: string, section: string): Promise<ProposalMeta> {
  const res = await fetch(`/api/proposals/${encodeURIComponent(fileName)}/unlock-section`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ section }),
  });
  const data = await handleResponse<{ meta: ProposalMeta }>(res);
  return data.meta;
}

export async function setProposalStatus(
  apiKey: string,
  fileName: string,
  status: ProposalStatus,
): Promise<ProposalMeta> {
  const res = await fetch(`/api/proposals/${encodeURIComponent(fileName)}/set-status`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ status }),
  });
  const data = await handleResponse<{ meta: ProposalMeta }>(res);
  return data.meta;
}

export async function fetchProposalContent(apiKey: string, fileName: string): Promise<ProposalDocument> {
  const res = await fetch(`/api/proposals/${encodeURIComponent(fileName)}/content`, { headers: authHeaders(apiKey) });
  const data = await handleResponse<{ document: ProposalDocument }>(res);
  return data.document;
}

export async function saveProposalContent(apiKey: string, fileName: string, content: string): Promise<void> {
  const res = await fetch(`/api/proposals/${encodeURIComponent(fileName)}/content`, {
    method: 'PUT',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ content }),
  });
  await handleResponse<{ ok: boolean }>(res);
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export async function fetchMemory(apiKey: string, namespace: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/memory/${encodeURIComponent(namespace)}`, { headers: authHeaders(apiKey) });
  const data = await handleResponse<{ memory: Record<string, unknown> }>(res);
  return data.memory;
}

export async function saveMemory(
  apiKey: string,
  namespace: string,
  memory: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/memory/${encodeURIComponent(namespace)}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ memory }),
  });
  const data = await handleResponse<{ ok: boolean; memory: Record<string, unknown> }>(res);
  return data.memory;
}

// ---------------------------------------------------------------------------
// Namespace Files
// ---------------------------------------------------------------------------

export interface NamespaceFile {
  fileName: string;
  size: number;
  uploadedAt: string;
}

export async function fetchNamespaceFiles(apiKey: string, namespace: string): Promise<NamespaceFile[]> {
  const res = await fetch(`/api/namespaces/${encodeURIComponent(namespace)}/files`, { headers: authHeaders(apiKey) });
  const data = await handleResponse<{ files: NamespaceFile[] }>(res);
  return data.files;
}

export async function deleteNamespaceFile(apiKey: string, namespace: string, fileName: string): Promise<void> {
  const res = await fetch(`/api/namespaces/${encodeURIComponent(namespace)}/files/${encodeURIComponent(fileName)}`, {
    method: 'DELETE',
    headers: authHeaders(apiKey),
  });
  await handleResponse<{ ok: boolean }>(res);
}

// ---------------------------------------------------------------------------
// Knowledge / Async Ingestion
// ---------------------------------------------------------------------------

export type IngestionStatus = 'uploaded' | 'processing' | 'indexed' | 'failed';

export interface IngestionFile {
  fileName: string;
  size: number;
  uploadedAt: string;
  status: IngestionStatus;
  error?: string;
}

export interface KnowledgeUploadResult {
  files: number;
  queued: Array<{ fileName: string; jobId: string }>;
  rejected?: string[];
}

export function uploadKnowledgeFiles(
  apiKey: string,
  namespace: string,
  files: File[],
  onProgress?: (pct: number) => void,
): Promise<KnowledgeUploadResult> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('namespace', namespace);
    for (const file of files) {
      formData.append('files', file, file.name);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/knowledge/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.addEventListener('load', () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body as KnowledgeUploadResult);
        } else {
          reject(new Error(body.error ?? `HTTP ${xhr.status}`));
        }
      } catch {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.send(formData);
  });
}

export async function fetchKnowledgeFiles(apiKey: string, namespace: string): Promise<IngestionFile[]> {
  const res = await fetch(`/api/knowledge/files?namespace=${encodeURIComponent(namespace)}`, {
    headers: authHeaders(apiKey),
  });
  const data = await handleResponse<{ files: IngestionFile[] }>(res);
  return data.files;
}

export async function reindexKnowledgeFile(apiKey: string, namespace: string, fileName: string): Promise<void> {
  const res = await fetch('/api/knowledge/reindex', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ namespace, fileName }),
  });
  await handleResponse<{ ok: boolean }>(res);
}

// ---------------------------------------------------------------------------
// Upload / Ingest
// ---------------------------------------------------------------------------

export interface UploadResult {
  files: number;
  documents: number;
  chunks: number;
  rejected?: string[];
}

export function uploadFiles(
  apiKey: string,
  namespace: string,
  files: File[],
  onProgress?: (pct: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('namespace', namespace);
    for (const file of files) {
      formData.append('files', file, file.name);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.addEventListener('load', () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body as UploadResult);
        } else {
          reject(new Error(body.error ?? `HTTP ${xhr.status}`));
        }
      } catch {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.send(formData);
  });
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export interface PresentationSection {
  id: string;
  title: string;
  content: string;
}

export interface PresentationConfig {
  theme: 'light' | 'dark' | 'brand';
  accentColor: string;
  hiddenSections: string[];
  showPricing: boolean;
}

export interface Presentation {
  namespace: string;
  proposalId: string;
  fileName: string;
  config: PresentationConfig;
  sections: PresentationSection[];
  createdAt: string;
  updatedAt: string;
}

export async function fetchPresentations(apiKey: string, namespace: string): Promise<Presentation[]> {
  const res = await fetch(`/api/presentations?namespace=${encodeURIComponent(namespace)}`, {
    headers: authHeaders(apiKey),
  });
  const data = await handleResponse<{ presentations: Presentation[] }>(res);
  return data.presentations;
}

export async function createPresentation(apiKey: string, fileName: string, namespace: string): Promise<Presentation> {
  const res = await fetch('/api/presentations/create', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ fileName, namespace }),
  });
  const data = await handleResponse<{ presentation: Presentation }>(res);
  return data.presentation;
}

export async function fetchPresentation(apiKey: string, namespace: string, proposalId: string): Promise<Presentation> {
  const res = await fetch(`/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}`, {
    headers: authHeaders(apiKey),
  });
  const data = await handleResponse<{ presentation: Presentation }>(res);
  return data.presentation;
}

export async function savePresentationConfig(
  apiKey: string,
  namespace: string,
  proposalId: string,
  config: PresentationConfig,
): Promise<Presentation> {
  const res = await fetch(
    `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/config`,
    {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(config),
    },
  );
  const data = await handleResponse<{ presentation: Presentation }>(res);
  return data.presentation;
}

export async function generateMicrosite(apiKey: string, namespace: string, proposalId: string): Promise<string[]> {
  const res = await fetch(
    `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/generate`,
    {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({}),
    },
  );
  const data = await handleResponse<{ assets: string[] }>(res);
  return data.assets ?? [];
}

export interface SynthesizedDesignSystem {
  designSystem: Record<string, unknown>;
  fonts: { family: string; url: string }[];
}

export async function synthesizeDesignStyle(
  apiKey: string,
  image: string,
  basePlugin: string,
  brandPrimaryColor?: string,
  textPrompt?: string,
): Promise<SynthesizedDesignSystem> {
  const res = await fetch('/api/presentations/synthesize-style', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ image, basePlugin, brandPrimaryColor, textPrompt }),
  });
  return handleResponse<SynthesizedDesignSystem>(res);
}

export async function fetchMicrositeContent(
  apiKey: string,
  namespace: string,
  proposalId: string,
): Promise<unknown | null> {
  const res = await fetch(
    `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/microsite`,
    { headers: authHeaders(apiKey) },
  );
  const data = await handleResponse<{ ast: unknown | null }>(res);
  return data.ast;
}

export interface MicrositeHistoryServerEntry {
  namespace: string;
  savedAt: string;
  ast: unknown;
}

export async function fetchAllMicrositeHistory(apiKey: string): Promise<MicrositeHistoryServerEntry[]> {
  const res = await fetch('/api/presentations/history', { headers: authHeaders(apiKey) });
  const data = await handleResponse<{ entries: MicrositeHistoryServerEntry[] }>(res);
  return data.entries;
}

export async function designEditMicrosite(
  apiKey: string,
  namespace: string,
  proposalId: string,
  body: { instruction: string; targetSectionId?: string; currentAst?: unknown; commit?: boolean },
): Promise<{ ast: unknown; mode: string; changed: string[]; summary: string }> {
  const res = await fetch(
    `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/design-edit`,
    {
      method: 'POST',
      headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return handleResponse<{ ast: unknown; mode: string; changed: string[]; summary: string }>(res);
}

export async function publishMicrosite(
  apiKey: string,
  namespace: string,
  proposalId: string,
  ast?: unknown,
): Promise<{ downloadUrl: string; size: number }> {
  const res = await fetch(
    `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/publish`,
    {
      method: 'POST',
      headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ast, format: 'html' }),
    },
  );
  return handleResponse<{ downloadUrl: string; size: number }>(res);
}

// ---------------------------------------------------------------------------
// Namespace Configuration
// ---------------------------------------------------------------------------

export async function fetchNamespaceConfig(apiKey: string, namespace: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/config/${encodeURIComponent(namespace)}`, { headers: authHeaders(apiKey) });
  const data = await handleResponse<{ namespace: string; config: Record<string, unknown> }>(res);
  return data.config;
}

export async function saveNamespaceConfig(
  apiKey: string,
  namespace: string,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/config/${encodeURIComponent(namespace)}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ config }),
  });
  const data = await handleResponse<{ ok: boolean; namespace: string; config: Record<string, unknown> }>(res);
  return data.config;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export interface AgentRunRequest {
  agent: string;
  namespace: string;
  input: {
    metadata?: Record<string, unknown>;
    prompt?: string;
    documents?: string[];
    config?: Record<string, unknown>;
    memory?: Record<string, unknown>;
  };
}

export interface AgentRunResult {
  markdown?: string;
  json?: unknown;
  assets?: string[];
}

export type StreamEvent =
  | { type: 'start'; message: string }
  | { type: 'section'; id: string; heading: string; sectionType: string; content: Record<string, unknown> }
  | { type: 'image'; sectionId: string; url: string }
  | { type: 'complete'; ast: unknown }
  | { type: 'error'; message: string };

export interface GenerateStreamOptions {
  proposalMarkdown: string;
  plugin?: string | null;
  brand?: Record<string, unknown>;
  designBrief?: string;
  preSynthesizedDesignSystem?: Record<string, unknown>;
  onEvent: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

export async function generateMicrositeStream(
  apiKey: string,
  namespace: string,
  proposalId: string,
  opts: GenerateStreamOptions,
): Promise<void> {
  const res = await fetch(`/api/presentations/${namespace}/${proposalId}/generate-stream`, {
    method: 'POST',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proposalMarkdown: opts.proposalMarkdown,
      plugin: opts.plugin ?? 'cobalt',
      brand: opts.brand ?? {},
      designBrief: opts.designBrief ?? '',
      ...(opts.preSynthesizedDesignSystem ? { preSynthesizedDesignSystem: opts.preSynthesizedDesignSystem } : {}),
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Stream request failed (${res.status}): ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6)) as StreamEvent;
          opts.onEvent(event);
        } catch { /* malformed line — skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function runAgent(apiKey: string, request: AgentRunRequest): Promise<AgentRunResult> {
  const res = await fetch('/api/agent/run', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(request),
  });
  const data = await handleResponse<{ result: AgentRunResult }>(res);
  return data.result;
}

export async function fetchAgents(apiKey: string): Promise<{ name: string; description: string }[]> {
  const res = await fetch('/api/agent/list', {
    headers: authHeaders(apiKey),
  });
  const data = await handleResponse<{ agents: { name: string; description: string }[] }>(res);
  return data.agents;
}

// ---------------------------------------------------------------------------
// Execution trace
// ---------------------------------------------------------------------------

export interface TraceStep {
  id: string;
  type: string; // "planner" | "agent" | "tool" | "layout"
  name: string;
  status: 'completed' | 'failed' | 'running';
  startedAt: number;
  endedAt?: number;
  inputSummary?: string;
  outputSummary?: string;
}

export interface ExecutionTrace {
  executionId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  type?: string;
  durationMs?: number;
  model?: string;
  tokens?: number;
  cost?: number;
  artifactId?: string;
  steps: TraceStep[];
}

export async function fetchExecutionTrace(apiKey: string, executionId: string): Promise<ExecutionTrace> {
  const res = await fetch(`/api/ai-executions/${executionId}/trace`, {
    headers: authHeaders(apiKey),
  });
  return handleResponse<ExecutionTrace>(res);
}
// AI Image generation
// ---------------------------------------------------------------------------

export async function generateSectionImage(
  apiKey: string,
  sectionTitle: string,
  style: string,
  keywords: string[],
): Promise<string> {
  const res = await fetch('/api/images/generate', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ sectionTitle, style, keywords }),
  });
  const data = await handleResponse<{ url: string }>(res);
  return data.url;
}

// ---------------------------------------------------------------------------
// Proposal diff
// ---------------------------------------------------------------------------

export async function fetchProposalDiff(apiKey: string, fileA: string, fileB: string): Promise<SectionDiff[]> {
  const res = await fetch('/api/proposal-diff', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ fileA, fileB }),
  });
  const data = await handleResponse<{ diffs: SectionDiff[] }>(res);
  return data.diffs;
}
