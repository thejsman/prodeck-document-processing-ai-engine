/**
 * search-documents tool
 *
 * Searches namespace knowledge base via the FAISS vector store.
 *
 * Input:
 *   query     — search query
 *   namespace — namespace to search within
 *
 * Output:
 *   text — concatenated matching document chunks
 *
 * This tool wraps the knowledge bridge's queryKnowledgeBase function,
 * connecting agents to the existing RAG system.
 *
 * The tool requires a `queryFn` injected at construction time so that
 * core stays pure (no filesystem/subprocess access from core).
 */

import type { Tool, ToolInput, ToolOutput } from '@ai-engine/core';

export interface SearchDocumentsConfig {
  /**
   * Function that performs the actual knowledge base query.
   * Injected by the CLI/API layer using the runtime knowledge bridge.
   */
  queryFn: (namespace: string, question: string) => Promise<string>;
}

export class SearchDocumentsTool implements Tool {
  readonly name = 'search-documents';
  readonly description =
    'Searches the namespace knowledge base (FAISS RAG) and returns matching document chunks.';

  private readonly queryFn: SearchDocumentsConfig['queryFn'];

  constructor(config: SearchDocumentsConfig) {
    this.queryFn = config.queryFn;
  }

  async run(input: ToolInput): Promise<ToolOutput> {
    const query = input.query ?? '';
    const namespace = input.namespace ?? '';

    if (!query) {
      throw new Error('search-documents tool requires a query');
    }
    if (!namespace) {
      throw new Error('search-documents tool requires a namespace');
    }

    const answer = await this.queryFn(namespace, query);
    return { text: answer };
  }
}
