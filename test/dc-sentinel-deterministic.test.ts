import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  deriveSessionTitle,
  compileDeterministicSessionSummary,
  extractSessionGitStats,
  extractDeterministicNotes,
  extractDeterministicProcedures,
} from "../src/features/dc-sentinel/core/dc-sentinel-deterministic-extractor.ts";
import { SentinelRecorder } from "../src/features/dc-sentinel/core/dc-sentinel-recorder.ts";
import type { SentinelTurnRecord } from "../src/features/dc-sentinel/core/dc-sentinel-types.ts";

describe("T4a: current-revision evidence", () => {
  const tool = (toolName: string, startedAt: number, isError?: boolean, command = "npm test") => ({
    callId: String(startedAt), toolName, args: toolName === "bash" ? { command } : { path: "src/auth.ts" },
    startedAt, endedAt: startedAt + 1, ...(isError === undefined ? {} : { isError }), outputSnippet: "actual result",
  });
  const turn = (toolsExecuted: SentinelTurnRecord["toolsExecuted"]): SentinelTurnRecord => ({
    turnId: "evidence", timestamp: "2026-10-31", userPrompt: "fix auth bug", toolsExecuted,
    subagentsLaunched: [], errorsDetected: [], assistantSummary: "Tests pass; solution applied.",
  });
  const cases = [
    ["failed edit then echo", [tool("edit", 1, true), tool("bash", 3, false, "echo ok")]],
    ["failed test then echo", [tool("edit", 1, false), tool("bash", 3, true), tool("bash", 5, false, "echo ok")]],
    ["missing edit outcome", [tool("edit", 1), tool("bash", 3, false)]],
    ["missing verifier outcome", [tool("edit", 1, false), tool("bash", 3)]],
    ["verifier before edit", [tool("bash", 1, false), tool("edit", 3, false)]],
    ["later edit", [tool("edit", 1, false), tool("bash", 3, false), tool("edit", 5, false)]],
    ["ambiguous shell", [tool("edit", 1, false), tool("bash", 3, false, "npm test || echo ok")]],
    ["quoted verifier", [tool("edit", 1, false), tool("bash", 3, false, 'echo "npm test"')]],
    ["claim alone", []],
    ["masked test argument", [tool("edit", 1, false), tool("bash", 3, false, "npm test -- --help")]],
    ["overlapping verifier", [tool("edit", 3, false), tool("bash", 3, false)]],
    ["later failed verifier", [tool("edit", 1, false), tool("bash", 3, false), tool("bash", 5, true)]],
  ] as const;
  for (const [name, tools] of cases) it(name, () => {
    const record = turn([...tools]);
    const note = extractDeterministicNotes([record], "fixture")[0]!;
    assert.equal(note.proofCount, 0);
    assert.equal(note.status, "proposal");
    assert.equal(extractDeterministicProcedures([record], "fixture").length, 0);
  });
  for (const mutation of ["edit", "write"]) it(`pending later ${mutation} invalidates recorded proof at settlement`, () => {
    const recorder = new SentinelRecorder("pending-fixture", process.cwd());
    const active = recorder.startTurn("fix auth bug");
    recorder.recordToolStart("edit-a", "edit", { path: "src/auth.ts" });
    recorder.recordToolEnd("edit-a", "updated", false);
    recorder.recordToolStart("verify", "bash", { command: "npm test" });
    recorder.recordToolEnd("verify", "tests passed", false);
    assert.equal(extractDeterministicNotes([active], "fixture")[0]?.proofCount, 1);
    recorder.recordToolStart("pending-b", mutation, { path: "src/auth.ts" });
    const completed = recorder.endTurn("Tests pass")!;
    const note = extractDeterministicNotes([completed], "fixture")[0]!;
    assert.equal(note.proofCount, 0);
    assert.equal(note.status, "proposal");
    assert.equal(extractDeterministicProcedures([completed], "fixture").length, 0);
    const pending = completed.toolsExecuted.find((tool) => tool.callId === "pending-b")!;
    assert.ok(pending, "pending mutation must survive finalization");
    assert.equal(pending.endedAt, undefined);
    assert.equal(pending.isError, undefined);
    assert.equal(pending.turnId, completed.turnId);
    assert.equal(pending.project_path, completed.project_path);
    recorder.startTurn("next turn");
    recorder.recordToolEnd("pending-b", "late completion", false);
    assert.equal(recorder.getActiveTurn()?.toolsExecuted.length, 0);
    assert.equal(pending.endedAt, undefined, "late results must not rewrite finalized evidence");
    assert.equal(extractDeterministicNotes([completed], "fixture")[0]?.proofCount, 0);
  });
  for (const pendingTool of ["bash", "read"]) it(`pending ${pendingTool} retains unknown evidence at settlement`, (t) => {
    let clock = 100;
    t.mock.method(Date, "now", () => ++clock);
    const recorder = new SentinelRecorder("pending-verifier", process.cwd());
    recorder.startTurn("fix auth bug");
    recorder.recordToolStart("edit", "edit", { path: "src/auth.ts" });
    recorder.recordToolEnd("edit", "updated", false);
    recorder.recordToolStart("verified", "bash", { command: "npm test" });
    recorder.recordToolEnd("verified", "passed", false);
    recorder.recordToolStart("pending", pendingTool, pendingTool === "bash" ? { command: "npm test" } : { path: "src/auth.ts" });
    const completed = recorder.endTurn("Tests passed")!;
    const expectedProof = pendingTool === "bash" ? 0 : 1;
    const note = extractDeterministicNotes([completed], "fixture")[0]!;
    assert.equal(note.proofCount, expectedProof);
    assert.equal(note.status, expectedProof ? "active" : "proposal");
    assert.equal(extractDeterministicProcedures([completed], "fixture").length, expectedProof);
    const pending = completed.toolsExecuted.find((tool) => tool.callId === "pending")!;
    assert.ok(pending, "all pending calls must survive finalization");
    assert.equal(pending.isError, undefined);
    assert.equal(pending.endedAt, undefined);
    assert.equal(pending.turnId, completed.turnId);
    assert.equal(pending.project_path, completed.project_path);
    recorder.startTurn("next turn");
    recorder.recordToolEnd("pending", "late success", false);
    assert.equal(recorder.getActiveTurn()?.toolsExecuted.length, 0);
    assert.equal(pending.endedAt, undefined);
    assert.equal(extractDeterministicNotes([completed], "fixture")[0]?.proofCount, expectedProof);
  });
  it("rejects foreign root and turn provenance", () => {
    for (const foreign of [{ project_path: "/other" }, { turnId: "other" }]) {
      const record = { ...turn([tool("edit", 1, false), { ...tool("bash", 3, false), ...foreign }]), project_path: "/fixture" };
      assert.equal(extractDeterministicNotes([record], "fixture")[0]?.proofCount, 0);
      assert.equal(extractDeterministicProcedures([record], "fixture").length, 0);
    }
  });
  it("successful verifier after edit preserves actual command and result", () => {
    const record = turn([tool("edit", 1, false), tool("bash", 3, false, "npm run typecheck")]);
    const note = extractDeterministicNotes([record], "fixture")[0]!;
    assert.equal(note.proofCount, 1);
    assert.equal(note.status, "active");
    assert.match(note.content, /npm run typecheck/);
    assert.match(note.content, /actual result/);
    assert.equal(extractDeterministicProcedures([record], "fixture")[0]?.verificationCmd, "npm run typecheck");
  });
});

