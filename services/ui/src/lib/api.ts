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
  projectType?: string;
  clientIndustry?: string;
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

function authHeadersNoBody(apiKey: string): HeadersInit {
  return {
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

export async function createNamespace(apiKey: string, name: string, clientName?: string): Promise<string> {
  const res = await fetch('/api/namespaces', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ name, ...(clientName ? { clientName } : {}) }),
  });
  const data = await handleResponse<{ namespace: string }>(res);
  return data.namespace;
}

export async function deleteNamespace(apiKey: string, namespace: string): Promise<void> {
  const res = await fetch(`/api/namespaces/${encodeURIComponent(namespace)}`, {
    method: 'DELETE',
    headers: authHeadersNoBody(apiKey),
  });
  await handleResponse<unknown>(res);
}

export async function renameNamespace(apiKey: string, oldName: string, newName: string): Promise<void> {
  const res = await fetch(`/api/namespaces/${encodeURIComponent(oldName)}/rename`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ name: newName }),
  });
  await handleResponse<unknown>(res);
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

export async function deleteTemplate(apiKey: string, name: string): Promise<void> {
  const res = await fetch(`/api/templates/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: authHeadersNoBody(apiKey),
  });
  await handleResponse<{ deleted: string }>(res);
}

export async function deleteProposal(apiKey: string, namespace: string, fileName: string): Promise<void> {
  const res = await fetch(`/api/proposals/${encodeURIComponent(namespace)}/${encodeURIComponent(fileName)}`, {
    method: 'DELETE',
    headers: authHeadersNoBody(apiKey),
  });
  await handleResponse<{ deleted: string }>(res);
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
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  await handleResponse<{ ok: boolean }>(res);
}

// ---------------------------------------------------------------------------
// Knowledge / Async Ingestion
// ---------------------------------------------------------------------------

export type IngestionStatus = 'uploaded' | 'processing' | 'indexed' | 'extracting' | 'extracted' | 'failed';

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
  classification?: DocumentClassification,
): Promise<KnowledgeUploadResult> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('namespace', namespace);
    if (classification) formData.append('classification', classification);
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

export async function postUploadMessage(
  apiKey: string,
  chatSessionId: string,
  namespace: string,
  upload: { id: string; displayName: string; fileSize: number; fileNames: string[] },
): Promise<void> {
  const res = await fetch(`/api/chat/session/${encodeURIComponent(chatSessionId)}/upload-message`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ namespace, ...upload }),
  });
  await handleResponse<{ ok: boolean }>(res);
}

export async function deleteKnowledgeFile(apiKey: string, namespace: string, fileName: string): Promise<void> {
  const res = await fetch(
    `/api/knowledge/files/${encodeURIComponent(fileName)}?namespace=${encodeURIComponent(namespace)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${apiKey}` } },
  );
  await handleResponse<{ ok: boolean }>(res);
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

export interface GenerateMicrositeOptions {
  proposalMarkdown: string;
  plugin?: string;
  brand?: Record<string, unknown>;
  customInstructions?: string;
  preSynthesizedDesignSystem?: Record<string, unknown>;
}

export async function generateMicrosite(
  apiKey: string,
  namespace: string,
  proposalId: string,
  options: GenerateMicrositeOptions,
): Promise<{ ast: unknown; assets: string[] }> {
  const res = await fetch(
    `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/generate`,
    {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(options),
    },
  );
  const data = await handleResponse<{ ast: unknown; assets: string[] }>(res);
  return { ast: data.ast ?? null, assets: data.assets ?? [] };
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
  mode?: 'pro' | 'classic',
  entryId?: string,
): Promise<{ ast: unknown | null; savedAt: string | null }> {
  const params = new URLSearchParams();
  if (mode) params.set('mode', mode);
  if (entryId) params.set('entryId', entryId);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(
    `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/microsite${qs}`,
    { headers: authHeaders(apiKey) },
  );
  const data = await handleResponse<{ ast: unknown | null; savedAt: string | null }>(res);
  return { ast: data.ast ?? null, savedAt: data.savedAt ?? null };
}

export async function saveMicrositeAst(apiKey: string, namespace: string, proposalId: string, ast: unknown, entryId?: string): Promise<void> {
  const qs = entryId ? `?entryId=${encodeURIComponent(entryId)}` : '';
  const res = await fetch(`/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/microsite${qs}`, {
    method: 'PUT',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ast }),
  });
  await handleResponse<{ ok: boolean }>(res);
}

export interface MicrositeHistoryServerEntry {
  id: string;
  namespace: string;
  savedAt: string;
  ast: unknown;
  source?: string;
  type?: string;
  version?: number;
  title?: string;
}

export async function saveMicrositeHistoryToServer(apiKey: string, namespace: string, ast: unknown): Promise<{ id: string; version: number }> {
  const res = await fetch('/api/presentations/history/save', {
    method: 'POST',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ namespace, ast }),
  });
  return handleResponse<{ ok: boolean; id: string; version: number }>(res);
}

export async function deleteMicrositeHistoryFromServer(apiKey: string, namespace: string, entryId: string): Promise<void> {
  const res = await fetch(
    `/api/presentations/history/${encodeURIComponent(namespace)}?entryId=${encodeURIComponent(entryId)}`,
    { method: 'DELETE', headers: authHeadersNoBody(apiKey) },
  );
  await handleResponse<{ ok: boolean }>(res);
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
  | { type: 'progress'; message: string }
  | { type: 'plan'; totalSections: number; sectionTypes: string[] }
  | { type: 'section'; id: string; heading: string; sectionType: string; content: Record<string, unknown>; index?: number; image?: { source: string; query: string; url: string | null; fallback: string }; editable?: boolean; version?: number }
  | { type: 'image'; sectionId: string; url: string }
  | { type: 'section_html'; id: string; customHtml: string }
  | { type: 'complete'; ast: unknown }
  | { type: 'error'; message: string };

export interface BusinessIntel {
  brandIdentity: {
    brandName: string;
    tagline: string | null;
    missionStatement: string | null;
    brandVoice: string;
    brandPersonality: string;
  };
  businessIdentity: {
    industry: string;
    businessType: string;
    companyDescription: string;
    productsOrServices: string[];
    pricingModel: string;
  };
  digitalAudit: {
    seoTitle: string;
    metaDescription: string | null;
    hasAnalytics: boolean;
    hasChatWidget: boolean;
    techStack: string[];
    internationalPresence: boolean;
    languages: string[];
  };
  contactIntel: {
    emails: string[];
    phones: string[];
    address: string | null;
    socialProfiles: Record<string, string>;
    hasContactForm: boolean;
    hasLiveChat: boolean;
  };
  contentAnalysis: {
    primaryCTA: string;
    secondaryCTAs: string[];
    keyMessages: string[];
    contentTone: string;
    hasTestimonials: boolean;
    hasCaseStudies: boolean;
    hasPricing: boolean;
    hasVideo: boolean;
  };
  competitiveContext: {
    uniqueSellingPoints: string[];
    targetAudience: string;
    positioning: string;
    competitiveAdvantages: string[];
    marketCategory: string;
  };
}

export interface ReferenceDesign {
  colors: {
    primary: string; secondary: string; accent: string;
    background: string; surface: string; text: string; textMuted: string;
  };
  typography: {
    headingFont: string; bodyFont: string;
    headingWeight: string; bodyWeight: string;
    headingStyle: 'serif' | 'sans-serif' | 'display';
    mood: 'modern' | 'classic' | 'bold' | 'minimal' | 'playful';
  };
  style: {
    borderRadius: 'sharp' | 'soft' | 'rounded';
    spacing: 'compact' | 'comfortable' | 'spacious';
    vibe: string;
  };
  heroImageUrl?: string | null;
}

export interface GenerateStreamOptions {
  proposalMarkdown: string;
  plugin?: string | null;
  brand?: Record<string, unknown>;
  customInstructions?: string;
  fullDesignPrompt?: string;
  designBrief?: string;
  preSynthesizedDesignSystem?: Record<string, unknown>;
  pdfFriendly?: boolean;
  referenceFile?: { base64: string; mediaType: string; fileName: string; dominantColors?: string[] };
  urlReferenceDesign?: ReferenceDesign | null;
  urlLayout?: Record<string, unknown> | null;
  urlImages?: string[];
  /** 'classic' skips the design-skill pipeline (plugin theme drives styling).
   *  'pro' or absent uses the full skill pipeline for URL-driven generation. */
  generationMode?: 'pro' | 'classic';
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
      ...(opts.customInstructions ? { customInstructions: opts.customInstructions } : {}),
      ...(opts.fullDesignPrompt ? { fullDesignPrompt: opts.fullDesignPrompt } : {}),
      ...(opts.designBrief ? { designBrief: opts.designBrief } : {}),
      ...(opts.preSynthesizedDesignSystem ? { preSynthesizedDesignSystem: opts.preSynthesizedDesignSystem } : {}),
      ...(opts.pdfFriendly ? { pdfFriendly: true } : {}),
      ...(opts.referenceFile ? { referenceFile: opts.referenceFile } : {}),
      ...(opts.urlReferenceDesign ? { urlReferenceDesign: opts.urlReferenceDesign } : {}),
      ...(opts.urlLayout ? { urlLayout: opts.urlLayout } : {}),
      ...(opts.urlImages?.length ? { urlImages: opts.urlImages } : {}),
      ...(opts.generationMode ? { generationMode: opts.generationMode } : {}),
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

// ---------------------------------------------------------------------------
// Classic microsite generation — always hits generate-classic-stream
// No design-skill pipeline; plugin theme drives styling; TypeScript section components render
// ---------------------------------------------------------------------------

export interface ClassicStreamOptions {
  proposalMarkdown: string;
  plugin?: string | null;
  brand?: Record<string, unknown>;
  customInstructions?: string;
  fullDesignPrompt?: string;
  designBrief?: string;
  preSynthesizedDesignSystem?: Record<string, unknown>;
  pdfFriendly?: boolean;
  referenceFile?: { base64: string; mediaType: string; fileName: string; dominantColors?: string[] };
  /** Only heroImageUrl is used by Classic — no CSS extraction */
  urlReferenceDesign?: ReferenceDesign | null;
  urlImages?: string[];
  onEvent: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

export async function generateClassicMicrositeStream(
  apiKey: string,
  namespace: string,
  proposalId: string,
  opts: ClassicStreamOptions,
): Promise<void> {
  const res = await fetch(`/api/presentations/${namespace}/${proposalId}/generate-stream`, {
    method: 'POST',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proposalMarkdown: opts.proposalMarkdown,
      plugin: opts.plugin ?? 'cobalt',
      brand: opts.brand ?? {},
      generationMode: 'classic',
      ...(opts.customInstructions ? { customInstructions: opts.customInstructions } : {}),
      ...(opts.fullDesignPrompt ? { fullDesignPrompt: opts.fullDesignPrompt } : {}),
      ...(opts.designBrief ? { designBrief: opts.designBrief } : {}),
      ...(opts.preSynthesizedDesignSystem ? { preSynthesizedDesignSystem: opts.preSynthesizedDesignSystem } : {}),
      ...(opts.pdfFriendly ? { pdfFriendly: true } : {}),
      ...(opts.referenceFile ? { referenceFile: opts.referenceFile } : {}),
      ...(opts.urlReferenceDesign ? { urlReferenceDesign: opts.urlReferenceDesign } : {}),
      ...(opts.urlImages?.length ? { urlImages: opts.urlImages } : {}),
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Classic stream request failed (${res.status}): ${text}`);
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

// ---------------------------------------------------------------------------
// Direct single-pass generation (bypasses multi-step agent pipeline)
// ---------------------------------------------------------------------------

export interface DirectStreamEvent {
  type: 'start' | 'html_chunk' | 'complete' | 'error';
  chunk?: string;
  elapsed?: number;
  size?: number;
  message?: string;
}

/** Stream direct single-pass HTML generation. */
export async function generateMicrositeDirectStream(
  apiKey: string,
  namespace: string,
  proposalId: string,
  opts: { proposalMarkdown?: string; brandConfig?: Record<string, unknown>; signal?: AbortSignal },
  onEvent: (event: DirectStreamEvent) => void,
): Promise<void> {
  const res = await fetch(
    `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/generate-direct-stream`,
    {
      method: 'POST',
      headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(opts.proposalMarkdown ? { proposalMarkdown: opts.proposalMarkdown } : {}),
        ...(opts.brandConfig ? { brandConfig: opts.brandConfig } : {}),
      }),
      signal: opts.signal,
    },
  );

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Direct stream request failed (${res.status}): ${text}`);
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
          const event = JSON.parse(line.slice(6)) as DirectStreamEvent;
          onEvent(event);
        } catch { /* malformed line — skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── MicrositeEditorPro API functions ─────────────────────────────────────────

/** Regenerate the customHtml for a single section without touching other sections. */
export async function regenerateSection(
  apiKey: string,
  namespace: string,
  proposalId: string,
  body: { sectionId: string; currentAst: unknown },
): Promise<{ sectionId: string; html: string; elapsed: number }> {
  const res = await fetch(
    `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/regenerate-section`,
    {
      method: 'POST',
      headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Regenerate failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<{ sectionId: string; html: string; elapsed: number }>;
}

/** Apply a natural language instruction to a section's HTML. Returns modified HTML only. */
export async function editSectionHtml(
  apiKey: string,
  namespace: string,
  proposalId: string,
  body: { sectionHtml: string; instruction: string },
): Promise<{ html: string }> {
  const res = await fetch(
    `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/edit-section-html`,
    {
      method: 'POST',
      headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Edit failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<{ html: string }>;
}

/** Direct LLM: given current CSS tokens + instruction, returns only the changed token values. */
export async function editDesignTokens(
  apiKey: string,
  namespace: string,
  proposalId: string,
  body: { instruction: string; currentTokens: Record<string, string> },
): Promise<{ tokens: Record<string, string>; changed: string[]; summary: string }> {
  const res = await fetch(
    `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/edit-tokens`,
    {
      method: 'POST',
      headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Token edit failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<{ tokens: Record<string, string>; changed: string[]; summary: string }>;
}

/** Non-streaming single-pass generation. One LLM call, returns when complete. */
export async function generateMicrositeDirectly(
  apiKey: string,
  namespace: string,
  proposalId: string,
  designSkillSlug?: string,
): Promise<{ html: string; elapsed: number }> {
  const res = await fetch(
    `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/generate-direct`,
    {
      method: 'POST',
      headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(designSkillSlug ? { designSkillSlug } : {}),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Direct generation failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<{ html: string; elapsed: number }>;
}

/** Fetch the directly-generated HTML file. Returns null if not yet generated. */
export async function fetchMicrositeDirectHtml(
  apiKey: string,
  namespace: string,
  proposalId: string,
): Promise<string | null> {
  const res = await fetch(
    `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/site-html`,
    { headers: authHeadersNoBody(apiKey) },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
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
  namespace?: string,
  sectionId?: string,
): Promise<string> {
  const res = await fetch('/api/images/generate', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ sectionTitle, style, keywords, namespace, sectionId }),
  });
  const data = await handleResponse<{ url: string }>(res);
  // Rewrite root-relative local paths through the Next.js proxy
  if (data.url.startsWith('/presentation-images/')) {
    return `/api${data.url}`;
  }
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

// ---------------------------------------------------------------------------
// Proposal section editing (chat inline)
// ---------------------------------------------------------------------------

export interface ProposalSectionEditRequest {
  namespace: string;
  artifactId: string;
  section: string;
  /** Instruction-based rewrite via LLM. */
  instruction?: string;
  /** Verbatim replacement (direct user edit). */
  newContent?: string;
}

export interface ProposalSectionEditResult {
  content: string;
  versionLabel: string;
}

export async function editProposalSection(
  apiKey: string,
  req: ProposalSectionEditRequest,
): Promise<ProposalSectionEditResult> {
  const res = await fetch('/api/chat/proposal/section/edit', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(req),
  });
  return handleResponse<ProposalSectionEditResult>(res);
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export interface SectionConditionApi {
  field: string;
  operator: 'exists' | 'equals' | 'contains';
  value?: string;
}

export interface SectionDefinitionApi {
  id: string;
  title: string;
  order: number;
  required: boolean;
  promptHint: string;
  maxWords?: number;
  minWords?: number;
  assetRef?: string;
  useRagContext: boolean;
  ragQuery?: string;
  condition?: SectionConditionApi;
}

export interface PricingTierApi {
  name: string;
  description: string;
  priceRange?: string;
  features: string[];
  duration?: string;
}

export interface PricingDefaultsApi {
  model: 'hourly' | 'fixed' | 'tiered' | 'retainer';
  rates?: Record<string, number>;
  tiers?: PricingTierApi[];
  discounts?: string[];
  currency: string;
}

export interface MicrositeDefaultsApi {
  theme?: string;
  primaryColor?: string;
  secondaryColor?: string;
  tagline?: string;
  logoAsset?: string;
}

export interface SkillApi {
  slug: string;
  displayName: string;
  description: string;
  industries: string[];
  projectTypes: string[];
  tags: string[];
  defaultTemplate?: string;
  toneDescription: string;
  micrositeDefaults: MicrositeDefaultsApi;
  pricingDefaults?: PricingDefaultsApi;
  author: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  scope: 'global' | 'namespace';
  namespace?: string;
}

export interface SkillSummaryApi {
  slug: string;
  displayName: string;
  description: string;
  industries: string[];
  version: string;
  updatedAt: string;
}

export interface SkillDetailApi {
  skill: SkillApi;
  instructionsMd: string;
  sections: SectionDefinitionApi[];
}

export interface GeneratedSkillApi {
  displayName: string;
  description: string;
  industries: string[];
  projectTypes: string[];
  tags: string[];
  toneDescription: string;
  instructions: string;
  sections: SectionDefinitionApi[];
  pricingDefaults?: PricingDefaultsApi;
  micrositeDefaults?: MicrositeDefaultsApi;
  suggestedAssets?: Array<{ fileName: string; description: string; content: string }>;
}

export interface AssetInfoApi {
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  referencedBySections: string[];
}

export async function listSkills(apiKey: string): Promise<SkillSummaryApi[]> {
  const res = await fetch('/api/skills', { headers: authHeadersNoBody(apiKey) });
  const data = await handleResponse<{ skills: SkillSummaryApi[] }>(res);
  return data.skills;
}

export async function getSkillDetail(apiKey: string, slug: string): Promise<SkillDetailApi> {
  const res = await fetch(`/api/skills/${encodeURIComponent(slug)}`, { headers: authHeadersNoBody(apiKey) });
  return handleResponse<SkillDetailApi>(res);
}

export async function createSkillApi(
  apiKey: string,
  skill: Partial<SkillApi> & { instructionsMd?: string; sections?: SectionDefinitionApi[] },
): Promise<SkillApi> {
  const res = await fetch('/api/skills', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(skill),
  });
  const data = await handleResponse<{ skill: SkillApi }>(res);
  return data.skill;
}

export async function updateSkillApi(
  apiKey: string,
  slug: string,
  updates: Partial<SkillApi> & { instructionsMd?: string; sections?: SectionDefinitionApi[] },
): Promise<SkillApi> {
  const res = await fetch(`/api/skills/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: authHeaders(apiKey),
    body: JSON.stringify(updates),
  });
  const data = await handleResponse<{ skill: SkillApi }>(res);
  return data.skill;
}

