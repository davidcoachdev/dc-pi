import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { DispatchedIssueTask } from "../src/features/dc-agents/daemon/dc-issue-dispatcher.ts";

const scratch = mkdtempSync(join(process.cwd(), ".test-build/control-center-"));
const originalHome = process.env.HOME;
process.env.HOME = scratch;
const { DcControlCenterPanel } = await import("../src/features/dc-agents/views/dc-control-center-modal.ts");
const { dcIssueDispatcher } = await import("../src/features/dc-agents/daemon/dc-issue-dispatcher.ts");
const { dcRemoteQuestionManager } = await import("../src/features/dc-agents/daemon/dc-remote-question.ts");
const { getCollaboratorsDatabase } = await import("../src/features/dc-agents/daemon/dc-collaborators-db.ts");
const { visibleWidth } = await import("@earendil-works/pi-tui");
const theme = { fg: (_: string, text: string) => text, bg: (_: string, text: string) => text, bold: (text: string) => text } as Theme;
const panel = () => new DcControlCenterPanel(theme, () => {});
const text = (view: InstanceType<typeof DcControlCenterPanel>, width = 140) => view.render(width).join("\n");

beforeEach(() => {
  test.mock.restoreAll();
  test.mock.method(dcIssueDispatcher, "getActiveDispatches", () => []);
  for (const question of dcRemoteQuestionManager.getPendingQuestions()) {
    dcRemoteQuestionManager.postAnswer({ questionId: question.id, answeredAt: Date.now(), source: "dismissed" });
  }
});
after(() => {
  test.mock.restoreAll();
  getCollaboratorsDatabase().close();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(scratch, { recursive: true, force: true });
});

function question(allowCustomText = true) {
  return dcRemoteQuestionManager.postQuestion({ issueNumber: 16, issueTitle: "Ventana", contextSummary: "Contexto real", question: "¿Qué opción?", options: ["Primera", "Segunda"], allowCustomText });
}

test("S2: starts live with truthful empty counters and no invented GitHub sync", () => {
  const view = panel();
  assert.equal(view.isSimulatedMode(), false);
  const output = text(view);
  assert.match(output, /0 trabajando/);
  assert.match(output, /EN VIVO/);
  assert.match(output, /Sin decisiones pendientes/);
  assert.doesNotMatch(output, /WibondConnect|3 listos|4 listos|GitHub al día|hace 10m/);
});