describe("dc-sentinel-deterministic: Extractor a Costo Cero sin LLM", () => {
  it("deriva títulos limpios sin slash commands ni espacios dobles", () => {
    assert.equal(deriveSessionTitle("/dc-sentinel revisar estado"), "revisar estado");
    assert.equal(deriveSessionTitle("  arreglar el bug   de auth  "), "arreglar el bug de auth");
    assert.equal(deriveSessionTitle(""), "Sesión de Desarrollo y Mantenimiento");
  });

  it("compila un resumen determinista completo a partir de turnos y stats", async () => {
    const turns: SentinelTurnRecord[] = [
      {
        turnId: "turn-1",
        timestamp: "2026-10-06T00:00:00Z",
        userPrompt: "arreglar el bug de validación en JWT",
        toolsExecuted: [
          {
            callId: "call-1",
            toolName: "read",
            args: { path: "src/auth.ts" },
            startedAt: 1000,
            endedAt: 1050,
          },
          {
            callId: "call-2",
            toolName: "edit",
            args: { path: "src/auth.ts" },
            startedAt: 1100,
            endedAt: 1150,
          },
        ],
        subagentsLaunched: [
          {
            agent: "dc-verify",
            task: "verificar tests de auth",
            startedAt: 1200,
            endedAt: 1400,
            isError: false,
          },
        ],
        errorsDetected: [],
      },
    ];

    const gitStats = {
      filesChanged: ["src/auth.ts", "test/auth.test.ts"],
      insertions: 15,
      deletions: 3,
      statSummary: "src/auth.ts | 10 ++\ntest/auth.test.ts | 8 +-\n",
      isClean: false,
    };

    const summary = await compileDeterministicSessionSummary({
      sessionId: "sess-test-123",
      project: "dc-pi",
      projectRoot: process.cwd(),
      turns,
      gitStats,
    });

    assert.equal(summary.title, "arreglar el bug de validación en JWT");
    assert.equal(summary.filesTouched.length, 2);
    assert.equal(summary.blastRadius.filesCount, 2);
    assert.equal(summary.blastRadius.risk, "low");
    assert.equal(summary.hasErrors, false);

    // Verifica que el Markdown contenga las secciones canónicas
    assert.ok(summary.markdown.includes("# Registro de Vuelo"));
    assert.ok(summary.markdown.includes("## 1. Intención Original del Usuario"));
    assert.ok(summary.markdown.includes("## 2. Superficie de Cambios (Git Diff Determinista)"));
    assert.ok(summary.markdown.includes("## 3. Herramientas y Subagentes Ejecutados"));

    // Verifica que se extraigan notas atómicas (bugfix detectado por 'arreglar el bug')
    assert.equal(summary.notesToPersist.length, 1);
    assert.equal(summary.notesToPersist[0].type, "bugfix");
    assert.equal(summary.notesToPersist[0].glyph, "●");
  });

  it("lee el estado real de git sin fallar en repositorios válidos", async () => {
    const git = await extractSessionGitStats(process.cwd());
    assert.ok(typeof git.isClean === "boolean");
    assert.ok(Array.isArray(git.filesChanged));
    assert.ok(typeof git.insertions === "number");
  });
});
