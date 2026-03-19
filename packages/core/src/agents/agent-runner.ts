import type { AgentInput, AgentOutput, Planner } from './types.js';
import type { AgentRegistry } from './agent-registry.js';
import type { ConfigResolver } from '../config/config-resolver.js';
import type { MemoryRegistry } from '../memory/memory-registry.js';
import type { UsageRecorder } from '../usage/usage-recorder.js';
import type { ToolRegistry } from '../tools/tool-registry.js';

/**
 * AgentRunner — pure orchestrator for agent execution.
 *
 * Responsibilities:
 *   1. Resolve cascading namespace config (via ConfigResolver)
 *   2. Load namespace memory (via MemoryRegistry)
 *   3. Retrieve the agent from the registry
 *   4. Enrich AgentInput with resolved config + memory + tools + planner
 *   5. Execute the agent
 *   6. Record a usage event
 *
 * All I/O is delegated to injected dependencies.
 * This class has no filesystem, network, or env-var access of its own.
 */
export class AgentRunner {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly configResolver: ConfigResolver,
    private readonly memoryRegistry: MemoryRegistry,
    private readonly usageRecorder: UsageRecorder,
    private readonly toolRegistry?: ToolRegistry,
    private readonly planner?: Planner,
  ) {}

  async run(agentName: string, input: AgentInput): Promise<AgentOutput> {
    const agent = this.registry.get(agentName);
    if (!agent) {
      throw new Error(`Unknown agent: "${agentName}". Available: ${this.listNames()}`);
    }

    const config = await this.configResolver.resolve({ namespace: input.namespace });
    const memory = await this.memoryRegistry.getMemory(input.namespace);

    const enrichedInput: AgentInput = {
      ...input,
      config: { ...config, ...input.config },
      memory: { ...(memory as Record<string, unknown>), ...input.memory },
      tools: this.toolRegistry ?? input.tools,
      planner: this.planner ?? input.planner,
    };

    const output = await agent.run(enrichedInput);

    await this.usageRecorder.record({
      namespace: input.namespace,
      agent: agentName,
      timestamp: new Date().toISOString(),
    });

    return output;
  }

  private listNames(): string {
    const names = this.registry.list().map((a) => a.name);
    return names.length > 0 ? names.join(', ') : '(none registered)';
  }
}
