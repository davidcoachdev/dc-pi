import { EventEmitter } from "node:events";
import type { DcSuperAgentDefinition } from "./dc-super-agent-definition.ts";

/**
 * Registro central canónico de Super-Agentes autónomos de DC Studio.
 * Mantiene la lista de agentes reconocidos por el sistema, sus disparadores de eventos
 * y sus capacidades operativas.
 */
export class DcSuperAgentRegistry extends EventEmitter {
  private static instance?: DcSuperAgentRegistry;
  private agents = new Map<number, DcSuperAgentDefinition>();

  public static getInstance(): DcSuperAgentRegistry {
    if (!DcSuperAgentRegistry.instance) {
      DcSuperAgentRegistry.instance = new DcSuperAgentRegistry();
      DcSuperAgentRegistry.instance.initDefaultAgents();
    }
    return DcSuperAgentRegistry.instance;
  }

  private initDefaultAgents(): void {
    // 1. Super-Agente #86: Triage, resolución de Issues y conversación en GitHub
    this.registerAgent({
      agentNumber: 86,
      id: "super_agent_86",
      name: "DC Super-Agent #86",
      role: "issue_resolver",
      description: "Agente autónomo vigilante de Issues y comentarios en GitHub. Genera specs, corre TDD y resuelve problemas en worktrees aislados.",
      eventTriggers: ["issue_opened", "issue_comment", "chat"],
      systemDirectives: [
        "Enfocarse estrictamente en la resolución técnica del Issue asignado.",
        "Trabajar en Git worktree aislado sin tocar el working tree del usuario.",
        "Seguir TDD estricto y generar Pull Requests limpios.",
      ],
      worktreeScope: "isolated_per_task",
    });

    // 2. Super-Agente #99: Inspección de PRs, verificación adversarial y control de calidad
    this.registerAgent({
      agentNumber: 99,
      id: "super_agent_99",
      name: "DC Super-Agent #99",
      role: "pr_inspector",
      description: "Agente autónomo inspector de Pull Requests. Audita blast radius, corre suites de prueba y emite revisiones de código.",
      eventTriggers: ["pull_request", "pull_request_review", "chat"],
      systemDirectives: [
        "Verificar cambios de código contra el estándar KISS y YAGNI.",
        "Ejecutar pruebas de regresión y comprobar no-ff y blast radius.",
        "Emitir veredictos objetivos de aprobación o solicitud de cambios.",
      ],
      worktreeScope: "repo",
    });
  }

  public registerAgent(def: DcSuperAgentDefinition): void {
    this.agents.set(def.agentNumber, def);
    this.emit("agent_registered", def);
  }

  public getAgent(agentNumber: number): DcSuperAgentDefinition | undefined {
    return this.agents.get(agentNumber);
  }

  public getAgentById(id: string): DcSuperAgentDefinition | undefined {
    for (const a of this.agents.values()) {
      if (a.id === id || a.id === `super_agent_${id}` || `${a.agentNumber}` === id) {
        return a;
      }
    }
    return undefined;
  }

  public listAgents(): DcSuperAgentDefinition[] {
    return Array.from(this.agents.values()).sort((a, b) => a.agentNumber - b.agentNumber);
  }

  public getAgentsForTrigger(trigger: "issue_opened" | "issue_comment" | "pull_request" | "pull_request_review" | "chat"): DcSuperAgentDefinition[] {
    return this.listAgents().filter((a) => a.eventTriggers.includes(trigger));
  }
}

export const dcSuperAgentRegistry = DcSuperAgentRegistry.getInstance();
