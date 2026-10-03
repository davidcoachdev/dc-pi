import test from "node:test";
import assert from "node:assert/strict";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { Spacer } from "@earendil-works/pi-tui";
import {
  G_DIAGNOSTICS,
  extractChildText,
  isChildSpacer,
  isDiagnosticBlock,
  isDiagnosticWarningOrError,
  recordDiagnostic,
  patchPiLoadedResources,
} from "../src/integrations/dc-notify/dc-resources-patch.ts";
import { DcStatusPanel } from "../src/features/dc-status/dc-status-panel.ts";
import type { EnvStatus } from "../src/features/dc-status/dc-status-collector.ts";

test("extractChildText handles ThemedText with build(), static text, and render()", () => {
  // Mock ThemedText
  const themedText = {
    text: "",
    build: () => "\x1b[33m[Extension issues]\x1b[39m\n  builtin:mcp",
  };
  assert.equal(extractChildText(themedText), "\x1b[33m[Extension issues]\x1b[39m\n  builtin:mcp");

  // Static text component
  const staticText = { text: "Hello static" };
  assert.equal(extractChildText(staticText), "Hello static");

  // getText component
  const getTextComp = { getText: () => "From getText" };
  assert.equal(extractChildText(getTextComp), "From getText");

  // render fallback
  const renderComp = { render: (_w: number) => ["Line 1", "Line 2"] };
  assert.equal(extractChildText(renderComp), "Line 1\nLine 2");
});

test("isChildSpacer and isDiagnosticBlock identify elements correctly", () => {
  const spacer = new Spacer(1);
  assert.equal(isChildSpacer(spacer), true);
  assert.equal(isChildSpacer({ lines: 2 }), true);
  assert.equal(isChildSpacer({ text: "not a spacer" }), false);

  assert.equal(isDiagnosticBlock("[Extension issues]\n  builtin:mcp"), true);
  assert.equal(isDiagnosticBlock("  [Skill conflicts]\n  skill-a"), true);
  assert.equal(isDiagnosticBlock("[Extensions]\n  dc-pi"), false);
});

test("isDiagnosticWarningOrError classifies extension issues and ignores user prompt warnings", () => {
  assert.equal(
    isDiagnosticWarningOrError(
      'Extension package "builtin:mcp": Extension /path/index.ts registers command `/mcp`, so built-in extension `mcp` was not loaded.',
    ),
    true,
  );
  assert.equal(isDiagnosticWarningOrError("Failed to load extension '/bad/path': syntax error"), true);
  assert.equal(isDiagnosticWarningOrError("Warning: No models available"), true);
  assert.equal(isDiagnosticWarningOrError("Skill conflicts detected in workspace"), true);

  // Operational hints should NOT be suppressed
  assert.equal(isDiagnosticWarningOrError("A bash command is already running. Press Esc to cancel it first."), false);
  assert.equal(isDiagnosticWarningOrError("Usage: /name <name>"), false);
});

test("recordDiagnostic stores and deduplicates structured vs flat extension warnings", () => {
  const diagnosticsList: string[] = ((globalThis as unknown as Record<symbol, string[]>)[G_DIAGNOSTICS] ??= []);
  diagnosticsList.length = 0;

  const flatWarning =
    'Extension package "builtin:mcp": Extension /home/dc-studio/mcp-adapter/index.ts registers command `/mcp`, so built-in extension `mcp` was not loaded. To use `mcp`, run `pi config`.';
  const structuredBlock =
    "[Extension issues]\n  builtin:mcp\n    Extension /home/dc-studio/mcp-adapter/index.ts registers command `/mcp`, so built-in extension `mcp` was not loaded. To use `mcp`, run `pi config`.";

  // Scenario 1: Flat warning arrives first, then structured block upgrades it
  recordDiagnostic(flatWarning);
  assert.equal(diagnosticsList.length, 1);
  assert.ok(diagnosticsList[0]?.includes('Extension package "builtin:mcp"'));

  recordDiagnostic(structuredBlock);
  assert.equal(diagnosticsList.length, 1);
  assert.equal(diagnosticsList[0], structuredBlock);

  // Scenario 2: Redundant flat warning arrives after structured block -> ignored
  recordDiagnostic(flatWarning);
  assert.equal(diagnosticsList.length, 1);
  assert.equal(diagnosticsList[0], structuredBlock);

  // Distinct diagnostic is preserved
  recordDiagnostic("No models available in configuration");
  assert.equal(diagnosticsList.length, 2);
  assert.equal(diagnosticsList[1], "No models available in configuration");
});

