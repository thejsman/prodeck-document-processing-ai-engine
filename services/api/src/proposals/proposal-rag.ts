import { QdrantVectorStoreProvider } from '@ai-engine/runtime';
import { resolveVectorStoreConfig } from '../ingestion/branch-runner.js';
import type { RetrievedChunk } from '@ai-engine/plugin-proposal-generator';

export async function retrieveProposalContext(
  workdir: string,
  namespace: string,
  client: string,
  industry: string,
): Promise<RetrievedChunk[] | null> {
  try {
    const vsConfig = await resolveVectorStoreConfig(workdir, namespace);
    if (vsConfig?.type !== 'qdrant') return null;

    const provider = new QdrantVectorStoreProvider(workdir, vsConfig.url, vsConfig.apiKey);

    const queries = [
      `${client} project overview scope objectives requirements`,
      `proposed solution approach methodology implementation plan`,
      `pricing cost budget commercials risk compliance regulatory`,
      `${industry} technology infrastructure team capabilities`,
    ];

    const results = await Promise.allSettled(
      queries.map((q) =>
        provider.search({ namespace, queryEmbedding: [], topK: 8, filter: { query: q } })
      )
    );

    const seen = new Set<string>();
    const chunks: RetrievedChunk[] = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const hit of r.value) {
        const key = hit.text?.trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        chunks.push({
          text: hit.text,
          score: hit.score,
          document: hit.metadata?.['fileName'] as string | undefined,
        });
      }
    }

    chunks.sort((a, b) => b.score - a.score);
    return chunks.slice(0, 30);
  } catch {
    return null;
  }
}