export async function deleteSkillApi(apiKey: string, slug: string): Promise<void> {
  const res = await fetch(`/api/skills/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: authHeadersNoBody(apiKey),
  });
  await handleResponse<{ deleted: string }>(res);
}

export async function generateSkillApi(apiKey: string, description: string): Promise<GeneratedSkillApi> {
  const res = await fetch('/api/skills/generate', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ description }),
  });
  const data = await handleResponse<{ generated: GeneratedSkillApi }>(res);
  return data.generated;
}

export async function generateSkillFromProposalApi(
  apiKey: string,
  namespace: string,
  proposalFileName: string,
): Promise<GeneratedSkillApi> {
  const res = await fetch('/api/skills/generate-from-proposal', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ namespace, proposalFileName }),
  });
  const data = await handleResponse<{ generated: GeneratedSkillApi }>(res);
  return data.generated;
}

export async function applySkillAssistApi(
  apiKey: string,
  slug: string,
  tab: string,
  currentContent: unknown,
  instruction: string,
): Promise<Partial<GeneratedSkillApi>> {
  const res = await fetch(`/api/skills/${encodeURIComponent(slug)}/assist`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ tab, currentContent, instruction }),
  });
  const data = await handleResponse<{ result: Partial<GeneratedSkillApi> }>(res);
  return data.result;
}

export async function uploadSkillAssetApi(
  apiKey: string,
  slug: string,
  file: File,
): Promise<{ fileName: string; sizeBytes: number }> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  const res = await fetch(`/api/skills/${encodeURIComponent(slug)}/assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
  const data = await handleResponse<{ asset: { fileName: string; sizeBytes: number } }>(res);
  return data.asset;
}

export async function deleteSkillAssetApi(apiKey: string, slug: string, fileName: string): Promise<void> {
  const res = await fetch(`/api/skills/${encodeURIComponent(slug)}/assets/${encodeURIComponent(fileName)}`, {
    method: 'DELETE',
    headers: authHeadersNoBody(apiKey),
  });
  await handleResponse<{ deleted: string }>(res);
}

export async function listSkillAssetsApi(apiKey: string, slug: string): Promise<AssetInfoApi[]> {
  const res = await fetch(`/api/skills/${encodeURIComponent(slug)}/assets`, {
    headers: authHeadersNoBody(apiKey),
  });
  const data = await handleResponse<{ assets: AssetInfoApi[] }>(res);
  return data.assets;
}

// ---------------------------------------------------------------------------
// Design Skills
// ---------------------------------------------------------------------------

export type AestheticToneApi =
  | 'brutally minimal'
  | 'maximalist chaos'
  | 'retro-futuristic'
  | 'organic/natural'
  | 'luxury/refined'
  | 'playful/toy-like'
  | 'editorial/magazine'
  | 'brutalist/raw'
  | 'art deco/geometric'
  | 'soft/pastel'
  | 'industrial/utilitarian';

export interface DesignSkillApi {
  slug: string
  displayName: string
  description: string
  aestheticTone: AestheticToneApi
  colorPalette: { primary: string; secondary?: string; background?: string }
  typography: {
    headingFont: string
    bodyFont: string
    headingStyle: 'bold' | 'playful' | 'editorial' | 'minimal' | 'strong'
  }
  animations: 'none' | 'minimal' | 'smooth' | 'playful' | 'bounce'
  customInstructions: string
  themeClass: 'dark' | 'light' | 'colorful'
  createdAt: string
  updatedAt: string
}

export interface DesignSkillSummaryApi {
  slug: string
  displayName: string
  description: string
  aestheticTone: AestheticToneApi
  themeClass: 'dark' | 'light' | 'colorful'
  colorPalette: { primary: string; secondary?: string; background?: string }
  updatedAt: string
}

export async function listDesignSkillsApi(apiKey: string): Promise<DesignSkillSummaryApi[]> {
  const res = await fetch('/api/design-skills', { headers: authHeadersNoBody(apiKey) });
  const data = await handleResponse<{ skills: DesignSkillSummaryApi[] }>(res);
  return data.skills;
}

export async function getDesignSkillApi(apiKey: string, slug: string): Promise<DesignSkillApi> {
  const res = await fetch(`/api/design-skills/${encodeURIComponent(slug)}`, { headers: authHeadersNoBody(apiKey) });
  const data = await handleResponse<{ skill: DesignSkillApi }>(res);
  return data.skill;
}

export async function createDesignSkillApi(
  apiKey: string,
  skill: Partial<DesignSkillApi> & { displayName: string },
): Promise<DesignSkillApi> {
  const res = await fetch('/api/design-skills', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(skill),
  });
  const data = await handleResponse<{ skill: DesignSkillApi }>(res);
  return data.skill;
}

