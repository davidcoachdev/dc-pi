import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DcSuperAgentRegistry, dcSuperAgentRegistry } from "../src/features/dc-agents/core/dc-super-agent-registry.ts";
import { DcSuperAgentFactory, createSuperAgent } from "../src/features/dc-agents/core/dc-super-agent-factory.ts";
import { DcGitHubGateway } from "../src/features/dc-agents/daemon/dc-github-gateway.ts";
import { DcChatDispatcher, dcChatDispatcher } from "../src/features/dc-agents/daemon/dc-chat-dispatcher.ts";
import { createSuperAgentsSidebarCard } from "../src/features/dc-sidebar/components/dc-sidebar-super-agents-card.ts";
import { registerControlDaemonCommands } from "../src/features/dc-agents/daemon/dc-control-commands.ts";

function signWebhookBody(secret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

test("DcSuperAgentRegistry - Agentes por defecto #86 y #99 inicializados", () => {
  const registry = DcSuperAgentRegistry.getInstance();
  const agent86 = registry.getAgent(86);
  const agent99 = registry.getAgent(99);

  assert.ok(agent86, "Agente 86 debe existir");
  assert.equal(agent86.role, "issue_resolver");
  assert.ok(agent86.eventTriggers.includes("issue_opened"));
  assert.ok(agent86.eventTriggers.includes("issue_comment"));

  assert.ok(agent99, "Agente 99 debe existir");
  assert.equal(agent99.role, "pr_inspector");
  assert.ok(agent99.eventTriggers.includes("pull_request"));

  const issueAgents = registry.getAgentsForTrigger("issue_opened");
  assert.ok(issueAgents.some((a) => a.agentNumber === 86));

  const prAgents = registry.getAgentsForTrigger("pull_request");
  assert.ok(prAgents.some((a) => a.agentNumber === 99));
});

test("createSuperAgent & DcSuperAgentFactory - Validación, registro, handler y prevención de duplicados", (t) => {
  t.after(() => {
    dcSuperAgentRegistry.unregisterAgent(7);
  });

  const receivedEvents: string[] = [];
  const newAgent = createSuperAgent({
    agentNumber: 7,
    name: "DC Super-Agent #07 (Security Auditor)",
    role: "security_auditor",
    description: "Auditor autónomo de vulnerabilidades",
    eventTriggers: ["pull_request", "chat", "pull_request"],
    icon: "🛡️",
    handler: (evt) => {
      receivedEvents.push(`${evt.trigger}:${evt.action ?? ""}`);
    },
  });

  assert.equal(newAgent.agentNumber, 7);
  assert.equal(newAgent.id, "super_agent_7");
  assert.equal(newAgent.role, "security_auditor");
  assert.equal(newAgent.icon, "🛡️");
  assert.deepEqual(newAgent.eventTriggers, ["pull_request", "chat"]);

  assert.equal(dcSuperAgentRegistry.getAgent(7)?.name, "DC Super-Agent #07 (Security Auditor)");
  assert.equal(dcSuperAgentRegistry.getAgentById("super_agent_7")?.agentNumber, 7);
  assert.equal(typeof dcSuperAgentRegistry.getHandler(7), "function");

  dcSuperAgentRegistry.getHandler(7)?.({ trigger: "pull_request", action: "opened", payload: {} });
  assert.deepEqual(receivedEvents, ["pull_request:opened"]);

  // Duplicado debe fallar fail-fast
  assert.throws(() => {
    DcSuperAgentFactory.createAgent({
      agentNumber: 7,
      name: "Duplicado",
      role: "test",
      description: "test",
      eventTriggers: ["chat"],
    });
  }, /ya está registrado/);

  // Validaciones de entrada
  assert.throws(() => {
    createSuperAgent({
      agentNumber: -1,
      name: "Inválido",
      role: "tester",
      description: "desc",
      eventTriggers: ["chat"],
    });
  }, /inválido/i);

  assert.throws(() => {
    createSuperAgent({
      agentNumber: 12,
      name: "   ",
      role: "tester",
      description: "desc",
      eventTriggers: ["chat"],
    });
  }, /nombre/i);

  assert.throws(() => {
    createSuperAgent({
      agentNumber: 12,
      name: "Sin Triggers",
      role: "tester",
      description: "desc",
      eventTriggers: [],
    });
  }, /trigger/i);

  assert.throws(() => {
    createSuperAgent({
      agentNumber: 12,
      name: "Trigger Malo",
      role: "tester",
      description: "desc",
      eventTriggers: ["invalid_trigger" as any],
    });
  }, /Trigger inválido/);
});

test("DcGitHubGateway - Metadata neutral y enrutamiento dinámico por Registry (issues, comments, PRs y agente custom)", async (t) => {
  const testRegistry = new DcSuperAgentRegistry({ withDefaults: true });
  const routedLog: string[] = [];
  let issue86Calls = 0;
  let comment86Calls = 0;
  let pr99Calls = 0;
  let custom07Calls = 0;

  createSuperAgent({
    agentNumber: 7,
    name: "Security Sentinel",
    role: "security_auditor",
    description: "Revisa PRs y issues críticos",
    eventTriggers: ["pull_request", "issue_opened"],
    registry: testRegistry,
    handler: (evt) => {
      custom07Calls++;
      routedLog.push(`custom7:${evt.trigger}:${evt.action}`);
    },
  });

  const webhookSecret = "gateway-hmac-secret-test";
  const gateway = new DcGitHubGateway({
    port: 0,
    webhookSecret,
    expectedRepoNwo: "davidcoachdev/dc-pi",
    registry: testRegistry,
    onIssueOpened: () => {
      issue86Calls++;
      routedLog.push("legacy86:issue_opened");
    },
    onIssueCommentCreated: () => {
      comment86Calls++;
      routedLog.push("legacy86:issue_comment");
    },
    onPullRequest: () => {
      pr99Calls++;
      routedLog.push("legacy99:pull_request");
    },
  });

  const port = await gateway.start();
  t.after(async () => {
    await gateway.stop();
  });

  const meta = gateway.getMetadata();
  assert.equal(meta.id, "dc_github_gateway");
  assert.equal(meta.role, "ingress_gateway");
  assert.equal(meta.running, true);
  assert.equal(meta.port, port);
  assert.deepEqual(meta.registeredAgents, [7, 86, 99]);

  const subscribed = gateway.getSubscribedGitHubEvents();
  assert.ok(subscribed.includes("issues"));
  assert.ok(subscribed.includes("issue_comment"));
  assert.ok(subscribed.includes("pull_request"));

  // Query-string ?capability= debe rechazarse con 401
  const leakedQueryRes = await fetch(`http://127.0.0.1:${port}/github-webhook?capability=${webhookSecret}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "issues",
      "X-GitHub-Delivery": "del-query-rejected",
    },
    body: JSON.stringify({ action: "opened", issue: { number: 1 }, repository: { full_name: "davidcoachdev/dc-pi" } }),
  });
  assert.equal(leakedQueryRes.status, 401);

  const postWebhook = async (event: string, delivery: string, payload: unknown) => {
    const rawBody = JSON.stringify(payload);
    const res = await fetch(`http://127.0.0.1:${port}/github-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": event,
        "X-GitHub-Delivery": delivery,
        "X-Hub-Signature-256": signWebhookBody(webhookSecret, rawBody),
      },
      body: rawBody,
    });
    return { status: res.status, json: await res.json() as any };
  };

  // 1. issues.opened -> enruta a #7 (custom) y #86 (issue_resolver)
  const issueRes = await postWebhook("issues", "del-issue-1", {
    action: "opened",
    issue: { number: 101, title: "Test issue", user: { login: "davidcoachdev" } },
    repository: { full_name: "davidcoachdev/dc-pi" },
  });
  assert.equal(issueRes.status, 202);
  assert.deepEqual(issueRes.json.routedAgents, [7, 86]);
  assert.equal(issue86Calls, 1);
  assert.equal(custom07Calls, 1);

  // 2. issue_comment.created -> enruta solo a #86
  const commentRes = await postWebhook("issue_comment", "del-comment-1", {
    action: "created",
    issue: { number: 101, title: "Test issue" },
    comment: { id: 555, body: "hola", user: { login: "davidcoachdev" } },
    repository: { full_name: "davidcoachdev/dc-pi" },
  });
  assert.equal(commentRes.status, 202);
  assert.deepEqual(commentRes.json.routedAgents, [86]);
  assert.equal(comment86Calls, 1);

  // 3. pull_request.opened -> enruta a #7 (custom) y #99 (pr_inspector)
  const prOpenRes = await postWebhook("pull_request", "del-pr-1", {
    action: "opened",
    pull_request: { number: 42, title: "PR de prueba", user: { login: "davidcoachdev" } },
    repository: { full_name: "davidcoachdev/dc-pi" },
  });
  assert.equal(prOpenRes.status, 202);
  assert.deepEqual(prOpenRes.json.routedAgents, [7, 99]);
  assert.equal(pr99Calls, 1);
  assert.equal(custom07Calls, 2);

  // 4. pull_request.synchronize -> enruta a #7 (custom) y #99 (pr_inspector)
  const prSyncRes = await postWebhook("pull_request", "del-pr-2", {
    action: "synchronize",
    pull_request: { number: 42, title: "PR actualizado", user: { login: "davidcoachdev" } },
    repository: { full_name: "davidcoachdev/dc-pi" },
  });
  assert.equal(prSyncRes.status, 202);
  assert.deepEqual(prSyncRes.json.routedAgents, [7, 99]);
  assert.equal(pr99Calls, 2);
  assert.equal(custom07Calls, 3);

  assert.ok(routedLog.includes("custom7:issue_opened:opened"));
  assert.ok(routedLog.includes("custom7:pull_request:opened"));
  assert.ok(routedLog.includes("custom7:pull_request:synchronize"));
});

