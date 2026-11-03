import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSlidingTabs } from "../src/features/dc-sentinel/core/dc-sentinel-sliding-tabs.ts";
import {
  SentinelLiveRegistry,
  type SentinelWorktreeTask,
} from "../src/features/dc-sentinel/core/dc-sentinel-live-types.ts";
import { DcSentinelLivePanel } from "../src/features/dc-sentinel/views/dc-sentinel-live-panel.ts";

test("computeSlidingTabs handles small and massive tab collections with sliding window", () => {
  // 1. Pocos items: caben todos
  const fewItems = [{ label: "task-1" }, { label: "task-2" }];
  const fewResult = computeSlidingTabs(fewItems, 0, 80);
  assert.equal(fewResult.slice.length, 2);
  assert.equal(fewResult.hiddenLeft, 0);
  assert.equal(fewResult.hiddenRight, 0);

  // 2. Muchos items (15 tareas o archivos) en un ancho de pantalla acotado (60 columnas)
  const manyItems = Array.from({ length: 15 }, (_, i) => ({
    label: `worktree-repo-long-name-${i + 1}`,
  }));

  // Con activeIndex = 7 (al centro)
  const manyResult = computeSlidingTabs(manyItems, 7, 60);

  // Debe mantener el elemento activo visible en el slice
  assert.equal(
    manyResult.slice.some((s) => s.index === 7 && s.isActive),
    true
  );

  // Debe recortar elementos a la izquierda y derecha
  assert.ok(manyResult.hiddenLeft > 0);
  assert.ok(manyResult.hiddenRight > 0);
  assert.equal(
    manyResult.hiddenLeft + manyResult.slice.length + manyResult.hiddenRight,
    15
  );
});

test("SentinelLiveRegistry manages live tasks idempotently", () => {
  const registry = new SentinelLiveRegistry();

  const dummyTask: SentinelWorktreeTask = {
    taskId: "task-100",
    taskTitle: "Fix token validation",
    repoName: "dc-pi",
    repoRoot: "/home/dc-studio/dc-pi",
    worktreePath: "/tmp/worktrees/task-100",
    branchName: "feat/fix-token-100",
    status: "working",
    subagentName: "dc-odd-worker",
    currentPhase: "implementing",
    currentTool: "edit",
    files: [
      { path: "src/auth.ts", status: "M", additions: 4, deletions: 1 },
      { path: "test/auth.test.ts", status: "M", additions: 12, deletions: 0 },
    ],
    diffsByFile: {
      "src/auth.ts": ["+ if (!token) return false;", "- return true;"],
    },
    logs: ["Iniciando worker"],
    tokensTotal: 1500,
    startTime: Date.now(),
  };

  registry.registerTask(dummyTask);
  assert.equal(registry.getTasks().length, 1);
  assert.equal(registry.getTask("task-100")?.status, "working");

  registry.updateTask("task-100", { status: "review", tokensTotal: 3200 });
  assert.equal(registry.getTask("task-100")?.status, "review");
  assert.equal(registry.getTask("task-100")?.tokensTotal, 3200);

  registry.removeTask("task-100");
  assert.equal(registry.getTasks().length, 0);
});

test("DcSentinelLivePanel renders structured split-view with mock theme", () => {
  const mockTheme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };

  let rendered = false;
  const panel = new DcSentinelLivePanel({
    theme: mockTheme as any,
    projectRoot: process.cwd(),
    onDone: () => {},
    requestRender: () => {
      rendered = true;
    },
    maxRows: 24,
  });

  const output = panel.render(100);
  assert.ok(output.length > 5);

  // La primera línea debe contener la cabecera de WORKTREES
  assert.match(output[0]!, /WORKTREES/);

  // Debe contener separadores de columna y borde
  assert.ok(output.some((line) => line.includes("│")));
});