export async function updateDesignSkillApi(
  apiKey: string,
  slug: string,
  updates: Partial<Omit<DesignSkillApi, 'slug' | 'createdAt'>>,
): Promise<DesignSkillApi> {
  const res = await fetch(`/api/design-skills/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    headers: authHeaders(apiKey),
    body: JSON.stringify(updates),
  });
  const data = await handleResponse<{ skill: DesignSkillApi }>(res);
  return data.skill;
}

export async function deleteDesignSkillApi(apiKey: string, slug: string): Promise<void> {
  const res = await fetch(`/api/design-skills/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: authHeadersNoBody(apiKey),
  });
  await handleResponse<{ deleted: string }>(res);
}

// ---------------------------------------------------------------------------
// Brief Panel
// ---------------------------------------------------------------------------

export type DocumentClassification =
  | 'client_source'
  | 'conversation'
  | 'provider_asset'
  | 'reference_example'
  | 'background';

export type RequirementKey =
  | 'clientName'
  | 'clientIndustry'
  | 'projectType'
  | 'budget'
  | 'timeline'
  | 'teamSize'
  | 'technicalStack'
  | 'keyObjectives'
  | 'constraints'
  | 'deliverables'
  | 'stakeholders'
  | 'contactName';

export interface RequirementField {
  value: unknown;
  confidence: number;
  source: 'user' | 'document' | 'inferred';
  updatedAt: string;
  sourceFile?: string;
  confirmedByUser?: { at: string };
  pendingConfirmation?: boolean;
}

