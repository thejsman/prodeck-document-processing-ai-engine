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
/**
 * Create the initial version snapshot for a newly generated proposal.
 *
 * Reads the current artifact content and stores it as v1.0.
 * Idempotent — if versions already exist, returns the existing index.
 */
export declare function createInitialVersion(workdir: string, namespace: string, artifactId: string, createdBy?: string): Promise<ProposalVersion>;
/**
 * Create a new version from edited content.
 *
 * Stores the new content as a snapshot, links to the parent version,
 * and updates the current pointer.
 */
export declare function createVersionFromEdit(workdir: string, namespace: string, artifactId: string, newContent: string, parentVersionId: string | null, createdBy?: string, summary?: string): Promise<ProposalVersion>;
/**
 * List all versions for an artifact, in creation order.
 */
export declare function listVersions(workdir: string, namespace: string, artifactId: string): Promise<{
    versions: ProposalVersion[];
    currentVersionId: string | null;
}>;
/**
 * Rollback to a specific version.
 *
 * Non-destructive: copies the selected version's content, creates a new
 * version labelled as a rollback, and overwrites the current artifact file.
 */
export declare function rollbackToVersion(workdir: string, namespace: string, artifactId: string, targetVersionId: string, createdBy?: string): Promise<ProposalVersion>;
/**
 * Read the content of a specific version snapshot.
 */
export declare function readVersionContent(workdir: string, namespace: string, artifactId: string, versionId: string): Promise<string>;
/**
 * Find the most recent artifact ID for a namespace by scanning the proposals directory.
 * Returns null if no proposals exist.
 */
export declare function findLatestArtifact(workdir: string, namespace: string): Promise<string | null>;
//# sourceMappingURL=proposal-version.service.d.ts.map