test("S1-S2: live tasks render their real decorated ODD roadmap, never a decision card", () => {
  const worktree = join(scratch, "worktree");
  mkdirSync(join(worktree, "odd/tasks"), { recursive: true });
  writeFileSync(join(worktree, "odd/tasks/issue-16.md"), "## Tasks\n✔ T1: Entorno [done]\n▶ T2: Implementar [in_progress]\n✖ T3: Pruebas [failed]\n○ T4: Entrega [pending]\n## Log\nT99: No mostrar [done]\n");
  test.mock.method(dcIssueDispatcher, "getActiveDispatches", () => [{ issueNumber: 16, issueTitle: "Ventana real", worktreePath: worktree, taskSlug: "issue-16", branchName: "feat/issue-16" } as DispatchedIssueTask]);
  const output = text(panel(), 180);
  assert.match(output, /Tareas » #16 Ventana real/);
  assert.match(output, /T1: Entorno.*\[DONE\]/);
  assert.match(output, /T2: Implementar.*\[EN PROCESO\]/);
  assert.match(output, /T3: Pruebas.*\[FALLO\]/);
  assert.match(output, /T4: Entrega.*\[PENDIENTE\]/);
  assert.doesNotMatch(output, /RESUMEN|T99/);
});

test("S2: demo is opt-in and its actions never write audit events or answer live questions", () => {
  const pending = question();
  const view = panel();
  const db = getCollaboratorsDatabase();
  const before = db.getRecentLogs(100);
  view.handleInput("m");
  assert.match(text(view), /MODO PRUEBA/);
  assert.match(text(view), /WibondConnect/);
  for (const key of ["a", "n", "d", "o", "/", "texto de prueba", "\r"]) view.handleInput(key);
  assert.deepEqual(db.getRecentLogs(100), before);
  assert.equal(dcRemoteQuestionManager.getPendingQuestions()[0]?.id, pending.id);
  view.handleInput("m");
  assert.equal(view.isSimulatedMode(), false);
});

test("S2: unsupported task actions and unaddressed text never claim execution or add logs", () => {
  const view = panel();
  const db = getCollaboratorsDatabase();
  const before = db.getRecentLogs(100);
  for (const key of ["a", "n", "d", "o", "/", "hola", "\r"]) view.handleInput(key);
  const output = text(view);
  assert.doesNotMatch(output, /✔.*(?:ejecutado|Enviado|Pospuesto|Abriendo|Descartado)/);
  assert.deepEqual(db.getRecentLogs(100), before);
});

test("S1: every advertised question option can be selected and sent through the real mailbox", async () => {
  const packet = question();
  const view = panel();
  view.handleInput("]");
  assert.match(text(view), /Segunda/);
  view.handleInput("\r");
  assert.deepEqual(dcRemoteQuestionManager.getPendingQuestions(), []);
  const answer = await dcRemoteQuestionManager.waitForAnswer(packet.id, 50);
  assert.equal(answer.source, "option");
  assert.equal(answer.chosenOption, "Segunda");
});

test("S2: input respects allowCustomText and sends pasted Unicode only to its selected question", async () => {
  const blocked = question(false);
  const view = panel();
  view.handleInput("/");
  assert.equal(view.isInputActive(), false);
  assert.equal(dcRemoteQuestionManager.getPendingQuestions()[0]?.id, blocked.id);
  view.handleInput("n");
  const dismissed = await dcRemoteQuestionManager.waitForAnswer(blocked.id, 50);
  assert.equal(dismissed.source, "dismissed");
  const packet = question();
  view.handleInput("/");
  view.handleInput("solución española");
  view.handleInput("\r");
  const answer = await dcRemoteQuestionManager.waitForAnswer(packet.id, 50);
  assert.equal(answer.source, "custom_text");
  assert.equal(answer.customText, "solución española");
});

test("S1: selection remains visible beyond 23 rows and all rendered widths are bounded", () => {
  const packets = Array.from({ length: 30 }, (_, i) => ({ id: `q-${i}`, issueNumber: i, issueTitle: `Issue ${i}`, question: `Question ${i}`, contextSummary: "Context", options: ["Yes", "No"], createdAt: i, expiresAt: Date.now() + 60000 }));
  test.mock.method(dcRemoteQuestionManager, "getPendingQuestions", () => packets);
  const view = panel();
  for (let i = 0; i < 29; i++) view.handleInput("j");
  for (const width of [20, 40, 80, 100, 140, 180]) {
    const lines = view.render(width);
    assert.equal(lines.length, 34);
    assert.ok(lines.every((line) => visibleWidth(line) <= width), `overflow at ${width}`);
  }
  const output = text(view);
  assert.match(output, /▶.*Issue #29/);
  assert.match(output, /para escribir/);
});

test("S1: missing ODD file reports unavailable rather than fabricated progress", () => {
  test.mock.method(dcIssueDispatcher, "getActiveDispatches", () => [{ issueNumber: 16, issueTitle: "Missing", worktreePath: join(scratch, "missing"), taskSlug: "missing" } as DispatchedIssueTask]);
  const output = text(panel());
  assert.match(output, /Hoja de ruta no disponible/);
  assert.doesNotMatch(output, /\[DONE\]|\[EN PROCESO\]/);
});

test("S1: mouse selection uses rendered item rows and tab widths", () => {
  const first = question();
  dcRemoteQuestionManager.postQuestion({ id: "second", issueNumber: 17, issueTitle: "Second", question: "Other?", contextSummary: "Other", options: ["Yes"] });
  const view = panel();
  const rows = view.render(80);
  const itemRow = rows.findIndex((line) => line.split("│")[0]!.includes(`Issue #${first.issueNumber} Pregunta`));
  assert.ok(itemRow >= 0);
  assert.equal(view.handleMouse({ type: "click", button: "left", x: 4, y: itemRow } as any)?.handled, true);
  assert.match(text(view), /Decisiones » Issue #16/);
  view.render(80);
  view.handleMouse({ type: "click", button: "left", x: 20, y: 2 } as any);
  assert.equal(view.getActiveTab(), "collaborators");
});

test("S2: text stays bound to its original question when a new question arrives", async () => {
  const packet = question();
  const view = panel();
  view.handleInput("/");
  dcRemoteQuestionManager.postQuestion({ id: "new", issueNumber: 17, issueTitle: "New", question: "New?", contextSummary: "New", options: ["Yes"] });
  view.handleInput("bound answer");
  view.handleInput("\r");
  const answer = await dcRemoteQuestionManager.waitForAnswer(packet.id, 50);
  assert.equal(answer.customText, "bound answer");
  assert.deepEqual(dcRemoteQuestionManager.getPendingQuestions().map((q) => q.id), ["new"]);
});

test("S2: expired input, control-bearing paste and grapheme backspace cannot misroute answers", async () => {
  const packet = question();
  const view = panel();
  view.handleInput("/");
  view.handleInput("\x1b[200~español\x1b[201~");
  view.handleInput("😀");
  view.handleInput("\x7f");
  view.handleInput("n\u0303");
  view.handleInput("\x7f");
  view.handleInput("\x1b[200~bad\ntext\x1b[201~");
  view.handleInput("\x1b[31m");
  assert.equal(view.getInputText(), "español");
  dcRemoteQuestionManager.postAnswer({ questionId: packet.id, answeredAt: Date.now(), source: "dismissed" });
  view.handleInput("\r");
  assert.match(text(view), /No enviado: la pregunta ya no está disponible/);
  const answer = await dcRemoteQuestionManager.waitForAnswer(packet.id, 50);
  assert.equal(answer.source, "dismissed");
  assert.equal(answer.customText, undefined);
});

test("S1-S2: collaborator selection and audit scrolling retain prior live behavior", () => {
  const db = getCollaboratorsDatabase();
  for (let i = 0; i < 30; i++) {
    db.setCollaborator(`fixture-${String(i).padStart(2, "0")}`, "PENDING", "CONTRIBUTOR");
    db.log({ actor: "test", category: "DISPATCH", level: "INFO", message: `event-${i}` });
  }
  const view = panel();
  view.handleInput("2");
  for (let i = 0; i < 29; i++) view.handleInput("j");
  const selected = db.listCollaborators()[29]!;
  assert.match(text(view), new RegExp(`▶ @${selected.login}`));
  view.handleInput(" ");
  assert.equal(db.getCollaborator(selected.login)?.status, "ALLOW");
  view.setSimulatedMode(true);
  const before = db.listCollaborators();
  const logs = db.getRecentLogs(100);
  view.handleInput(" ");
  assert.deepEqual(db.listCollaborators(), before);
  assert.deepEqual(db.getRecentLogs(100), logs);
  view.setSimulatedMode(false);
  view.handleInput("3");
  for (let i = 0; i < 29; i++) view.handleInput("j");
  const expected = db.getRecentLogs(50)[29]!;
  assert.ok(text(view).includes(expected.message));
});

test("S2: clicking arbitrary detail content never answers a question", () => {
  const packet = question();
  const view = panel();
  view.render(140);
  view.handleMouse({ type: "click", button: "left", x: 100, y: 16 } as any);
  assert.equal(dcRemoteQuestionManager.getPendingQuestions()[0]?.id, packet.id);
});