export interface BriefFieldStatus {
  filled: boolean;
  confidence?: number;
  pendingConfirmation?: boolean;
  sourceFile?: string;
}

export interface BriefReadiness {
  tier1: {
    complete: boolean;
    fields: Record<'clientName' | 'clientIndustry' | 'projectType', BriefFieldStatus>;
    missingFields: string[];
  };
  tier2: {
    complete: boolean;
    missingFields: string[];
  };
  canGenerate: boolean;
  blockingField?: string;
}

export interface ConflictRecord {
  key: RequirementKey;
  incomingValue: unknown;
  incomingConfidence: number;
  incomingSourceFile: string;
  existingValue: unknown;
  existingConfidence: number;
  existingSourceFile?: string;
}

export interface PendingExtraction {
  cardId: string;
  documentId: string;
  fileName: string;
  extractedAt: string;
  expiresAt?: string;
  status?: 'pending' | 'confirmed' | 'discarded';
  classification?: DocumentClassification;
  fields: Partial<Record<RequirementKey, RequirementField>>;
  knowledgeEntries?: KnowledgeEntry[];
  conflicts?: ConflictRecord[];
}

export interface ContextSource {
  fileName: string;
  documentType: string;
  extractedAt: string;
  fieldsExtracted: RequirementKey[];
  knowledgeEntriesCreated: number;
  preprocessConfidence: number;
  classification?: DocumentClassification;
}

