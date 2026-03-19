const exporter = {
  name: 'json-exporter' as const,

  async export(data: unknown): Promise<string> {
    return JSON.stringify(data, null, 2);
  },
};

export default exporter;
