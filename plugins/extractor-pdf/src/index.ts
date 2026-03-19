interface Document {
  readonly type: string;
  readonly source: string;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

const extractor = {
  name: 'pdf-extractor' as const,

  supports(): boolean {
    return true;
  },

  async extract(input: unknown): Promise<Document> {
    const buffer = input as Buffer;
    const content = buffer.toString('utf-8');

    return {
      type: 'text',
      source: 'pdf',
      content,
      metadata: {},
      createdAt: new Date().toISOString(),
    };
  },
};

export default extractor;