export type KnowledgeCategory =
  | 'context' | 'metric' | 'problem' | 'priority' | 'requirement'
  | 'opportunity' | 'constraint' | 'decision' | 'action_item' | 'preference';

export interface KnowledgeEntry {
  id: string;
  content: string;
  category: KnowledgeCategory;
  importance: number;
  source: {
    type: 'document' | 'chat' | 'manual';
    fileName?: string;
  };
  extractedAt: string;
  confidence: number;
  supersededBy?: string;
}

export interface BriefContext {
  requirements: {
    fields: Partial<Record<RequirementKey, RequirementField>>;
  };
  sources: ContextSource[];
  pendingExtractions?: PendingExtraction[];
  knowledge?: KnowledgeEntry[];
}

export async function fetchBriefReadiness(
  apiKey: string,
  namespace: string,
): Promise<{ readiness: BriefReadiness; context: BriefContext }> {
  const res = await fetch(
    `/api/namespaces/${encodeURIComponent(namespace)}/context/readiness`,
    { headers: authHeadersNoBody(apiKey) },
  );
  return handleResponse<{ readiness: BriefReadiness; context: BriefContext }>(res);
}

export async function updateContextField(
  apiKey: string,
  namespace: string,
  key: RequirementKey,
  value: unknown,
): Promise<{ field: RequirementField; readiness: BriefReadiness }> {
  const res = await fetch(
    `/api/namespaces/${encodeURIComponent(namespace)}/context/fields/${encodeURIComponent(key)}`,
    {
      method: 'PATCH',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ value, source: 'user' }),
    },
  );
  return handleResponse<{ field: RequirementField; readiness: BriefReadiness }>(res);
}

export async function confirmExtraction(
  apiKey: string,
  namespace: string,
  fields: Partial<Record<RequirementKey, { value: unknown; confidence: number; source: 'user' | 'document' | 'inferred' }>>,
  documentId?: string,
): Promise<{ context: BriefContext; readiness: BriefReadiness }> {
  const res = await fetch(
    `/api/namespaces/${encodeURIComponent(namespace)}/context/confirm`,
    {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ fields, documentId }),
    },
  );
  return handleResponse<{ context: BriefContext; readiness: BriefReadiness }>(res);
}

