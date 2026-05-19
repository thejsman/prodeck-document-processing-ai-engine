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
 *   GET    /templates/:name                — read a single template (raw YAML + parsed)
 *   POST   /templates/:name               — create or update a template
 *   DELETE /templates/:name               — delete a template
 *   PUT  /proposals/:fileName/content      — update proposal content
 *   POST /proposal-diff                   — diff two proposal versions
 */

import { readFile, readdir, stat, writeFile, mkdir, unlink } from 'node:fs/promises';
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
import { retrieveProposalContext } from './proposals/proposal-rag.js';
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
import { createVersionFromEdit } from './proposals/proposal-version.service.js';
import { recommendTemplate } from './templates/template-recommendation.service.js';
import { extractRfpRequirements } from './ingestion/extract-rfp-requirements.js';
import { ClientMemoryService } from './memory/client-memory.service.js';
import { ContextService } from './chat/context.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function attachProviderInfo(req: FastifyRequest, info: ProviderInfo): void {
  (req as FastifyRequest & { __providerInfo: ProviderInfo }).__providerInfo =
    info;
}

const TEMPLATE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function sanitizeFileName(name: string): boolean {
  // Allow plain filenames and namespace-prefixed ones: "ns::file.md"
  return /^[\w\s\-().]+\.md$/.test(name) || /^[\w-]+::[\w\s\-().]+\.md$/.test(name);
}

/**
 * Resolve a fileName (plain or "namespace::file.md") to an absolute path.
 * All proposals now live under workdir/namespaces/<ns>/proposals/.
 * Plain filenames (no namespace prefix) fall back to the legacy output dir.
 */
