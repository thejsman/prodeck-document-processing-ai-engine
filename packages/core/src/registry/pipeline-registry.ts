import { ExtractorRegistry, type Extractor } from './extractor-registry.js';
import { ProcessorRegistry, type Processor } from './processor-registry.js';
import { ExporterRegistry, type Exporter } from './exporter-registry.js';

export class PipelineRegistry {
  private readonly extractors: ExtractorRegistry;
  private readonly processors: ProcessorRegistry;
  private readonly exporters: ExporterRegistry;

  constructor() {
    this.extractors = new ExtractorRegistry();
    this.processors = new ProcessorRegistry();
    this.exporters = new ExporterRegistry();
  }

  registerExtractor(extractor: Extractor): void {
    this.extractors.register(extractor);
  }

  registerProcessor(processor: Processor): void {
    this.processors.register(processor);
  }

  registerExporter(exporter: Exporter): void {
    this.exporters.register(exporter);
  }

  getExtractor(name: string, stepIndex?: number): Extractor {
    return this.extractors.get(name, stepIndex);
  }

  getProcessor(name: string, stepIndex?: number): Processor {
    return this.processors.get(name, stepIndex);
  }

  getExporter(name: string, stepIndex?: number): Exporter {
    return this.exporters.get(name, stepIndex);
  }
}