export async function confirmExtractionCard(
  apiKey: string,
  namespace: string,
  cardId: string,
  overrides?: Record<string, { value: string }>,
  resolvedConflicts?: Record<string, string>,
): Promise<{ fieldsWritten: RequirementKey[]; context: BriefContext; readiness: BriefReadiness }> {
  const res = await fetch(
    `/api/namespaces/${encodeURIComponent(namespace)}/extractions/${encodeURIComponent(cardId)}/confirm`,
    {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ overrides, resolvedConflicts }),
    },
  );
  return handleResponse<{ fieldsWritten: RequirementKey[]; context: BriefContext; readiness: BriefReadiness }>(res);
}

export async function discardExtractionCard(
  apiKey: string,
  namespace: string,
  cardId: string,
): Promise<{ discarded: boolean }> {
  const res = await fetch(
    `/api/namespaces/${encodeURIComponent(namespace)}/extractions/${encodeURIComponent(cardId)}/discard`,
    { method: 'POST', headers: authHeadersNoBody(apiKey) },
  );
  return handleResponse<{ discarded: boolean }>(res);
}

export async function reclassifyExtractionCard(
  apiKey: string,
  namespace: string,
  cardId: string,
  newClassification: DocumentClassification,
): Promise<{ newCardId: string }> {
  const res = await fetch(
    `/api/namespaces/${encodeURIComponent(namespace)}/extractions/${encodeURIComponent(cardId)}/reclassify`,
    {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ newClassification }),
    },
  );
  return handleResponse<{ newCardId: string }>(res);
}

export async function fetchPendingExtractions(
  apiKey: string,
  namespace: string,
): Promise<{ pending: PendingExtraction[] }> {
  const res = await fetch(
    `/api/namespaces/${encodeURIComponent(namespace)}/extractions/pending`,
    { headers: authHeadersNoBody(apiKey) },
  );
  return handleResponse<{ pending: PendingExtraction[] }>(res);
}

export async function updateKnowledgeEntry(
  apiKey: string,
  namespace: string,
  id: string,
  content: string,
): Promise<{ context: BriefContext }> {
  const res = await fetch(
    `/api/namespaces/${encodeURIComponent(namespace)}/context/knowledge/${encodeURIComponent(id)}`,
    { method: 'PATCH', headers: authHeaders(apiKey), body: JSON.stringify({ content }) },
  );
  return handleResponse<{ context: BriefContext }>(res);
}

export async function deleteKnowledgeEntry(
  apiKey: string,
  namespace: string,
  id: string,
): Promise<{ context: BriefContext }> {
  const res = await fetch(
    `/api/namespaces/${encodeURIComponent(namespace)}/context/knowledge/${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: authHeadersNoBody(apiKey) },
  );
  return handleResponse<{ context: BriefContext }>(res);
}

// ---------------------------------------------------------------------------
// Client Memory
// ---------------------------------------------------------------------------

export interface MemoryField {
  value: string | string[];
  confidence: number;
  sourceEngagements: string[];
  firstSeenAt: string;
  lastConfirmedAt: string;
}

export interface ClientKnowledgeEntry {
  id: string;
  content: string;
  category:
    | 'preference' | 'constraint' | 'relationship' | 'context'
    | 'requirement' | 'priority' | 'problem' | 'opportunity'
    | 'decision' | 'metric' | 'action_item';
  confidence: number;
  sourceEngagements: string[];
  sourceDocument?: string;
  firstSeenAt: string;
  lastConfirmedAt: string;
  supersededBy?: string;
}

export interface StakeholderRecord {
  id: string;
  name: string;
  role: string;
  email?: string;
  notes?: string;
  sourceEngagements: string[];
  lastSeenAt: string;
}

export interface MemoryConflict {
  id: string;
  existingId: string;
  existingContent: string;
  incomingContent: string;
  reason: string;
  status: 'needs_review' | 'resolved';
  resolution?: 'keep_old' | 'use_new' | 'keep_both' | 'defer';
  createdAt: string;
  resolvedAt?: string;
}

export interface ClientMemory {
  clientSlug: string;
  clientName: string;
  clientIndustry: string;
  stableFields: Partial<Record<'clientName' | 'clientIndustry' | 'contactName' | 'projectType', MemoryField>>;
  knowledge: ClientKnowledgeEntry[];
  stakeholders: StakeholderRecord[];
  conflicts: MemoryConflict[];
  version: number;
}

export async function fetchClientMemory(apiKey: string, clientSlug: string): Promise<ClientMemory | null> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientSlug)}`, { headers: authHeaders(apiKey) });
  if (res.status === 404) return null;
  const data = await handleResponse<{ memory: ClientMemory }>(res);
  return data.memory;
}

export async function addKnowledgeEntry(
  apiKey: string,
  clientSlug: string,
  content: string,
  category: ClientKnowledgeEntry['category'],
  confidence?: number,
): Promise<ClientKnowledgeEntry> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientSlug)}/memory/knowledge`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ content, category, confidence }),
  });
  const data = await handleResponse<{ entry: ClientKnowledgeEntry }>(res);
  return data.entry;
}

export async function updateClientKnowledgeEntry(
  apiKey: string,
  clientSlug: string,
  id: string,
  content: string,
): Promise<void> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientSlug)}/memory/knowledge/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ content }),
  });
  await handleResponse<{ ok: boolean }>(res);
}

export async function deleteClientKnowledgeEntry(apiKey: string, clientSlug: string, id: string): Promise<void> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientSlug)}/memory/knowledge/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeadersNoBody(apiKey),
  });
  await handleResponse<{ ok: boolean }>(res);
}

export async function addStakeholder(
  apiKey: string,
  clientSlug: string,
  data: { name: string; role: string; email?: string; notes?: string },
): Promise<StakeholderRecord> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientSlug)}/memory/stakeholders`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(data),
  });
  const result = await handleResponse<{ record: StakeholderRecord }>(res);
  return result.record;
}

