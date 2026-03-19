import type { Agent } from './types.js';

/**
 * Registry for named agents.
 *
 * Agents are registered at startup and retrieved by name at invocation time.
 * The registry itself has no knowledge of how agents work — it is a pure
 * name-to-instance map.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();

  register(agent: Agent): void {
    this.agents.set(agent.name, agent);
  }

  get(name: string): Agent | undefined {
    return this.agents.get(name);
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }
}

/** Module-level singleton. CLI and API both import this directly. */
export const agentRegistry = new AgentRegistry();