test("patchPiLoadedResources intercepts showLoadedResources and removes diagnostic children and Spacers", () => {
  patchPiLoadedResources();

  const diagnosticsList: string[] = ((globalThis as unknown as Record<symbol, string[]>)[G_DIAGNOSTICS] ??= []);
  diagnosticsList.length = 0;

  const structuredIssue = {
    build: () =>
      "\x1b[33m[Extension issues]\x1b[39m\n  builtin:mcp\n    Extension /home/dc-studio/adapter.ts registers command `/mcp`, so built-in extension was not loaded.",
  };
  const spacer1 = new Spacer(1);
  const normalSection = {
    text: "Normal Content Section",
  };

  const fakeInteractiveHost: any = {
    loadedResourcesContainer: {
      children: [structuredIssue, spacer1, normalSection],
      clear() {},
    },
  };

  const proto = (InteractiveMode as any).prototype;
  proto.showLoadedResources.call(fakeInteractiveHost);

  // El hijo con [Extension issues] y su Spacer asociado deben haber sido eliminados
  assert.equal(fakeInteractiveHost.loadedResourcesContainer.children.length, 1);
  assert.equal(fakeInteractiveHost.loadedResourcesContainer.children[0], normalSection);

  // Y registrado en G_DIAGNOSTICS
  assert.equal(diagnosticsList.length, 1);
  assert.ok(diagnosticsList[0]?.startsWith("[Extension issues]"));
});

test("patchPiLoadedResources intercepts showWarning, showError and showExtensionError without polluting chatContainer", () => {
  patchPiLoadedResources();

  const diagnosticsList: string[] = ((globalThis as unknown as Record<symbol, string[]>)[G_DIAGNOSTICS] ??= []);
  diagnosticsList.length = 0;

  const addedChildren: any[] = [];
  const fakeInteractiveHost: any = {
    chatContainer: {
      addChild(child: any) {
        addedChildren.push(child);
      },
    },
    ui: {
      requestRender() {},
    },
  };

  const proto = (InteractiveMode as any).prototype;

  // 1. showWarning with extension conflict
  proto.showWarning.call(
    fakeInteractiveHost,
    'Extension package "builtin:mcp": Extension /path/to/adapter.ts registers command `/mcp`, so built-in extension was not loaded.',
  );
  assert.equal(addedChildren.length, 0); // Silenced from body
  assert.equal(diagnosticsList.length, 1);

  // 2. showError with extension failure
  proto.showError.call(fakeInteractiveHost, "Failed to load extension '/bad/plugin': module not found");
  assert.equal(addedChildren.length, 0); // Silenced from body
  assert.equal(diagnosticsList.length, 2);

  // 3. showExtensionError
  proto.showExtensionError.call(fakeInteractiveHost, "/crash/plugin.ts", new Error("Unexpected crash"), "Error: at line 42");
  assert.equal(addedChildren.length, 0); // Silenced from body
  assert.equal(diagnosticsList.length, 3);
  assert.ok(diagnosticsList[2]?.includes("crash/plugin.ts"));
});

test("DcStatusPanel formats [Extension issues] without breaking sentences on commas in Alertas tab", () => {
  const status: EnvStatus = {
    gitBranch: "main",
    gitStatus: "limpio",
    cwd: "/home/dc-studio/project",
    mcpServers: [],
    packages: ["dc-pi"],
    extensionsCount: 7,
    skillsCount: 15,
    customToolsCount: 22,
    sddPhasesCount: 4,
    alerts: [
      "[Extension issues]\n  builtin:mcp\n    Extension /home/dc-studio/.pi/agent/npm/node_modules/pi-mcp-adapter/index.ts registers command `/mcp`, so built-in extension `mcp` was not loaded. To use `mcp`, run `pi config` and make sure it is enabled under Built-in extensions, then disable or remove the existing extension. We recommend only having one or the other loaded at a time.",
    ],
    version: "0.85.1",
  };

  const dummyTheme: any = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };

  const panel = new DcStatusPanel({
    theme: dummyTheme,
    status,
    requestRender: () => {},
  });

  // Switch to alerts tab
  panel.handleInput("2");
  const renderedLines = panel.render(80);

  // Debe contener la cabecera estructurada y el identificador de paquete
  assert.ok(renderedLines.some((l) => l.includes("[Extension issues]")));
  assert.ok(renderedLines.some((l) => l.includes("builtin:mcp")));

  // No debe haber fragmentado las oraciones con viñetas artificiales ("• so built-in extension")
  assert.equal(renderedLines.some((l) => l.includes("• so built-in extension")), false);
  assert.equal(renderedLines.some((l) => l.includes("• run pi config")), false);

  // Debe contener la oración completa o envuelta
  assert.ok(renderedLines.some((l) => l.includes("registers command `/mcp`")));
});