export async function updateStakeholder(
  apiKey: string,
  clientSlug: string,
  id: string,
  updates: Partial<{ name: string; role: string; email: string; notes: string }>,
): Promise<void> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientSlug)}/memory/stakeholders/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: authHeaders(apiKey),
    body: JSON.stringify(updates),
  });
  await handleResponse<{ ok: boolean }>(res);
}

export async function deleteStakeholder(apiKey: string, clientSlug: string, id: string): Promise<void> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientSlug)}/memory/stakeholders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeadersNoBody(apiKey),
  });
  await handleResponse<{ ok: boolean }>(res);
}

export async function resolveConflict(
  apiKey: string,
  clientSlug: string,
  conflictId: string,
  resolution: 'keep_old' | 'use_new' | 'keep_both' | 'defer',
): Promise<void> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientSlug)}/memory/conflicts/${encodeURIComponent(conflictId)}/resolve`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ resolution }),
  });
  await handleResponse<{ ok: boolean }>(res);
}

// ---------------------------------------------------------------------------
// URL Design Extraction
// ---------------------------------------------------------------------------

export type ExtractUrlDesignResult = {
  tokens: ReferenceDesign | null;
  heroImageUrl?: string | null;
  logoUrl?: string | null;
  layout?: Record<string, unknown> | null;
  images?: string[];
  businessIntel?: BusinessIntel | null;
  error?: string;
};

export async function extractUrlDesign(
  apiKey: string,
  url: string,
): Promise<ExtractUrlDesignResult> {
  try {
    const res = await fetch('/api/microsite/extract-url-design', {
      method: 'POST',
      headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return { tokens: null, error: 'request_failed' };
    return res.json() as Promise<ExtractUrlDesignResult>;
  } catch {
    return { tokens: null, error: 'network_error' };
  }
}

// ---------------------------------------------------------------------------
// V2 generation — direct LLM pipeline, no agents or design-skill
// Takes only proposal markdown; returns same StreamEvent format as classic
// ---------------------------------------------------------------------------

// ── V2 Analyze ──────────────────────────────────────────────────────────────

export interface V2AnalysisResult {
  clientName: string;
  projectType: string;
  sections: { id: string; type: string; heading: string; summary: string }[];
  keyThemes: string[];
}

export async function analyzeProposalV2(
  apiKey: string,
  namespace: string,
  proposalId: string,
  proposalMarkdown: string,
): Promise<V2AnalysisResult> {
  const res = await fetch(
    `/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/analyze-v2`,
    {
      method: 'POST',
      headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposalMarkdown }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Analysis failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<V2AnalysisResult>;
}

// ── V2 Generate Stream ───────────────────────────────────────────────────────

export interface V2StreamOptions {
  proposalMarkdown: string;
  userPrompt?: string;
  designPrompt?: string;
  referenceImage?: { base64: string; mediaType: string };
  coldStart?: boolean;
  onEvent: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

export async function generateMicrositeV2Stream(
  apiKey: string,
  namespace: string,
  proposalId: string,
  opts: V2StreamOptions,
): Promise<void> {
  const res = await fetch(`/api/presentations/${encodeURIComponent(namespace)}/${encodeURIComponent(proposalId)}/generate-v2-stream`, {
    method: 'POST',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proposalMarkdown: opts.proposalMarkdown,
      ...(opts.userPrompt ? { userPrompt: opts.userPrompt } : {}),
      ...(opts.designPrompt ? { designPrompt: opts.designPrompt } : {}),
      ...(opts.referenceImage ? { referenceImage: opts.referenceImage } : {}),
      ...(opts.coldStart ? { coldStart: true } : {}),
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`V2 stream request failed (${res.status}): ${text}`);
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

// ---------------------------------------------------------------------------
// Super Client
// ---------------------------------------------------------------------------

export interface SuperClientMeta {
  name: string;
  displayName: string;
  url?: string;
  createdAt: string;
}

export interface SuperClientHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface SuperClientDetail {
  meta: SuperClientMeta;
  contextMd: string;
  history: SuperClientHistoryEntry[];
}

export async function listSuperClients(apiKey: string): Promise<SuperClientMeta[]> {
  const res = await fetch('/api/super-clients', { headers: authHeadersNoBody(apiKey) });
  if (!res.ok) throw new Error(`listSuperClients failed: ${res.status}`);
  const json = await res.json() as { clients: SuperClientMeta[] };
  return json.clients;
}

export async function createSuperClient(
  apiKey: string,
  displayName: string,
  url?: string,
  notes?: string,
): Promise<{ name: string; displayName: string; contextMd: string }> {
  const res = await fetch('/api/super-clients', {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ displayName, url, notes }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`createSuperClient failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<{ name: string; displayName: string; contextMd: string }>;
}

export async function getSuperClient(apiKey: string, name: string): Promise<SuperClientDetail> {
  const res = await fetch(`/api/super-clients/${name}`, { headers: authHeadersNoBody(apiKey) });
  if (!res.ok) throw new Error(`getSuperClient failed: ${res.status}`);
  return res.json() as Promise<SuperClientDetail>;
}

export async function deleteSuperClient(apiKey: string, name: string): Promise<void> {
  const res = await fetch(`/api/super-clients/${name}`, {
    method: 'DELETE',
    headers: authHeadersNoBody(apiKey),
  });
  if (!res.ok) throw new Error(`deleteSuperClient failed: ${res.status}`);
}

export interface SuperClientFile {
  fileName: string;
  size: number;
  uploadedAt: string;
  status: 'processing' | 'extracted' | 'failed';
  error?: string;
}

