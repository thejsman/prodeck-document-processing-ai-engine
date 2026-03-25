/**
 * Proposal Version Service — versioned snapshot management for proposals.
 *
 * Maintains a version graph persisted as a JSON index alongside the
 * namespace proposals directory.  Each version records:
 *   - the content snapshot (stored as a file)
 *   - the parent version (for future branching / A-B variants)
 *   - a monotonically increasing version label (v1.0, v1.1, …)
 *
 * Storage layout:
 *   {workdir}/namespaces/{namespace}/proposals/
 *     {artifactId}                       ← current proposal markdown
 *     .versions/{artifactId}/
 *       index.json                       ← version graph index
 *       v1.0.md                          ← snapshot content
 *       v1.1.md
 *       …
 *
 * Rollback behaviour:
 *   Copy selected version content → persist as new version → update
 *   current artifact file.  This preserves full history (no destructive
 *   overwrites).
 *
 * Follows the project's filesystem JSON sidecar pattern (files.json,
 * .meta.json, etc.) — no external database required.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProposalVersion {
  /** Unique version identifier. */
  id: string;
  /** Artifact this version belongs to (e.g. "chat-draft-1234567890.md"). */
  artifactId: string;
  /** Namespace. */
  namespace: string;
  /** Human-readable label (v1.0, v1.1, …). */
  versionLabel: string;
  /** Parent version ID — null for the initial version. */
  parentVersionId: string | null;
  /** Relative path to the snapshot file within the versions directory. */
  storageUri: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Creator identifier (e.g. "system", "user", "agent"). */
  createdBy: string;
  /** Optional short description of what changed. */
  summary?: string;
}

