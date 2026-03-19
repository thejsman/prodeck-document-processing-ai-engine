/**
 * Proposal route handlers — delegates to @ai-engine/plugin-proposal-generator.
 *
 * Endpoints:
 *   POST /generate-proposal              — generate a structured proposal
 *   GET  /templates                       — list available YAML templates
 *   GET  /proposals                       — list generated proposal files
 *   GET  /proposals/:fileName/meta        — read proposal metadata sidecar
 *   POST /proposals/:fileName/lock-section   — lock a section
 *   POST /proposals/:fileName/unlock-section — unlock a section
 *   POST /proposals/:fileName/set-status     — transition workflow status
 *   GET  /templates/:name                  — read a single template (raw YAML + parsed)
 *   POST /templates/:name                  — create or update a template
 *   PUT  /proposals/:fileName/content      — update proposal content
 *   POST /proposal-diff                   — diff two proposal versions
 */

import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { appendEpisodicEntry, truncate } from './memory-util.js';
import yaml from 'js-yaml';
import {
  spawnProposalGenerator,
  type ProcessorPayload,
  type PricingInput,
  type MemoryPayload,
} from '@ai-engine/plugin-proposal-generator';
import {
  resolvePolicy,
  executeWithPolicy,
  type ProviderPolicyConfig,
  type ProviderInfo,
} from './provider-policy.js';
import {
  readMeta,
  writeMeta,
  ensureMeta,
  mergeLockedSections,
  diffSections,
  validateTransition,
  type ProposalStatus,
} from './proposal-meta.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function attachProviderInfo(req: FastifyRequest, info: ProviderInfo): void {
  (req as FastifyRequest & { __providerInfo: ProviderInfo }).__providerInfo =
    info;
}

