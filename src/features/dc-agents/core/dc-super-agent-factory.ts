import {
  DC_SUPER_AGENT_EVENT_TRIGGERS,
  type DcSuperAgentDefinition,
  type DcSuperAgentEventHandler,
  type DcSuperAgentEventTrigger,
} from "./dc-super-agent-definition.ts";
import { dcSuperAgentRegistry, type DcSuperAgentRegistry } from "./dc-super-agent-registry.ts";

export interface CreateSuperAgentOptions {
  agentNumber: number;
  id?: string;
  name: string;
  role: string;
  description: string;
  eventTriggers: DcSuperAgentEventTrigger[];
  systemDirectives?: string[];
  worktreeScope?: "isolated_per_task" | "repo" | "none";
  icon?: string;
  handler?: DcSuperAgentEventHandler;
  registry?: DcSuperAgentRegistry;
}

const VALID_TRIGGERS = new Set<string>(DC_SUPER_AGENT_EVENT_TRIGGERS);
const VALID_WORKTREE_SCOPES = new Set<string>(["isolated_per_task", "repo", "none"]);

/**
 * Fábrica para instanciar y registrar nuevos Super-Agentes autónomos
 * en el ecosistema DC Studio sin conjeturas ni código hardcodeado.
 */
export class DcSuperAgentFactory {
  public static createAgent(options: CreateSuperAgentOptions): DcSuperAgentDefinition {
    if (!Number.isInteger(options.agentNumber) || options.agentNumber < 0) {
      throw new Error(`Número de Super-Agente inválido: ${String(options.agentNumber)}. Debe ser un entero >= 0.`);
    }

    const name = typeof options.name === "string" ? options.name.trim() : "";
    if (!name) {
      throw new Error("El nombre del Super-Agente es obligatorio.");
    }

    const role = typeof options.role === "string" ? options.role.trim() : "";
    if (!role) {
      throw new Error("El rol del Super-Agente es obligatorio.");
    }

    const description = typeof options.description === "string" ? options.description.trim() : "";
    if (!description) {
      throw new Error("La descripción del Super-Agente es obligatoria.");
    }

    if (!Array.isArray(options.eventTriggers) || options.eventTriggers.length === 0) {
      throw new Error("Debe especificar al menos un trigger válido en eventTriggers.");
    }

    const uniqueTriggers: DcSuperAgentEventTrigger[] = [];
    for (const trigger of options.eventTriggers) {
      if (!VALID_TRIGGERS.has(trigger)) {
        throw new Error(
          `Trigger inválido: "${String(trigger)}". Permitidos: ${DC_SUPER_AGENT_EVENT_TRIGGERS.join(", ")}.`,
        );
      }
      if (!uniqueTriggers.includes(trigger)) {
        uniqueTriggers.push(trigger);
      }
    }

    const worktreeScope = options.worktreeScope ?? "isolated_per_task";
    if (!VALID_WORKTREE_SCOPES.has(worktreeScope)) {
      throw new Error(`worktreeScope inválido: "${String(worktreeScope)}".`);
    }

    const targetRegistry = options.registry ?? dcSuperAgentRegistry;
    const existing = targetRegistry.getAgent(options.agentNumber);
    if (existing) {
      throw new Error(`El Super-Agente #${options.agentNumber} ya está registrado (${existing.name}).`);
    }

    const id = options.id?.trim() || `super_agent_${options.agentNumber}`;
    const existingById = targetRegistry.getAgentById(id);
    if (existingById) {
      throw new Error(`El identificador "${id}" ya está registrado (${existingById.name}).`);
    }

    const definition: DcSuperAgentDefinition = {
      agentNumber: options.agentNumber,
      id,
      name,
      role,
      description,
      eventTriggers: uniqueTriggers,
      systemDirectives: options.systemDirectives?.length
        ? options.systemDirectives
        : [`Operar de forma autónoma según el rol especializado: ${role}`],
      worktreeScope,
      ...(options.icon ? { icon: options.icon } : {}),
      ...(options.handler ? { handler: options.handler } : {}),
    };

    targetRegistry.registerAgent(definition);
    if (options.handler) {
      targetRegistry.registerHandler(definition.agentNumber, options.handler);
    }

    return definition;
  }
}

/**
 * Helper canónico de alto nivel para crear y registrar un nuevo Super-Agente autónomo.
 */
export function createSuperAgent(options: CreateSuperAgentOptions): DcSuperAgentDefinition {
  return DcSuperAgentFactory.createAgent(options);
}
