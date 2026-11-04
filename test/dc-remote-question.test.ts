import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  DcRemoteQuestionManager,
  type AgentQuestionPacket,
} from "../src/features/dc-agents/daemon/dc-remote-question.ts";
import { DcAgentQuestionPanel } from "../src/features/dc-agents/views/dc-agent-question-modal.ts";

const dummyTheme: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

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
