import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Key, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { parseGitBranchOutput, type EnvStatus } from "../src/features/dc-status/dc-status-collector.ts";
import { DcStatusPanel } from "../src/features/dc-status/dc-status-panel.ts";
import dcStatusExtension from "../src/features/dc-status/dc-status.ts";

const dummyTheme: Pick<Theme, "fg" | "bg" | "bold"> = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("parseGitBranchOutput parses git status porcelain branch and changes", () => {
  const outputClean = "## main...origin/main\n";
  assert.deepEqual(parseGitBranchOutput(outputClean), { branch: "main", status: "limpio" });

  const outputDirty = "## feat/dc-status\n M src/index.ts\n?? new.ts\n";
  assert.deepEqual(parseGitBranchOutput(outputDirty), { branch: "feat/dc-status", status: "2 cambio(s) pendiente(s)" });
});

test("DcStatusPanel renders environment info and toggles alerts tab", () => {
  const status: EnvStatus = {
    gitBranch: "main",
    gitStatus: "limpio",
    cwd: "/home/dc-studio/project",
    modelId: "cpam/ac01/gemini-3-flash",
    thinkingLevel: "medium",
    mcpServers: [],
    packages: ["dc-pi"],
    extensionsCount: 7,
    skillsCount: 15,
    customToolsCount: 22,
    sddPhasesCount: 4,
    alerts: ["Alerta de prueba 1", "Alerta de prueba 2"],
    version: "0.85.1",
    gentlePiVersion: "3.7.0",
  };

  let copied = false;
  const panel = new DcStatusPanel({
    theme: dummyTheme,
    status,
    onCopyAlerts: () => { copied = true; },
    requestRender: () => {},
  });

  const lines1 = panel.render(70);
  assert.ok(lines1.some((l) => l.includes("Directorio (CWD)")));
  assert.ok(lines1.some((l) => l.includes("main")));
  assert.ok(lines1.some((l) => l.includes("gemini-3-flash")));
  assert.ok(lines1.some((l) => l.includes("Versión gentle-pi")));
  assert.ok(lines1.some((l) => l.includes("v3.7.0")));
  assert.ok(lines1.some((l) => l.includes("[1] Información")));

  // Switch to alerts tab with '2'
  assert.equal(panel.getCurrentTab(), "info");
  panel.handleInput("2");
  assert.equal(panel.getCurrentTab(), "alerts");

  const lines2 = panel.render(70);
  assert.ok(lines2.some((l) => l.includes("Alerta de prueba 1")));
  assert.equal(panel.getCurrentAlertIndex(), 0);

  // Next alert slide with arrow down
  panel.handleInput(Key.down);
  assert.equal(panel.getCurrentAlertIndex(), 1);
  const lines3 = panel.render(70);
  assert.ok(lines3.some((l) => l.includes("Alerta de prueba 2")));

  // Previous alert slide with arrow up
  panel.handleInput(Key.up);
  assert.equal(panel.getCurrentAlertIndex(), 0);

  // Arrow left switches back to 'info' tab
  panel.handleInput(Key.left);
  assert.equal(panel.getCurrentTab(), "info");

  // Arrow right switches back to 'alerts' tab
  panel.handleInput(Key.right);
  assert.equal(panel.getCurrentTab(), "alerts");

  // 'c' triggers copy
  panel.handleInput("c");
  assert.equal(copied, true);

  // Mouse click on Tab 1
  panel.handleMouse({
    type: "click",
    button: "left",
    x: 5,
    y: 1,
  } as unknown as TuiMouseEvent);
  assert.equal(panel.getCurrentTab(), "info");
});

test("dcStatusExtension registers only /dc-status with Alt+E", () => {
  const registeredCommands: string[] = [];
  let registeredShortcut: string | undefined;

  const mockPi = {
    registerCommand(name: string) {
      registeredCommands.push(name);
    },
    registerShortcut(name: string) {
      registeredShortcut = name;
    },
  } as unknown as ExtensionAPI;

  dcStatusExtension(mockPi);
  assert.deepEqual(registeredCommands, ["dc-status"]);
  assert.equal(registeredShortcut, "alt+e");
});
