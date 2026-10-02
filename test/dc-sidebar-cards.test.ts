import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { getEffectiveTodoTasks, createTodoCard } from "../src/features/dc-sidebar/components/dc-sidebar-todo-card.ts";
import { getEffectiveAgents, createAgentsCard, openSubagentsView } from "../src/features/dc-sidebar/components/dc-sidebar-agents-card.ts";
import { createStatusCard } from "../src/features/dc-sidebar/components/dc-sidebar-status-card.ts";
import { getCachedAccountQuotas } from "../src/features/dc-sidebar/providers/dc-quota-provider.ts";

test("getEffectiveTodoTasks returns tasks and createTodoCard renders valid card", () => {
  const { tasks } = getEffectiveTodoTasks();
  assert.ok(Array.isArray(tasks));

  const card = createTodoCard();
  const lines = card.render(50);
  assert.ok(lines.length >= 4);
  // Contiene título con glifo
  assert.ok(lines.some((l) => l.includes("🧰") || l.includes("Todo")));
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
  // Contiene nombres de agentes o estado de tareas
  assert.ok(lines.some((l) => l.includes("gentle-ai-explore") || l.includes("ready") || l.includes("listo") || l.includes("activos")));

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

test("Status sidebar refreshes quota values on the same card instance", async () => {
  const originalFetch = globalThis.fetch;
  const originalExistsSync = fs.existsSync;
  const originalHomedir = os.homedir;
  const testHome = "/__dc-pi-sidebar-card-test-home__";
  os.homedir = () => testHome;
  const settingsPath = path.join(testHome, ".pi", "agent", "settings.json");
  fs.existsSync = ((filePath: fs.PathLike) => {
    if (String(filePath) === settingsPath) return false;
    return originalExistsSync(filePath);
  }) as typeof fs.existsSync;
  syncBuiltinESMExports();
  globalThis.fetch = (async (input: string | URL | Request) => {
    assert.match(String(input), /^http:\/\/127\.0\.0\.1:8325\/quota\//);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      text: async () => JSON.stringify({
        entries: [
          { label: "Five-hour", percentRemaining: 42, resetTimeIso: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
          { label: "Weekly", percentRemaining: 73, resetTimeIso: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
        ],
      }),
    } as unknown as Response;
  }) as typeof fetch;

  try {
    let onRefresh!: () => void;
    const refreshed = new Promise<void>((resolve) => {
      onRefresh = resolve;
    });
    const card = createStatusCard(() => onRefresh());
    const cardContent = (card as any).options.content;
    const quota = cardContent.children.find((child: any) => child.options?.title?.includes("Quota:"));
    assert.ok(quota, "Quota collapsible should be present");
    assert.match(quota.options.titleRight, /\[↗\]/);
    assert.equal(typeof quota.options.onTitleRightClick, "function");
    const providerList = quota.options.children[0];
    const firstProvider = providerList.children[0];
    assert.match(firstProvider.options.title, /ac06/);
    quota.expanded = true;
    firstProvider.expanded = true;

    card.render(120);
    const fallback = providerList.render(120).join("\n");
    assert.match(fallback, /100%/);
    assert.doesNotMatch(fallback, /left|used|reset/i);

    await refreshed;
    assert.equal(getCachedAccountQuotas()[0]?.entries[0]?.pctLeft, 42);
    card.render(120);
    const live = providerList.render(120).join("\n");
    assert.match(live, /42%/);
    assert.match(live, /73%/);
    assert.ok(live.indexOf("5h:") < live.indexOf("Sem:"), "quota windows should retain their order");
    assert.match(live, /▰/);
    assert.doesNotMatch(live, /left|used|reset/i);
    assert.equal(quota.expanded, true);
    assert.equal(firstProvider.expanded, true);
    assert.deepEqual(quota.handleMouse({ type: "click", button: "left", x: 5, y: 1 }), { handled: true });
    assert.equal(firstProvider.expanded, false);
    assert.deepEqual(quota.handleMouse({ type: "click", button: "left", x: 5, y: 1 }), { handled: true });
    assert.equal(firstProvider.expanded, true);

    quota.expanded = false;
    assert.match(card.render(120).join("\n"), /ac06-42%-73%/);

    providerList.update([
      {
        prefix: "ac06",
        family: "Claude",
        entries: [
          { label: "5h", pctLeft: 98, pctUsed: 2, resetStr: "" },
          { label: "Sem", pctLeft: 74, pctUsed: 26, resetStr: "" },
          { label: "Monthly", pctLeft: 64, pctUsed: 36, resetStr: "" },
        ],
        collapsedSummary: "ac06-98%-74%-64%",
      },
    ]);
    firstProvider.expanded = false;
    const collapsedRestante = providerList.render(120).filter((l: string) => l.includes("Restante")).join("\n");
    assert.match(collapsedRestante, /Restante/);
    assert.match(collapsedRestante, /98%\/74%\/64%/);
    assert.doesNotMatch(collapsedRestante, /sem/i);

    providerList.update([
      {
        prefix: "ac06",
        family: "Claude",
        entries: [
          { label: "5h", pctLeft: 98, pctUsed: 2, resetStr: "" },
          { label: "Sem", pctLeft: 74, pctUsed: 26, resetStr: "" },
        ],
        collapsedSummary: "ac06-98%-74%",
      },
    ]);
    const collapsedWithoutMonthly = providerList.render(120).filter((l: string) => l.includes("Restante")).join("\n");
    assert.match(collapsedWithoutMonthly, /Restante/);
    assert.match(collapsedWithoutMonthly, /98%\/74%/);
    assert.doesNotMatch(collapsedWithoutMonthly, /sem/i);

    providerList.update([
      {
        prefix: "ac07",
        family: "Gemini",
        entries: [
          { label: "5h", pctLeft: 1, pctUsed: 99, resetStr: "" },
          { label: "Sem", pctLeft: 2, pctUsed: 98, resetStr: "" },
          { label: "5h", pctLeft: 3, pctUsed: 97, resetStr: "" },
          { label: "Sem", pctLeft: 4, pctUsed: 96, resetStr: "" },
        ],
        collapsedSummary: "ac07-1%-2%-3%-4%",
      },
    ]);
    providerList.children[0].expanded = false;
    const collapsedFourEntries = providerList.render(120).filter((l: string) => l.includes("Restante")).join("\n");
    assert.match(collapsedFourEntries, /Restante/);
    assert.match(collapsedFourEntries, /1%\/2%\/3%\/4%/);
    assert.doesNotMatch(collapsedFourEntries, /sem/i);

    providerList.update([
      {
        prefix: "ac08",
        family: "Empty",
        entries: [],
        collapsedSummary: "ac08-100%",
      },
    ]);
    providerList.children[0].expanded = false;
    const collapsedEmptyEntries = providerList.render(120).filter((l: string) => l.includes("Restante")).join("\n");
    assert.match(collapsedEmptyEntries, /Restante/);
    assert.match(collapsedEmptyEntries, /100%/);
  } finally {
    globalThis.fetch = originalFetch;
    fs.existsSync = originalExistsSync;
    os.homedir = originalHomedir;
    syncBuiltinESMExports();
  }
});