export async function listSuperClientDocuments(apiKey: string, name: string): Promise<SuperClientFile[]> {
  const res = await fetch(`/api/super-clients/${name}/documents`, { headers: authHeadersNoBody(apiKey) });
  if (!res.ok) throw new Error(`listSuperClientDocuments failed: ${res.status}`);
  const json = await res.json() as { files: SuperClientFile[] };
  return json.files;
}

export async function uploadSuperClientDocument(
  apiKey: string,
  name: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<SuperClientFile[]> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/super-clients/${name}/documents/upload`);
    if (apiKey) xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);
    if (onProgress) {
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const json = JSON.parse(xhr.responseText) as { files: SuperClientFile[] };
        resolve(json.files);
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

export async function deleteSuperClientDocument(apiKey: string, name: string, fileName: string): Promise<void> {
  const res = await fetch(`/api/super-clients/${name}/documents/${encodeURIComponent(fileName)}`, {
    method: 'DELETE',
    headers: authHeadersNoBody(apiKey),
  });
  if (!res.ok) throw new Error(`deleteSuperClientDocument failed: ${res.status}`);
}

export interface SuperClientProposal {
  fileName: string;
  title: string;
  savedAt: string;
}

export interface SuperClientMicrosite {
  id: string;
  title: string;
  proposalTitle: string;
  savedAt: string;
}

export async function listSuperClientMicrosites(apiKey: string, name: string): Promise<SuperClientMicrosite[]> {
  const res = await fetch(`/api/super-clients/${name}/microsites`, { headers: authHeadersNoBody(apiKey) });
  if (!res.ok) throw new Error(`listSuperClientMicrosites failed: ${res.status}`);
  const json = await res.json() as { microsites: SuperClientMicrosite[] };
  return json.microsites;
}

export async function getSuperClientMicrosite(apiKey: string, name: string, id: string): Promise<import('@/types/presentation').LayoutAST> {
  const res = await fetch(`/api/super-clients/${name}/microsites/${encodeURIComponent(id)}`, { headers: authHeadersNoBody(apiKey) });
  if (!res.ok) throw new Error(`getSuperClientMicrosite failed: ${res.status}`);
  const json = await res.json() as { ast: import('@/types/presentation').LayoutAST };
  return json.ast;
}

export async function saveSuperClientMicrosite(
  apiKey: string,
  name: string,
  ast: import('@/types/presentation').LayoutAST,
  proposalTitle: string,
): Promise<SuperClientMicrosite> {
  const res = await fetch(`/api/super-clients/${name}/microsites`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ ast, proposalTitle }),
  });
  if (!res.ok) throw new Error(`saveSuperClientMicrosite failed: ${res.status}`);
  const json = await res.json() as { microsite: SuperClientMicrosite };
  return json.microsite;
}

export async function deleteSuperClientMicrosite(apiKey: string, name: string, id: string): Promise<void> {
  const res = await fetch(`/api/super-clients/${name}/microsites/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeadersNoBody(apiKey),
  });
  if (!res.ok) throw new Error(`deleteSuperClientMicrosite failed: ${res.status}`);
}

export async function editSuperClientMicrosite(
  apiKey: string,
  name: string,
  id: string,
  instruction: string,
): Promise<{ html: string; summary: string }> {
  const res = await fetch(`/api/super-clients/${encodeURIComponent(name)}/microsites/${encodeURIComponent(id)}/edit`, {
    method: 'POST',
    headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Edit failed (${res.status})`);
  }
  return res.json() as Promise<{ html: string; summary: string }>;
}

export async function revertSuperClientMicrosite(
  apiKey: string,
  name: string,
  id: string,
): Promise<{ html: string }> {
  const res = await fetch(`/api/super-clients/${encodeURIComponent(name)}/microsites/${encodeURIComponent(id)}/revert`, {
    method: 'POST',
    headers: authHeadersNoBody(apiKey),
  });
  if (!res.ok) throw new Error(`revertSuperClientMicrosite failed: ${res.status}`);
  return res.json() as Promise<{ html: string }>;
}

export async function listSuperClientProposals(apiKey: string, name: string): Promise<SuperClientProposal[]> {
  const res = await fetch(`/api/super-clients/${name}/proposals`, { headers: authHeadersNoBody(apiKey) });
  if (!res.ok) throw new Error(`listSuperClientProposals failed: ${res.status}`);
  const json = await res.json() as { proposals: SuperClientProposal[] };
  return json.proposals;
}

export async function getSuperClientProposal(apiKey: string, name: string, fileName: string): Promise<string> {
  const res = await fetch(`/api/super-clients/${name}/proposals/${encodeURIComponent(fileName)}`, { headers: authHeadersNoBody(apiKey) });
  if (!res.ok) throw new Error(`getSuperClientProposal failed: ${res.status}`);
  const json = await res.json() as { content: string };
  return json.content;
}

export async function deleteSuperClientProposal(apiKey: string, name: string, fileName: string): Promise<void> {
  const res = await fetch(`/api/super-clients/${name}/proposals/${encodeURIComponent(fileName)}`, {
    method: 'DELETE',
    headers: authHeadersNoBody(apiKey),
  });
  if (!res.ok) throw new Error(`deleteSuperClientProposal failed: ${res.status}`);
}

export interface SuperClientChatEvent {
  type: 'chunk' | 'done' | 'error';
  text?: string;
  message?: string;
  proposalSaved?: SuperClientProposal;
  proposalUpdated?: SuperClientProposal;
}

export async function streamSuperClientChat(
  apiKey: string,
  name: string,
  message: string,
  onEvent: (event: SuperClientChatEvent) => void,
  signal?: AbortSignal,
  activeProposalId?: string,
): Promise<void> {
  const res = await fetch(`/api/super-clients/${name}/chat`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ message, ...(activeProposalId ? { activeProposalId } : {}) }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`Super client chat failed (${res.status}): ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6)) as SuperClientChatEvent;
          onEvent(evt);
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