const TEMPLATE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function sanitizeFileName(name: string): boolean {
  return /^[\w\s\-().]+\.md$/.test(name);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateSection {
  readonly title: string;
  readonly query: string;
  readonly instruction: string;
}

interface TemplateInfo {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly sections: readonly TemplateSection[];
}

interface ProposalFile {
  readonly fileName: string;
  readonly client: string;
  readonly version: number | null;
  readonly createdAt: string;
  readonly sizeBytes: number;
  readonly status: ProposalStatus | null;
  readonly lockedSections: string[];
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerProposalRoutes(
  app: FastifyInstance,
  workdir: string,
  policyConfig: ProviderPolicyConfig | null,
): void {
  const outputDir = path.join(workdir, 'output');
  const templateDir = path.join(workdir, 'data', 'templates');

  // POST /generate-proposal
  app.post(
    '/generate-proposal',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as
        | {
            client?: string;
            industry?: string;
            namespace?: string;
            template?: string;
            overwrite?: boolean;
            pricing?: PricingInput;
            tone?: string;
            memory?: MemoryPayload;
          }
        | undefined;

      if (!body?.client) {
        return reply
          .code(400)
          .send({ error: 'Missing required field: client' });
      }

      const client = body.client;
      const industry = body.industry ?? 'General';
      const namespace = body.namespace ?? null;
      const template = body.template ?? 'default';
      const overwrite = body.overwrite ?? false;
      const pricing = body.pricing ?? null;
      const tone = body.tone ?? null;
      const memory = body.memory ?? null;

      // Determine expected output file path for finalized / lock checks
      const safeName = client
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 100);
      const basePath = path.join(outputDir, `${safeName}_proposal.md`);

      // Check if finalized
      const existingMeta = await readMeta(basePath);
      if (existingMeta?.status === 'finalized') {
        return reply
          .code(400)
          .send({ error: 'Cannot regenerate a finalized proposal' });
      }

      // Read old content for locked section merge
      let oldContent: string | null = null;
      const lockedSections = existingMeta?.lockedSections ?? [];
      if (lockedSections.length > 0) {
        try {
          oldContent = await readFile(basePath, 'utf-8');
        } catch {
          // Old file not found — no merge needed
        }
      }

      const payload: ProcessorPayload = {
        workdir,
        outputDir,
        client,
        industry,
        namespace,
        template,
        templateDir,
        overwrite,
        pricing,
        tone,
        memory,
      };

      let rawDoc: Awaited<ReturnType<typeof spawnProposalGenerator>>;

      if (policyConfig && namespace) {
        const policy = resolvePolicy(policyConfig, namespace, 'query');
        const { result, usedFallback, provider } = await executeWithPolicy(
          policy,
          () => spawnProposalGenerator(payload),
        );
        attachProviderInfo(req, {
          provider,
          usedFallback,
          policySource: policy.source,
        });
        rawDoc = result;
      } else {
        rawDoc = await spawnProposalGenerator(payload);
      }

      // Create a mutable copy for potential locked-section merge
      const document = { ...rawDoc };

      // Merge locked sections if applicable
      if (oldContent && lockedSections.length > 0) {
        document.content = mergeLockedSections(
          oldContent,
          document.content,
          lockedSections,
        );
        // Overwrite the file with merged content
        const outFile = (document.metadata as Record<string, unknown>)
          .output_file as string | undefined;
        if (outFile) {
          const { writeFile: writeFileAsync } = await import(
            'node:fs/promises'
          );
          await writeFileAsync(outFile, document.content, 'utf-8');
        }
      }

      // Ensure metadata sidecar exists (preserve existing status on regen)
      const outputFile = (document.metadata as Record<string, unknown>)
        .output_file as string | undefined;
      if (outputFile) {
        if (existingMeta) {
          existingMeta.updatedAt = new Date().toISOString();
          await writeMeta(outputFile, existingMeta);
        } else {
          await ensureMeta(outputFile);
        }
      }

      // Append episodic entry to namespace memory (fire-and-forget)
      if (namespace) {
        void appendEpisodicEntry(workdir, namespace, {
          timestamp: new Date().toISOString(),
          source: 'proposal-generated',
          content: truncate(
            `Generated proposal for "${client}" in the "${industry}" industry using template "${template}"`,
            300,
          ),
        });
      }

      return reply.send({ document });
    },
  );

  // GET /templates
  app.get(
    '/templates',
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        const entries = await readdir(templateDir);
        const yamlFiles = entries
          .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
          .sort();
        const templates: TemplateInfo[] = [];

        for (const file of yamlFiles) {
          const filePath = path.join(templateDir, file);
          const raw = await readFile(filePath, 'utf-8');
          const parsed = yaml.load(raw) as Record<string, unknown>;

          templates.push({
            name: (parsed.name as string) ?? path.basename(file, '.yaml'),
            version: (parsed.version as string) ?? 'unknown',
            description: (parsed.description as string) ?? '',
            sections: (parsed.sections as TemplateSection[]) ?? [],
          });
        }

        return reply.send({ templates });
      } catch {
        return reply.send({ templates: [] });
      }
    },
  );

  // GET /templates/:name
  app.get(
    '/templates/:name',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { name } = req.params as { name: string };

      if (!TEMPLATE_NAME_PATTERN.test(name)) {
        return reply.code(400).send({ error: 'Invalid template name' });
      }

      const filePath = path.join(templateDir, `${name}.yaml`);

      try {
        const content = await readFile(filePath, 'utf-8');
        const parsed = yaml.load(content) as Record<string, unknown>;

        return reply.send({
          name,
          content,
          parsed: {
            name: (parsed.name as string) ?? name,
            version: (parsed.version as string) ?? 'unknown',
            description: (parsed.description as string) ?? '',
            sections: (parsed.sections as TemplateSection[]) ?? [],
          },
        });
      } catch {
        return reply.code(404).send({ error: `Template "${name}" not found` });
      }
    },
  );

  // POST /templates/:name
  app.post(
    '/templates/:name',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { name } = req.params as { name: string };

      if (!TEMPLATE_NAME_PATTERN.test(name)) {
        return reply.code(400).send({ error: 'Invalid template name. Use lowercase letters, numbers, and dashes.' });
      }

      const body = req.body as { content?: string } | undefined;

      if (!body?.content || typeof body.content !== 'string') {
        return reply.code(400).send({ error: 'Missing required field: content (YAML string)' });
      }

      // Validate YAML parses
      let parsed: Record<string, unknown>;
      try {
        parsed = yaml.load(body.content) as Record<string, unknown>;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: `Invalid YAML: ${message}` });
      }

      if (!parsed || typeof parsed !== 'object') {
        return reply.code(400).send({ error: 'Template must be a YAML object' });
      }

      // Validate required structure
      if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) {
        return reply.code(400).send({ error: 'Template must have a non-empty "sections" array' });
      }

      for (let i = 0; i < parsed.sections.length; i++) {
        const section = parsed.sections[i] as Record<string, unknown>;
        if (!section.title || !section.query || !section.instruction) {
          return reply.code(400).send({
            error: `Section ${i + 1} must have "title", "query", and "instruction" fields`,
          });
        }
      }

      // Write file
      await mkdir(templateDir, { recursive: true });
      const filePath = path.join(templateDir, `${name}.yaml`);
      await writeFile(filePath, body.content, 'utf-8');

      return reply.code(201).send({
        name: (parsed.name as string) ?? name,
        version: (parsed.version as string) ?? 'unknown',
        description: (parsed.description as string) ?? '',
        sections: (parsed.sections as TemplateSection[]),
      });
    },
  );

  // GET /proposals
  app.get(
    '/proposals',
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        const entries = await readdir(outputDir);
        const mdFiles = entries.filter((f) => f.endsWith('.md'));
        const proposals: ProposalFile[] = [];

        for (const file of mdFiles) {
          const filePath = path.join(outputDir, file);
          const fileStat = await stat(filePath);

          const match = file.match(/^(.+)_proposal(?:_v(\d+))?\.md$/);
          const clientName = match
            ? match[1].replace(/_/g, ' ')
            : file.replace(/\.md$/, '');
          const version = match?.[2] ? parseInt(match[2], 10) : null;

          const meta = await readMeta(filePath);

          proposals.push({
            fileName: file,
            client: clientName,
            version,
            createdAt: fileStat.mtime.toISOString(),
            sizeBytes: fileStat.size,
            status: meta?.status ?? null,
            lockedSections: meta?.lockedSections ?? [],
          });
        }

        proposals.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        return reply.send({ proposals });
      } catch {
        return reply.send({ proposals: [] });
      }
    },
  );

  // GET /proposals/:fileName/meta
  app.get(
    '/proposals/:fileName/meta',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { fileName } = req.params as { fileName: string };
      if (!sanitizeFileName(fileName)) {
        return reply.code(400).send({ error: 'Invalid file name' });
      }

      const filePath = path.join(outputDir, fileName);
      const meta = await readMeta(filePath);
      if (!meta) {
        return reply.code(404).send({ error: 'No metadata found' });
      }
      return reply.send({ meta });
    },
  );

  // POST /proposals/:fileName/lock-section
  app.post(
    '/proposals/:fileName/lock-section',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { fileName } = req.params as { fileName: string };
      if (!sanitizeFileName(fileName)) {
        return reply.code(400).send({ error: 'Invalid file name' });
      }

      const body = req.body as { section?: string } | undefined;
      if (!body?.section) {
        return reply
          .code(400)
          .send({ error: 'Missing required field: section' });
      }

      const filePath = path.join(outputDir, fileName);
      const meta = await ensureMeta(filePath);

      if (meta.status === 'finalized') {
        return reply
          .code(400)
          .send({ error: 'Cannot modify a finalized proposal' });
      }

      if (!meta.lockedSections.includes(body.section)) {
        meta.lockedSections.push(body.section);
        await writeMeta(filePath, meta);
      }

      return reply.send({ meta });
    },
  );

  // POST /proposals/:fileName/unlock-section
  app.post(
    '/proposals/:fileName/unlock-section',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { fileName } = req.params as { fileName: string };
      if (!sanitizeFileName(fileName)) {
        return reply.code(400).send({ error: 'Invalid file name' });
      }

      const body = req.body as { section?: string } | undefined;
      if (!body?.section) {
        return reply
          .code(400)
          .send({ error: 'Missing required field: section' });
      }

      const filePath = path.join(outputDir, fileName);
      const meta = await ensureMeta(filePath);

      if (meta.status === 'finalized') {
        return reply
          .code(400)
          .send({ error: 'Cannot modify a finalized proposal' });
      }

      meta.lockedSections = meta.lockedSections.filter(
        (s) => s !== body.section,
      );
      await writeMeta(filePath, meta);

      return reply.send({ meta });
    },
  );

  // POST /proposals/:fileName/set-status
  app.post(
    '/proposals/:fileName/set-status',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { fileName } = req.params as { fileName: string };
      if (!sanitizeFileName(fileName)) {
        return reply.code(400).send({ error: 'Invalid file name' });
      }

      const body = req.body as { status?: string } | undefined;
      if (!body?.status) {
        return reply
          .code(400)
          .send({ error: 'Missing required field: status' });
      }

      const filePath = path.join(outputDir, fileName);
      const meta = await ensureMeta(filePath);
      const newStatus = body.status as ProposalStatus;

      if (!validateTransition(meta.status, newStatus)) {
        return reply.code(400).send({
          error: `Invalid transition: ${meta.status} → ${newStatus}`,
        });
      }

      meta.status = newStatus;
      await writeMeta(filePath, meta);

      return reply.send({ meta });
    },
  );

  // GET /proposals/:fileName/content
  app.get(
    '/proposals/:fileName/content',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { fileName } = req.params as { fileName: string };
      if (!sanitizeFileName(fileName)) {
        return reply.code(400).send({ error: 'Invalid file name' });
      }

      const filePath = path.join(outputDir, fileName);

      try {
        const [content, fileStat] = await Promise.all([
          readFile(filePath, 'utf-8'),
          stat(filePath),
        ]);

        const match = fileName.match(/^(.+)_proposal(?:_v(\d+))?\.md$/);
        const client = match
          ? match[1].replace(/_/g, ' ')
          : fileName.replace(/\.md$/, '');

        return reply.send({
          document: {
            type: 'proposal',
            source: fileName,
            content,
            metadata: { output_file: filePath, client },
            createdAt: fileStat.mtime.toISOString(),
          },
        });
      } catch {
        return reply.code(404).send({ error: 'Proposal file not found' });
      }
    },
  );

  // PUT /proposals/:fileName/content
  app.put(
    '/proposals/:fileName/content',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { fileName } = req.params as { fileName: string };
      if (!sanitizeFileName(fileName)) {
        return reply.code(400).send({ error: 'Invalid file name' });
      }

      const body = req.body as { content?: string } | undefined;
      if (!body?.content || typeof body.content !== 'string') {
        return reply.code(400).send({ error: 'Missing required field: content' });
      }

      const filePath = path.join(outputDir, fileName);

      // Verify the file exists
      try {
        await stat(filePath);
      } catch {
        return reply.code(404).send({ error: 'Proposal file not found' });
      }

      // Reject edits to finalized proposals
      const meta = await readMeta(filePath);
      if (meta?.status === 'finalized') {
        return reply
          .code(400)
          .send({ error: 'Cannot edit a finalized proposal' });
      }

      // Write updated content
      await writeFile(filePath, body.content, 'utf-8');

      // Update the sidecar timestamp
      const updated = await ensureMeta(filePath);
      updated.updatedAt = new Date().toISOString();
      await writeMeta(filePath, updated);

      return reply.send({ ok: true });
    },
  );

  // POST /proposal-diff
  app.post(
    '/proposal-diff',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as
        | { fileA?: string; fileB?: string }
        | undefined;

      if (!body?.fileA || !body?.fileB) {
        return reply
          .code(400)
          .send({ error: 'Missing required fields: fileA, fileB' });
      }

      if (!sanitizeFileName(body.fileA) || !sanitizeFileName(body.fileB)) {
        return reply.code(400).send({ error: 'Invalid file name' });
      }

      try {
        const contentA = await readFile(
          path.join(outputDir, body.fileA),
          'utf-8',
        );
        const contentB = await readFile(
          path.join(outputDir, body.fileB),
          'utf-8',
        );
        const diffs = diffSections(contentA, contentB);
        return reply.send({ diffs });
      } catch {
        return reply.code(404).send({ error: 'One or both files not found' });
      }
    },
  );
}
