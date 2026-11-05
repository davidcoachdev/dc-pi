import test, { after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { AgentQuestionPacket } from "../src/features/dc-agents/daemon/dc-remote-question.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Import singleton modules only after isolating every user-state location.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "dc-question-supervisor-home-"));
const originalEnv = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = path.join(home, "config");
process.env.PI_CODING_AGENT_DIR = path.join(home, "agent");
after(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(home, { recursive: true, force: true });
});
const { DcRemoteQuestionManager, dcRemoteQuestionManager } = await import("../src/features/dc-agents/daemon/dc-remote-question.ts");
const { DcAgentQuestionPanel } = await import("../src/features/dc-agents/views/dc-agent-question-modal.ts");
const { registerWebhookDaemonCommands } = await import("../src/features/dc-agents/daemon/dc-webhook-commands.ts");
const { dcWebhookDaemonManager } = await import("../src/features/dc-agents/daemon/dc-webhook-daemon-manager.ts");

const dummyTheme: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

test("S5: public supervisor uses the sidebar-published context, serializes questions and disposes its timer", async (t) => {
  const contextKey = Symbol.for("dc.sidebar.ctx");
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const previous = globals[contextKey];
  let tick!: () => Promise<void>;
  let shutdown!: (event: { reason: string }) => Promise<void>;
  let unrefs = 0;
  const timer = { unref: () => { unrefs++; } };
  t.mock.method(globalThis, "setInterval", (callback: () => Promise<void>, delay: number) => {
    assert.equal(delay, 1500);
    tick = callback;
    return timer;
  });
  const clear = t.mock.method(globalThis, "clearInterval", (value: unknown) => { assert.equal(value, timer); });
  const stop = t.mock.method(dcWebhookDaemonManager, "stop", async () => {});
  let opens = 0;
  let component: { handleInput(data: string): void } | undefined;
  const ctx = { hasUI: true, mode: "tui", ui: {
    custom: (factory: Function) => new Promise((resolve) => {
      opens++;
      component = factory({ requestRender() {} }, dummyTheme, {}, resolve);
    }),
  } } as unknown as ExtensionContext;
  const pi = {
    registerCommand() {}, registerShortcut() {},
    on: (name: string, handler: typeof shutdown) => { assert.equal(name, "session_shutdown"); shutdown = handler; },
  } as unknown as ExtensionAPI;
  const packet = dcRemoteQuestionManager.postQuestion({ id: "t3-supervisor", issueNumber: 21,
    issueTitle: "Integración", contextSummary: "Esperando humano", question: "¿Seguimos?", options: ["Sí", "No"] });
  try {
    registerWebhookDaemonCommands(pi);
    assert.equal(unrefs, 1);
    delete globals[contextKey];
    await tick();
    assert.equal(opens, 0, "no context must not open UI");
    globals[contextKey] = { ...ctx, mode: "rpc" };
    await tick();
    assert.equal(opens, 0, "non-TUI context must not open UI");
    globals[contextKey] = { ...ctx, hasUI: false };
    await tick();
    assert.equal(opens, 0, "headless context must not open UI");
    globals[contextKey] = ctx;
    const checking = tick();
    assert.equal(opens, 1, "the real published sidebar context must open the actual modal");
    await tick();
    assert.equal(opens, 1, "an unresolved modal must not open twice");
    component!.handleInput("2");
    await checking;
    const answer = await dcRemoteQuestionManager.waitForAnswer(packet.id, 100);
    assert.equal(answer.source, "option");
    assert.equal(answer.chosenOption, "No");
    await tick();
    assert.equal(opens, 1, "answered questions must not reopen");
    await shutdown({ reason: "reload" });
    assert.equal(clear.mock.callCount(), 1);
    assert.equal(stop.mock.callCount(), 0, "reload keeps the daemon alive");
    await shutdown({ reason: "quit" });
    assert.equal(clear.mock.callCount(), 2);
    assert.equal(stop.mock.callCount(), 1, "real shutdown stops the daemon");
  } finally {
    component?.handleInput("\x1b");
    globals[contextKey] = previous;
    dcRemoteQuestionManager.postAnswer({ questionId: packet.id, source: "dismissed", answeredAt: Date.now() });
    await dcRemoteQuestionManager.waitForAnswer(packet.id, 100);
  }
});

