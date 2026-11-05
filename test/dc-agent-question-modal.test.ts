import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { AgentAnswerPacket } from "../src/features/dc-agents/daemon/dc-remote-question.ts";

const home = mkdtempSync(join(tmpdir(), "dc-question-modal-home-"));
const originalHome = process.env.HOME;
process.env.HOME = home;
after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});
const { DcAgentQuestionPanel } = await import("../src/features/dc-agents/views/dc-agent-question-modal.ts");
const { DcRemoteQuestionManager } = await import("../src/features/dc-agents/daemon/dc-remote-question.ts");

const theme = { fg: (_: string, text: string) => text, bold: (text: string) => text } as Theme;

function exercise(inputs: string[], expected: Partial<AgentAnswerPacket>, allowCustomText = true): void {
  const dir = mkdtempSync(join(tmpdir(), "dc-question-input-"));
  try {
    const manager = new DcRemoteQuestionManager(dir);
    const packet = manager.postQuestion({ issueNumber: 5, issueTitle: "Pregunta", contextSummary: "Contexto",
      question: "¿Qué hacemos?", options: ["Sí", "No"], allowCustomText });
    let answer: AgentAnswerPacket | undefined;
    const panel = new DcAgentQuestionPanel(packet, theme, (value) => { answer = value; }, undefined, manager);
    for (const input of inputs) panel.handleInput(input);
    assert.ok(answer, "input must submit an answer");
    for (const [key, value] of Object.entries(expected)) assert.equal(answer[key as keyof AgentAnswerPacket], value);
    assert.equal(answer.questionId, packet.id);
    assert.equal(manager.getPendingQuestions().length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("S5: backspace deletes a complete supplementary grapheme", () => {
  exercise(["😀", "\x7f", "x", "\r"], { source: "custom_text", customText: "x" });
});
test("S5: backspace deletes decomposed Spanish ñ, including separately typed accents", () => {
  exercise(["n\u0303", "\x7f", "x", "\r"], { source: "custom_text", customText: "x" });
  exercise(["n", "\u0303", "\x7f", "x", "\r"], { source: "custom_text", customText: "x" });
});
test("S5: left/right and insertion stay on complete grapheme boundaries", () => {
  exercise(["😀n\u0303", "\x1b[D", "x", "\x1b[C", "y", "\r"],
    { source: "custom_text", customText: "😀xn\u0303y" });
  exercise(["😀n\u0303", "\x1b[D", "\x1b[D", "\x1b[D", "x", "\x1b[C", "y", "\r"],
    { source: "custom_text", customText: "x😀yn\u0303" });
  exercise(["😀", "\x1b[C", "\x1b[C", "x", "\r"], { source: "custom_text", customText: "😀x" });
});
test("S5: forward delete removes complete graphemes and stops at end", () => {
  exercise(["😀n\u0303x", "\x1b[D", "\x1b[D", "\x1b[D", "\x1b[3~", "\x1b[3~", "\x1b[C", "\x1b[3~", "\r"],
    { source: "custom_text", customText: "x" });
});
test("S5: insertion that joins a following combining mark leaves cursor after the grapheme", () => {
  exercise(["\u0303", "\x1b[D", "n", "\x7f", "x", "\r"], { source: "custom_text", customText: "x" });
});
test("S5: ñ starts custom input and Spanish accents survive typing", () => {
  exercise(["ñ", "á", "é", "í", "ó", "ú", "ü", "¿", "¡", "\r"], { source: "custom_text", customText: "ñáéíóúü¿¡" });
});
test("S5: ordinary multi-character paste starts custom input (including digit prefixes)", () => {
  exercise(["1 solución española", "\r"], { source: "custom_text", customText: "1 solución española" });
});
test("S5: Pi bracketed paste is text, not an option or submit command", () => {
  exercise(["\x1b[200~1 solución española\x1b[201~", "\r"], { source: "custom_text", customText: "1 solución española" });
});
test("S5: paste and Spanish text insert at the editing cursor", () => {
  exercise(["\t", "sí", "\x1b[D", "ñ", "\x1b[200~áé\x1b[201~", "\r"],
    { source: "custom_text", customText: "sñáéí" });
});
test("S5: control-bearing chunks cannot start custom input or submit a paste", () => {
  exercise(["bad\x1b[31m", "\x1b[200~línea\nsiguiente\x1b[201~", "\r"], { source: "option", chosenOption: "Sí" });
});
test("S5: Kitty printable input uses Pi decoding", () => {
  exercise(["\x1b[241u", "\x1b[225u", "\r"], { source: "custom_text", customText: "ñá" });
});
test("S5: control sequences and control-bearing paste never enter answers", () => {
  exercise(["\t", "válido", "\x1b[31m", "\x1b]0;title\x07", "\x1b[97;5u", "\x9b31m", "bad\x00text", "\x1b[200~bad\x1b[31m\x1b[201~", "\r"],
    { source: "custom_text", customText: "válido" });
});
test("prior ASCII editing: Tab, cursor movement, backspace, insertion, submit", () => {
  exercise(["\t", "a", "b", "\x1b[D", "\x7f", "c", "\x1b[C", "d", "\r"], { source: "custom_text", customText: "cbd" });
});
test("prior selection: numeric, arrows, space, and disabled custom input", () => {
  exercise(["2"], { source: "option", chosenOption: "No" });
  exercise(["\x1b[B", " "], { source: "option", chosenOption: "No" });
  exercise(["\x1b[A", "\r"], { source: "option", chosenOption: "No" });
  exercise(["\t", "ñ", "paste", "\r"], { source: "option", chosenOption: "Sí" }, false);
});
test("prior custom semantics: empty fallback and Tab returns to selection", () => {
  exercise(["\t", "\r"], { source: "option", chosenOption: "Sí" });
  exercise(["t", "e", "x", "t", "o", "\t", "2"], { source: "option", chosenOption: "No" });
});
test("prior cancellation: Escape dismisses in either mode", () => {
  exercise(["\x1b"], { source: "dismissed", customText: undefined });
  exercise(["\t", "texto", "\x1b"], { source: "dismissed", customText: undefined });
});
