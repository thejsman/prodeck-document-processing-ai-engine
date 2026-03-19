import { agentRegistry } from './agent-registry.js';
import type { Agent } from './types.js';

/**
 * Register default agents into the module-level singleton registry.
 *
 * The caller (CLI, API server) is responsible for importing and instantiating
 * the concrete agent implementations. This function just inserts them into
 * the shared registry.
 *
 * Future agents (microsite-generator, rfp-generator, diagram-generator)
 * are added here when implemented.
 *
 * Example:
 *   import { ProposalSectionAgent } from '@ai-engine/agent-proposal-section';
 *   registerDefaultAgents([new ProposalSectionAgent()]);
 */
export function registerDefaultAgents(agents: Agent[]): void {
  for (const agent of agents) {
    agentRegistry.register(agent);
  }
}