export interface VersionIndex {
  /** Artifact ID this index tracks. */
  artifactId: string;
  /** ID of the version that represents the current state. */
  currentVersionId: string;
  /** All versions in creation order. */
  versions: ProposalVersion[];
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function versionsDir(workdir: string, namespace: string, artifactId: string): string {
  return path.join(workdir, 'namespaces', namespace, 'proposals', '.versions', artifactId);
}

function indexPath(workdir: string, namespace: string, artifactId: string): string {
  return path.join(versionsDir(workdir, namespace, artifactId), 'index.json');
}

function artifactPath(workdir: string, namespace: string, artifactId: string): string {
  return path.join(workdir, 'namespaces', namespace, 'proposals', artifactId);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function loadIndex(
  workdir: string,
  namespace: string,
  artifactId: string,
): Promise<VersionIndex | null> {
  try {
    const raw = await readFile(indexPath(workdir, namespace, artifactId), 'utf-8');
    return JSON.parse(raw) as VersionIndex;
  } catch {
    return null;
  }
}

async function persistIndex(
  workdir: string,
  namespace: string,
  artifactId: string,
  index: VersionIndex,
): Promise<void> {
  const dir = versionsDir(workdir, namespace, artifactId);
  await mkdir(dir, { recursive: true });
  await writeFile(indexPath(workdir, namespace, artifactId), JSON.stringify(index, null, 2), 'utf-8');
}

function nextVersionLabel(versions: ProposalVersion[]): string {
  if (versions.length === 0) return 'v1.0';

  // Find the highest major.minor and increment minor
  let maxMajor = 1;
  let maxMinor = 0;

  for (const v of versions) {
    const match = v.versionLabel.match(/^v(\d+)\.(\d+)$/);
    if (match) {
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major > maxMajor || (major === maxMajor && minor > maxMinor)) {
        maxMajor = major;
        maxMinor = minor;
      }
    }
  }

  return `v${maxMajor}.${maxMinor + 1}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create the initial version snapshot for a newly generated proposal.
 *
 * Reads the current artifact content and stores it as v1.0.
 * Idempotent — if versions already exist, returns the existing index.
 */
export async function createInitialVersion(
  workdir: string,
  namespace: string,
  artifactId: string,
  createdBy: string = 'system',
): Promise<ProposalVersion> {
  const existing = await loadIndex(workdir, namespace, artifactId);
  if (existing && existing.versions.length > 0) {
    return existing.versions[existing.versions.length - 1];
  }

  // Read current artifact content
  const content = await readFile(artifactPath(workdir, namespace, artifactId), 'utf-8');

  const label = 'v1.0';
  const snapshotFile = `${label}.md`;
  const version: ProposalVersion = {
    id: randomUUID(),
    artifactId,
    namespace,
    versionLabel: label,
    parentVersionId: null,
    storageUri: snapshotFile,
    createdAt: new Date().toISOString(),
    createdBy,
    summary: 'Initial version',
  };

  // Write snapshot
  const dir = versionsDir(workdir, namespace, artifactId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, snapshotFile), content, 'utf-8');

  // Create index
  const index: VersionIndex = {
    artifactId,
    currentVersionId: version.id,
    versions: [version],
  };
  await persistIndex(workdir, namespace, artifactId, index);

  return version;
}

/**
 * Create a new version from edited content.
 *
 * Stores the new content as a snapshot, links to the parent version,
 * and updates the current pointer.
 */
export async function createVersionFromEdit(
  workdir: string,
  namespace: string,
  artifactId: string,
  newContent: string,
  parentVersionId: string | null,
  createdBy: string = 'system',
  summary?: string,
): Promise<ProposalVersion> {
  let index = await loadIndex(workdir, namespace, artifactId);

  if (!index) {
    // No version history yet — bootstrap with current file as v1.0
    await createInitialVersion(workdir, namespace, artifactId, createdBy);
    index = await loadIndex(workdir, namespace, artifactId);
    if (!index) throw new Error(`Failed to initialize version index for ${artifactId}`);
    // Use the initial version as parent if none specified
    if (!parentVersionId) {
      parentVersionId = index.versions[0].id;
    }
  }

  // Resolve parent: use current if not specified
  if (!parentVersionId) {
    parentVersionId = index.currentVersionId;
  }

  const label = nextVersionLabel(index.versions);
  const snapshotFile = `${label}.md`;
  const version: ProposalVersion = {
    id: randomUUID(),
    artifactId,
    namespace,
    versionLabel: label,
    parentVersionId,
    storageUri: snapshotFile,
    createdAt: new Date().toISOString(),
    createdBy,
    summary,
  };

  // Write snapshot
  const dir = versionsDir(workdir, namespace, artifactId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, snapshotFile), newContent, 'utf-8');

  // Update index
  index.versions.push(version);
  index.currentVersionId = version.id;
  await persistIndex(workdir, namespace, artifactId, index);

  return version;
}

/**
 * List all versions for an artifact, in creation order.
 */
export async function listVersions(
  workdir: string,
  namespace: string,
  artifactId: string,
): Promise<{ versions: ProposalVersion[]; currentVersionId: string | null }> {
  const index = await loadIndex(workdir, namespace, artifactId);
  if (!index) {
    return { versions: [], currentVersionId: null };
  }
  return { versions: index.versions, currentVersionId: index.currentVersionId };
}

/**
 * Rollback to a specific version.
 *
 * Non-destructive: copies the selected version's content, creates a new
 * version labelled as a rollback, and overwrites the current artifact file.
 */
export async function rollbackToVersion(
  workdir: string,
  namespace: string,
  artifactId: string,
  targetVersionId: string,
  createdBy: string = 'user',
): Promise<ProposalVersion> {
  const index = await loadIndex(workdir, namespace, artifactId);
  if (!index) throw new Error(`No version history found for ${artifactId}`);

  const target = index.versions.find((v) => v.id === targetVersionId);
  if (!target) throw new Error(`Version ${targetVersionId} not found`);

  // Read the target snapshot content
  const dir = versionsDir(workdir, namespace, artifactId);
  const content = await readFile(path.join(dir, target.storageUri), 'utf-8');

  // Create a new version representing the rollback
  const label = nextVersionLabel(index.versions);
  const snapshotFile = `${label}.md`;
  const rollbackVersion: ProposalVersion = {
    id: randomUUID(),
    artifactId,
    namespace,
    versionLabel: label,
    parentVersionId: target.id,
    storageUri: snapshotFile,
    createdAt: new Date().toISOString(),
    createdBy,
    summary: `Rollback to ${target.versionLabel}`,
  };

  // Write rollback snapshot (identical content, new label)
  await writeFile(path.join(dir, snapshotFile), content, 'utf-8');

  // Update artifact to match the rolled-back content
  await writeFile(artifactPath(workdir, namespace, artifactId), content, 'utf-8');

  // Update index
  index.versions.push(rollbackVersion);
  index.currentVersionId = rollbackVersion.id;
  await persistIndex(workdir, namespace, artifactId, index);

  return rollbackVersion;
}

/**
 * Read the content of a specific version snapshot.
 */
export async function readVersionContent(
  workdir: string,
  namespace: string,
  artifactId: string,
  versionId: string,
): Promise<string> {
  const index = await loadIndex(workdir, namespace, artifactId);
  if (!index) throw new Error(`No version history found for ${artifactId}`);

  const version = index.versions.find((v) => v.id === versionId);
  if (!version) throw new Error(`Version ${versionId} not found`);

  const dir = versionsDir(workdir, namespace, artifactId);
  return readFile(path.join(dir, version.storageUri), 'utf-8');
}

/**
 * Find the most recent artifact ID for a namespace by scanning the proposals directory.
 * Returns null if no proposals exist.
 */
export async function findLatestArtifact(
  workdir: string,
  namespace: string,
): Promise<string | null> {
  const proposalsDir = path.join(workdir, 'namespaces', namespace, 'proposals');

  try {
    const entries = await readdir(proposalsDir);
    const mdFiles = entries
      .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
      .sort()
      .reverse(); // Most recent by name (chat-draft-{timestamp}.md)

    return mdFiles[0] ?? null;
  } catch {
    return null;
  }
}