test("dc-remote-question: canal IPC postQuestion y postAnswer con resolución", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-ipc-test-"));

  try {
    const manager = new DcRemoteQuestionManager(tmpDir);

    // 1. Worker emite pregunta
    const packet = manager.postQuestion({
      issueNumber: 13,
      issueTitle: "Configuración de webhook",
      contextSummary: "Analicé 3 archivos y tengo duda de arquitectura.",
      question: "¿Prefieres SQLite o archivo JSON?",
      options: ["SQLite central", "Archivo JSON"],
      allowCustomText: true,
      timeoutMs: 5000,
    });

    assert.ok(packet.id);
    assert.equal(packet.issueNumber, 13);

    // Debe figurar como pendiente
    const pending = manager.getPendingQuestions();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]?.id, packet.id);

    // 2. Simular que el usuario responde en la modal con texto libre
    const answerPromise = manager.waitForAnswer(packet.id, 3000);

    manager.postAnswer({
      questionId: packet.id,
      customText: "Usa SQLite central y agrega comando /dc-settings",
      answeredAt: Date.now(),
      source: "custom_text",
    });

    const receivedAnswer = await answerPromise;
    assert.equal(receivedAnswer.source, "custom_text");
    assert.equal(receivedAnswer.customText, "Usa SQLite central y agrega comando /dc-settings");

    // Ya no debe figurar como pendiente
    assert.equal(manager.getPendingQuestions().length, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("DcAgentQuestionPanel: renderiza contexto, opciones y maneja texto libre", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-panel-test-1-"));
  const localManager = new DcRemoteQuestionManager(tmpDir);

  try {
    const packet: AgentQuestionPacket = {
      id: "q-test-1",
      issueNumber: 13,
      issueTitle: "Ventana de admin",
      contextSummary: "Revisando dc-control-center-modal.ts",
      question: "¿Activamos modo central?",
      options: ["Sí, activar", "No"],
      allowCustomText: true,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    };

    let doneResult: any = null;
    const panel = new DcAgentQuestionPanel(
      packet,
      dummyTheme,
      (ans) => { doneResult = ans; },
      undefined,
      localManager,
    );

    // Render inicial
    const lines = panel.render(80);
    assert.ok(lines.some((l) => l.includes("📌 CONTEXTO")));
    assert.ok(lines.some((l) => l.includes("Revisando dc-control-center-modal.ts")));
    assert.ok(lines.some((l) => l.includes("❓ PREGUNTA CONCRETA")));
    assert.ok(lines.some((l) => l.includes("¿Activamos modo central?")));
    assert.ok(lines.some((l) => l.includes("[1] Sí, activar")));
    assert.ok(lines.some((l) => l.includes("ESCRIBE TU PROPIA INDICACIÓN")));

    // 1. Presionar '1' selecciona y envía la opción 1
    panel.handleInput("1");
    assert.ok(doneResult);
    assert.equal(doneResult.chosenOption, "Sí, activar");
    assert.equal(doneResult.source, "option");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("DcAgentQuestionPanel: escritura de texto personalizado interactivo", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-panel-test-2-"));
  const localManager = new DcRemoteQuestionManager(tmpDir);

  try {
    const packet: AgentQuestionPacket = {
      id: "q-test-2",
      issueNumber: 14,
      issueTitle: "Refactor",
      contextSummary: "Modificando src/core",
      question: "¿Qué enfoque aplicamos?",
      options: ["Enfoque A", "Enfoque B"],
      allowCustomText: true,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    };

    let doneResult: any = null;
    const panel = new DcAgentQuestionPanel(
      packet,
      dummyTheme,
      (ans) => { doneResult = ans; },
      undefined,
      localManager,
    );

    // Presionar Tab para activar caja de texto libre
    panel.handleInput("\t");

    // Escribir "Hola humano"
    for (const char of "Hola humano") {
      panel.handleInput(char);
    }

    // Presionar Enter para enviar
    panel.handleInput("enter");
    assert.ok(doneResult);
    assert.equal(doneResult.source, "custom_text");
    assert.equal(doneResult.customText, "Hola humano");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
