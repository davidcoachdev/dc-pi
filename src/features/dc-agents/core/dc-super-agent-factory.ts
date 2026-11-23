import type { DcSuperAgentDefinition } from "./dc-super-agent-definition.ts";
import { dcSuperAgentRegistry } from "./dc-super-agent-registry.ts";

export interface CreateSuperAgentOptions {
  agentNumber: number;
  name: string;
  role: string;
  description: string;
  eventTriggers: Array<"issue_opened" | "issue_comment" | "pull_request" | "pull_request_review" | "chat">;
  systemDirectives?: string[];
  worktreeScope?: "isolated_per_task" | "repo" | "none";
}

/**
 * Fábrica para instanciar y registrar nuevos Super-Agentes autónomos
 * en el ecosistema DC Studio sin conjeturas ni código hardcodeado.
 */
export class DcSuperAgentFactory {
  public static createAgent(options: CreateSuperAgentOptions): DcSuperAgentDefinition {
    const existing = dcSuperAgentRegistry.getAgent(options.agentNumber);
    if (existing) {
      throw new Error(`El Super-Agente #${options.agentNumber} ya está registrado (${existing.name}).`);
    }

    const definition: DcSuperAgentDefinition = {
      agentNumber: options.agentNumber,
      id: `super_agent_${options.agentNumber}`,
      name: options.name,
      role: options.role,
      description: options.description,
      eventTriggers: options.eventTriggers,
      systemDirectives: options.systemDirectives || [
        `Operar de forma autónoma según el rol especializado: ${options.role}`,
      ],
      worktreeScope: options.worktreeScope || "isolated_per_task",
    };

    dcSuperAgentRegistry.registerAgent(definition);
    return definition;
  }
}
