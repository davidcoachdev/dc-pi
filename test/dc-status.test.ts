import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Key, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { parseGitBranchOutput, parseRecentChangelogEntries, type EnvStatus } from "../src/features/dc-status/dc-status-collector.ts";
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

test("DcStatusPanel renders [3] Changelog tab with notice banner and content", () => {
  const status: EnvStatus = {
    gitBranch: "main",
    gitStatus: "limpio",
    cwd: "/home/dc-studio/project",
    modelId: "cpam/ac01/gemini-3-flash",
    mcpServers: [],
    packages: ["dc-pi"],
    extensionsCount: 7,
    skillsCount: 15,
    customToolsCount: 22,
    sddPhasesCount: 4,
    alerts: [],
    version: "1.0.0",
    gentlePiVersion: "3.7.0",
    changelogNotice: "Updated to v1.0.0. Use /changelog to view full changelog.",
    changelogMarkdown: "## [1.0.0]\n### Features\n- Nueva funcionalidad asombrosa\n- Mejoras en la interfaz",
  };

  const panel = new DcStatusPanel({
    theme: dummyTheme,
    status,
    requestRender: () => {},
  });

  // Render tab 1 (Info) includes the 3 tabs in header
  const linesInfo = panel.render(80);
  assert.ok(linesInfo.some((l) => l.includes("[1] Información")));
  assert.ok(linesInfo.some((l) => l.includes("[2] Alertas")));
  assert.ok(linesInfo.some((l) => l.includes("[3] Changelog")));
  assert.ok(linesInfo.some((l) => l.includes("Nuevo"))); // Badge de notice

  // Switch to changelog with '3'
  panel.handleInput("3");
  assert.equal(panel.getCurrentTab(), "changelog");

  const linesChangelog = panel.render(80);
  // Must render update notification banner with exact notice text
  assert.ok(linesChangelog.some((l) => l.includes("NOTIFICACIÓN DE ACTUALIZACIÓN")));
  assert.ok(linesChangelog.some((l) => l.includes("Updated to v1.0.0. Use /changelog to view full changelog.")));
  // Must render parsed changelog markdown entries
  assert.ok(linesChangelog.some((l) => l.includes("1.0.0")));
  assert.ok(linesChangelog.some((l) => l.includes("Features")));
  assert.ok(linesChangelog.some((l) => l.includes("Nueva funcionalidad asombrosa")));

  // Test circular navigation: right from changelog goes to info
  panel.handleInput(Key.right);
  assert.equal(panel.getCurrentTab(), "info");

  // Left from info goes to changelog
  panel.handleInput(Key.left);
  assert.equal(panel.getCurrentTab(), "changelog");

  // Left from changelog goes to alerts
  panel.handleInput(Key.left);
  assert.equal(panel.getCurrentTab(), "alerts");
});

test("DcStatusPanel renders clean up-to-date message when no changelog is available", () => {
  const status: EnvStatus = {
    gitBranch: "main",
    gitStatus: "limpio",
    cwd: "/home/dc-studio/project",
    mcpServers: [],
    packages: ["dc-pi"],
    extensionsCount: 7,
    skillsCount: 0,
    customToolsCount: 0,
    sddPhasesCount: 0,
    alerts: [],
    version: "0.99.1",
  };

  const panel = new DcStatusPanel({
    theme: dummyTheme,
    status,
    requestRender: () => {},
  });

  panel.setTab("changelog");
  const lines = panel.render(80);
  assert.ok(lines.some((l) => l.includes("El entorno está al día")));
  assert.ok(lines.some((l) => l.includes("Versión activa de Pi: v0.99.1")));
});

test("parseRecentChangelogEntries extracts up to N release notes", () => {
  const sampleMd = `
# Changelog

## [1.0.0] - 2026-10-01
- Feature A
- Feature B

## [0.9.0] - 2026-09-15
- Feature C

## [0.8.0] - 2026-09-01
- Feature D

## [0.7.0] - 2026-08-15
- Ancient Feature
`;

  const parsed = parseRecentChangelogEntries(sampleMd, 2);
  assert.ok(parsed.includes("## [1.0.0]"));
  assert.ok(parsed.includes("## [0.9.0]"));
  assert.ok(!parsed.includes("## [0.8.0]"));
  assert.ok(!parsed.includes("## [0.7.0]"));
});
