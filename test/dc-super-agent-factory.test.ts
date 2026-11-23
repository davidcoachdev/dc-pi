import test from "node:test";
import assert from "node:assert/strict";
import { DcSuperAgentRegistry } from "../src/features/dc-agents/core/dc-super-agent-registry.ts";
import { DcSuperAgentFactory } from "../src/features/dc-agents/core/dc-super-agent-factory.ts";

test("DcSuperAgentRegistry - Agentes por defecto #86 y #99 inicializados", () => {
  const registry = DcSuperAgentRegistry.getInstance();
  const agent86 = registry.getAgent(86);
  const agent99 = registry.getAgent(99);

  assert.ok(agent86, "Agente 86 debe existir");
  assert.equal(agent86.role, "issue_resolver");
  assert.ok(agent86.eventTriggers.includes("issue_opened"));

  assert.ok(agent99, "Agente 99 debe existir");
  assert.equal(agent99.role, "pr_inspector");
  assert.ok(agent99.eventTriggers.includes("pull_request"));

  const issueAgents = registry.getAgentsForTrigger("issue_opened");
  assert.ok(issueAgents.some((a) => a.agentNumber === 86));

  const prAgents = registry.getAgentsForTrigger("pull_request");
  assert.ok(prAgents.some((a) => a.agentNumber === 99));
});

test("DcSuperAgentFactory - Creación dinámica de nuevo Super-Agente", () => {
  const newAgent = DcSuperAgentFactory.createAgent({
    agentNumber: 7,
    name: "DC Super-Agent #07 (Security Auditor)",
    role: "security_auditor",
    description: "Auditor autónomo de vulnerabilidades",
    eventTriggers: ["pull_request", "chat"],
  });

  assert.equal(newAgent.agentNumber, 7);
  assert.equal(newAgent.id, "super_agent_7");
  assert.equal(newAgent.role, "security_auditor");

  const registry = DcSuperAgentRegistry.getInstance();
  assert.equal(registry.getAgent(7)?.name, "DC Super-Agent #07 (Security Auditor)");

  // Intentar crear duplicado debe fallar fail-fast
  assert.throws(() => {
    DcSuperAgentFactory.createAgent({
      agentNumber: 7,
      name: "Duplicado",
      role: "test",
      description: "test",
      eventTriggers: ["chat"],
    });
  }, /ya está registrado/);
});
