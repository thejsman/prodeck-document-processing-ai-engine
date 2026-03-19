import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPythonProcessor, type ExecutionContext } from '@ai-engine/runtime';

interface Document {
  readonly type: string;
  readonly source: string;
  readonly content: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPT_PATH = path.resolve(__dirname, '..', 'processor.py');

const processor = {
  name: 'python-processor' as const,

  async process(
    data: unknown,
    config?: Readonly<Record<string, unknown>>,
    context?: ExecutionContext,
  ): Promise<Document> {
    const document = data as Document;

    if (!context) {
      throw new Error('ExecutionContext is required for Python processor');
    }

    return await runPythonProcessor(
      SCRIPT_PATH,
      document,
      context,
      'python-processor',
    );
  },
};

export default processor;
