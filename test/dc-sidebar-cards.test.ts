import test from "node:test";
import assert from "node:assert/strict";
import { getEffectiveTodoTasks, createTodoCard } from "../src/features/dc-sidebar/components/dc-sidebar-todo-card.ts";
import { getEffectiveAgents, createAgentsCard, openSubagentsView } from "../src/features/dc-sidebar/components/dc-sidebar-agents-card.ts";

test("getEffectiveTodoTasks returns tasks and createTodoCard renders valid card", () => {
  const { tasks } = getEffectiveTodoTasks();
  assert.ok(Array.isArray(tasks));
  assert.ok(tasks.length >= 1);

  const card = createTodoCard();
  const lines = card.render(50);
  assert.ok(lines.length >= 5);
  // Contiene título con glifo
  assert.ok(lines.some((l) => l.includes("🧰") || l.includes("Todo")));
  // Contiene barra de progreso o porcentaje
  assert.ok(lines.some((l) => l.includes("Progreso") || l.includes("▰")));
});

test("getEffectiveAgents returns agents and createAgentsCard renders valid card with click support", () => {
  const { agents } = getEffectiveAgents();
  assert.ok(Array.isArray(agents));
  assert.ok(agents.length >= 1);

  let clicked = false;
  const card = createAgentsCard();
  // Sobrescribimos temporalmente onTitleClick para verificar el despacho
  (card as any).options.onTitleClick = () => { clicked = true; };

  const lines = card.render(50);
  assert.ok(lines.length >= 5);
  // Contiene título con glifo
  assert.ok(lines.some((l) => l.includes("👨‍💼") || l.includes("Subagents")));
  // Contiene nombres de agentes
  assert.ok(lines.some((l) => l.includes("gentle-ai-explore") || l.includes("ready")));

  // Simular clic en la barra de título (y = 1)
  const res = (card as any).handleMouse?.({ type: "click", button: "left", x: 10, y: 1 });
  assert.deepEqual(res, { handled: true });
  assert.equal(clicked, true);
});

test("openSubagentsView invokes shortcut handler or notifies gracefully", () => {
  let notified = false;
  const mockCtx = {
    ui: {
      notify: (msg: string) => {
        notified = true;
        assert.ok(msg.includes("Subagentes") || msg.includes("Alt+A"));
      },
    },
  } as any;

  openSubagentsView(mockCtx);
  assert.equal(notified, true);
});
