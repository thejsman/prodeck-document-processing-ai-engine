interface Document {
  readonly type: string;
  readonly source: string;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

const processor = {
  name: 'summarizer' as const,

  async process(data: unknown): Promise<Document> {
    const document = data as Document;

    return {
      ...document,
      content: document.content + ' [processed]',
    };
  },
};

export default processor;