test("DcGitHubGateway - Registry sin agente suscrito no dispara callbacks legacy", () => {
  const emptyRegistry = new DcSuperAgentRegistry();
  let called = false;
  const gateway = new DcGitHubGateway({
    registry: emptyRegistry,
    onIssueOpened: () => {
      called = true;
    },
  });

  const routed = gateway.routeEvent("issue_opened", { issue: { number: 1 } });
  assert.deepEqual(routed, []);
  assert.equal(called, false);
});

test("Sidebar CTRL y Global Chat reflejan dinámicamente un Super-Agente creado en dcSuperAgentRegistry", async (t) => {
  t.after(() => {
    dcSuperAgentRegistry.unregisterAgent(55);
  });

  createSuperAgent({
    agentNumber: 55,
    name: "Release Guardian",
    role: "release_supervisor",
    description: "Supervisa releases y etiquetas",
    eventTriggers: ["pull_request", "chat"],
    icon: "🚀",
  });

  // 1. Sidebar CTRL card renderiza Gateway Ingress neutral + #86, #99 y #55 dinámicamente
  const card = createSuperAgentsSidebarCard();
  const rendered = stripAnsi(card.render(60).join("\n"));
  assert.match(rendered, /Gateway Ingress:/);
  assert.match(rendered, /Agente #86/);
  assert.match(rendered, /Agente #99/);
  assert.match(rendered, /#55 Release Guardian/);
  assert.match(rendered, /release_supervisor/);
  assert.doesNotMatch(rendered, /Daemon #86/);

  // 2. Global Chat (dc-control) refleja todos los agentes registrados en dcSuperAgentRegistry
  const gatewayChat = await dcChatDispatcher.dispatch({
    threadId: "dc-control",
    sender: "davidcoachdev",
    text: "¿qué agentes hay en el gateway?",
  });
  assert.equal(gatewayChat.respondent, "dc_control");
  assert.match(gatewayChat.reply, /Gateway Ingress/);
  assert.match(gatewayChat.reply, /#86/);
  assert.match(gatewayChat.reply, /#99/);
  assert.match(gatewayChat.reply, /#55 Release Guardian/);
  assert.match(gatewayChat.reply, /release_supervisor/);

  // 3. Global Chat hilo directo al agente dinámico #55
  const directChat = await dcChatDispatcher.dispatch({
    threadId: "general-55",
    sender: "davidcoachdev",
    text: "estado",
  });
  assert.equal(directChat.respondent, "super_agent_55");
  assert.match(directChat.reply, /Release Guardian/);
  assert.match(directChat.reply, /release_supervisor/);

  // 4. Instancia con registry inyectado también funciona aislada
  const isolatedRegistry = new DcSuperAgentRegistry({ withDefaults: true });
  const isolatedChat = new DcChatDispatcher({ registry: isolatedRegistry });
  const isolatedRes = await isolatedChat.dispatch({
    threadId: "dc-control",
    sender: "davidcoachdev",
    text: "estado del gateway",
  });
  assert.doesNotMatch(isolatedRes.reply, /#55 Release Guardian/);
  assert.match(isolatedRes.reply, /#86/);
  assert.match(isolatedRes.reply, /#99/);
});

test("Slash command /dc-control create-agent registra un Super-Agente y valida argumentos", async (t) => {
  t.after(() => {
    dcSuperAgentRegistry.unregisterAgent(77);
  });

  const commands = new Map<string, any>();
  const notifications: Array<{ msg: string; level?: string }> = [];
  const ctx: any = {
    hasUI: true,
    ui: {
      notify: (msg: string, level?: string) => {
        notifications.push({ msg, level });
      },
    },
  };

  registerControlDaemonCommands({
    registerCommand: (name: string, cmd: any) => commands.set(name, cmd),
    registerShortcut: () => {},
    on: () => {},
  } as any);

  const dcControl = commands.get("dc-control");
  assert.ok(dcControl, "Comando /dc-control debe estar registrado");
  assert.match(dcControl.description, /create-agent/);

  // Invocar sin suficientes argumentos -> aviso de uso
  await dcControl.handler("create-agent 77", ctx);
  assert.equal(dcSuperAgentRegistry.getAgent(77), undefined);
  assert.ok(notifications.some((n) => n.msg.includes("Uso: /dc-control create-agent")));

  // Invocar con argumentos válidos (incluyendo nombre con comillas y múltiples triggers)
  await dcControl.handler('create-agent 77 "Docs Guardian" docs_auditor pull_request,chat', ctx);
  const created = dcSuperAgentRegistry.getAgent(77);
  assert.ok(created, "Super-Agente #77 debe haberse registrado via comando");
  assert.equal(created.name, "Docs Guardian");
  assert.equal(created.role, "docs_auditor");
  assert.deepEqual(created.eventTriggers, ["pull_request", "chat"]);

  // Listar agentes via /dc-control agents
  notifications.length = 0;
  await dcControl.handler("agents", ctx);
  assert.ok(notifications.some((n) => n.msg.includes("#77 Docs Guardian")));
});
