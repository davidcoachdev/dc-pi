import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  getSessionTodoData,
  loadOddPlans,
} from "../src/features/dc-plan/core/dc-plan-types.ts";
import { DcPlanPanel } from "../src/features/dc-plan/views/dc-plan-panel.ts";

function createMockTheme() {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
}

test("dc-plan: loadOddPlans parses odd/tasks markdown files correctly", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-plan-test-"));
  const tasksDir = path.join(tmpDir, "odd", "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });

  const mdContent = `# Mi Gran Plan ODD

Este es un resumen de la feature.

## Lista de Tareas
- [x] Tarea 1 completada <!-- id: 1 -->
- [ ] Tarea 2 pendiente <!-- id: 2 -->
`;
  fs.writeFileSync(path.join(tasksDir, "test-feature.md"), mdContent, "utf8");

  const plans = loadOddPlans(tmpDir);
  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.title, "Mi Gran Plan ODD");
  assert.equal(plans[0]?.tasks.length, 2);
  assert.equal(plans[0]?.doneCount, 1);
  assert.equal(plans[0]?.totalCount, 2);
  assert.equal(plans[0]?.percent, 50);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("dc-plan: getSessionTodoData extracts global session tasks", () => {
  (globalThis as unknown as Record<string, unknown>).__gentleEffectiveTodoTasks = [
    { id: 1, title: "Tarea A", status: "done" },
    { id: 2, title: "Tarea B", status: "in_progress" },
    { id: 3, title: "Tarea C", status: "pending" },
  ];

  const todoData = getSessionTodoData();
  assert.equal(todoData.totalCount, 3);
  assert.equal(todoData.doneCount, 1);
  assert.equal(todoData.inProgressCount, 1);
  assert.equal(todoData.pendingCount, 1);
  assert.equal(todoData.percent, 33);
});

test("dc-plan: DcPlanPanel renders without crashing and navigates", () => {
  const theme = createMockTheme();
  let doneCalled = false;
  const panel = new DcPlanPanel(theme as never, () => {
    doneCalled = true;
  });

  const lines = panel.render(80);
  assert.ok(lines.length > 0);
  assert.ok(lines[0]?.includes("PLANES & TAREAS"));

  // Pressing Esc calls onDone
  panel.handleInput("\x1b");
  assert.equal(doneCalled, true);
});