function resolveProposalPath(fileName: string, workdir: string, legacyOutputDir: string): string {
  const sep = fileName.indexOf('::');
  if (sep !== -1) {
    const ns = fileName.slice(0, sep);
    const file = fileName.slice(sep + 2);
    return path.join(workdir, 'namespaces', ns, 'proposals', file);
  }
  return path.join(legacyOutputDir, fileName);
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
  /** Filename slug (without extension) — used for API routing. */
  readonly id: string;
  /** Human-readable display name from the YAML `name:` field. */
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
  // Canonical proposal storage: workdir/namespaces/<ns>/proposals/
  // All routes that need a per-namespace output dir call proposalDir(ns).
  const proposalDir = (ns: string) =>
    path.join(workdir, 'namespaces', ns, 'proposals');
  // Legacy path kept only for the diff endpoint (backward compat during transition)
  const legacyOutputDir = path.join(workdir, 'output');
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
      const namespace = body.namespace ?? 'default';
      const rawTemplate = body.template ?? 'default';
      // Scope "default" to the namespace so different namespaces don't share
      // a single cached default.yaml that may be specific to another project.
      const template = rawTemplate === 'default' ? `default-${namespace}` : rawTemplate;
      const overwrite = body.overwrite ?? false;
      const pricing = body.pricing ?? null;
      const tone = body.tone ?? null;
      const memory = body.memory ?? null;

      const outputDir = proposalDir(namespace);
      await mkdir(outputDir, { recursive: true });

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

      const retrievedContext = namespace
        ? await retrieveProposalContext(workdir, namespace, client, industry)
        : null;

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
        retrievedContext,
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

      // Auto-snapshot: create version for the generated proposal (fire-and-forget)
      if (namespace && outputFile) {
        const generatedFileName = path.basename(outputFile);
        void createVersionFromEdit(
          workdir,
          namespace,
          generatedFileName,
          document.content,
          null,
          'system',
          `Generated proposal for "${client}"`,
        ).catch(() => { /* non-fatal */ });
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

  // GET /templates/recommend?namespace=<ns>
  //
  // Returns the best-matching template for the documents indexed in the given
  // namespace.  Requires an RFP document to be indexed — returns a low-
  // confidence result with fallbackGenerate=true when no RFP is present.
  app.get(
    '/templates/recommend',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { namespace } = req.query as { namespace?: string };

      if (!namespace?.trim()) {
        return reply.code(400).send({ error: 'Missing required query param: namespace' });
      }

      const ns = namespace.trim();

      try {
        // Build requirement context from whatever is indexed in the namespace.
        // Falls back to empty categories when no RFP is present.
        const requirementMatrix = await extractRfpRequirements(workdir, ns).catch(() => ({
          functional: [],
          compliance: [],
          timeline: [],
          pricing: [],
        }));

        const recommendation = await recommendTemplate(
          { requirementMatrix, namespace: ns },
          workdir,
        );

        return reply.send({ recommendation });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({ error: `Recommendation failed: ${message}` });
      }
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
          const id = path.basename(file, path.extname(file));
          try {
            const raw = await readFile(filePath, 'utf-8');
            const parsed = yaml.load(raw) as Record<string, unknown>;
            if (!parsed || typeof parsed !== 'object') continue;
            templates.push({
              id,
              name: (parsed.name as string) ?? id,
              version: (parsed.version as string) ?? 'unknown',
              description: (parsed.description as string) ?? '',
              sections: (parsed.sections as TemplateSection[]) ?? [],
            });
          } catch {
            // Skip malformed files — don't let one bad file hide all templates
            process.stderr.write(`[templates] Skipping invalid YAML: ${file}\n`);
          }
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
          id: name,
          name,
          content,
          parsed: {
            id: name,
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
        id: name,
        name: (parsed.name as string) ?? name,
        version: (parsed.version as string) ?? 'unknown',
        description: (parsed.description as string) ?? '',
        sections: (parsed.sections as TemplateSection[]),
      });
    },
  );

  // DELETE /templates/:name
  app.delete(
    '/templates/:name',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { name } = req.params as { name: string };

      if (!TEMPLATE_NAME_PATTERN.test(name)) {
        return reply.code(400).send({ error: 'Invalid template name.' });
      }

      const filePath = path.join(templateDir, `${name}.yaml`);
      try {
        await unlink(filePath);
        return reply.code(200).send({ deleted: name });
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.code(404).send({ error: `Template "${name}" not found` });
        }
        throw err;
      }
    },
  );

  // DELETE /proposals/:namespace/:fileName — permanently remove a proposal file
  app.delete(
    '/proposals/:namespace/:fileName',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { namespace, fileName } = req.params as { namespace: string; fileName: string };
      const filePath = path.join(workdir, 'namespaces', namespace, 'proposals', fileName);
      try {
        await unlink(filePath);
        // Remove the meta sidecar if it exists
        try { await unlink(filePath.replace(/\.md$/, '.meta.json')); } catch { /* ignore */ }
        return reply.send({ deleted: fileName });
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return reply.code(404).send({ error: 'Proposal not found' });
        }
        throw err;
      }
    },
  );

  // GET /proposals
  app.get(
    '/proposals',
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        const proposals: ProposalFile[] = [];

        // Helper: scan one directory for proposal .md files
        async function scanProposalDir(dir: string, namespace?: string): Promise<void> {
          let entries: string[];
          try {
            entries = await readdir(dir);
          } catch {
            return; // directory doesn't exist yet
          }
          const mdFiles = entries.filter(
            (f) => f.endsWith('.md') && !f.startsWith('.'),
          );
          for (const file of mdFiles) {
            const filePath = path.join(dir, file);
            const fileStat = await stat(filePath);
            const match = file.match(/^(.+)_proposal(?:_v(\d+))?\.md$/);
            const clientName = match
              ? match[1].replace(/_/g, ' ')
              : file.replace(/\.md$/, '');
            const version = match?.[2] ? parseInt(match[2], 10) : null;
            const meta = await readMeta(filePath);
            proposals.push({
              fileName: namespace ? `${namespace}::${file}` : file,
              client: clientName,
              version,
              createdAt: fileStat.mtime.toISOString(),
              sizeBytes: fileStat.size,
              status: meta?.status ?? null,
              lockedSections: meta?.lockedSections ?? [],
            });
          }
        }

        // Scan all namespace proposal dirs: workdir/namespaces/*/proposals/
        const nsRoot = path.join(workdir, 'namespaces');
        let namespaces: string[] = [];
        try { namespaces = await readdir(nsRoot); } catch { /* not yet created */ }
        for (const ns of namespaces) {
          const nsProposalsDir = path.join(nsRoot, ns, 'proposals');
          await scanProposalDir(nsProposalsDir, ns);
        }

        // Also scan legacy output dir so old proposals remain accessible during transition
        await scanProposalDir(legacyOutputDir);

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

      const filePath = resolveProposalPath(fileName, workdir, legacyOutputDir);
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

      const filePath = resolveProposalPath(fileName, workdir, legacyOutputDir);
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

      const filePath = resolveProposalPath(fileName, workdir, legacyOutputDir);
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

      const filePath = resolveProposalPath(fileName, workdir, legacyOutputDir);
      const meta = await ensureMeta(filePath);
      const newStatus = body.status as ProposalStatus;

      if (!validateTransition(meta.status, newStatus)) {
        return reply.code(400).send({
          error: `Invalid transition: ${meta.status} → ${newStatus}`,
        });
      }

      meta.status = newStatus;
      await writeMeta(filePath, meta);

      // Trigger memory distillation asynchronously when a proposal closes
      if (newStatus === 'approved' || newStatus === 'finalized') {
        const sep = fileName.indexOf('::');
        const namespace = sep !== -1 ? fileName.slice(0, sep) : null;
        if (namespace) {
          const memService = new ClientMemoryService(workdir);
          const ctxService = new ContextService(workdir);
          ctxService.get(namespace).then((context) => {
            if (!context?.requirements.fields['clientName']) return;
            return memService.distill(namespace, context);
          }).catch((err: unknown) => {
            app.log.error({ err }, '[ClientMemory] distillation failed');
          });
        }
      }

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

      const filePath = resolveProposalPath(fileName, workdir, legacyOutputDir);

      try {
        const [content, fileStat] = await Promise.all([
          readFile(filePath, 'utf-8'),
          stat(filePath),
        ]);

        // Strip optional namespace prefix before extracting client name
        const baseName = fileName.includes('::') ? fileName.split('::')[1] : fileName;
        const match = baseName.match(/^(.+)_proposal(?:_v(\d+))?\.md$/);
        const client = match
          ? match[1].replace(/_/g, ' ')
          : baseName.replace(/\.md$/, '');

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

      const filePath = resolveProposalPath(fileName, workdir, legacyOutputDir);

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

      // Auto-snapshot: create version from user edit (fire-and-forget)
      // Derive namespace from the request if available
      const editNamespace = (req.query as Record<string, string>)?.namespace;
      if (editNamespace) {
        void createVersionFromEdit(
          workdir,
          editNamespace,
          fileName,
          body.content,
          null,
          'user',
          'Manual edit',
        ).catch(() => { /* non-fatal */ });
      }

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
          resolveProposalPath(body.fileA, workdir, legacyOutputDir),
          'utf-8',
        );
        const contentB = await readFile(
          resolveProposalPath(body.fileB, workdir, legacyOutputDir),
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
