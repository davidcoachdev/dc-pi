import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import dcStudioExtension, {
  dcStudioExtension as dcStudioExtensionNamed,
  DcWindow,
  openDcModal,
  AgentVisualStateStore,
  dcClipboard,
  fetchJson,
  DcHttpError,
  DcHttpTimeoutError,
  CliProxyClient,
  DcNotifier,
  notifyHerdr,
  getGitChanges,
  parseGitStatus,
  caritasExtension,
  profileDuelExtension,
  dcKeysExtension,
  dcChangesExtension,
  dcModelsExtension,
  dcQuotaExtension,
  dcStatusExtension,
  dcBannerExtension,
  dcUserExtension,
  dcTitleExtension,
  dcExitExtension,
  dcPreviewExtension,
  dcDoctorExtension,
  dcFaceAnimExtension,
  dcReloadExtension,
  dcToolBoxExtension,
  dcUserBoxExtension,
  dcMarkdownExtension,
  dcSidebarExtension,
  dcPromptExtension,
  dcDialogsExtension,
  dcStateMonitorExtension,
} from "../src/index.ts";

test("src/index.ts exports all public primitives, classes, and helpers", () => {
  // UI primitives
  assert.equal(typeof DcWindow, "function");
  assert.equal(typeof openDcModal, "function");

  // Core state
  assert.equal(typeof AgentVisualStateStore, "function");

  // Integrations
  assert.equal(typeof dcClipboard, "object");
  assert.equal(typeof fetchJson, "function");
  assert.equal(typeof DcHttpError, "function");
  assert.equal(typeof DcHttpTimeoutError, "function");
  assert.equal(typeof CliProxyClient, "function");
  assert.equal(typeof DcNotifier, "function");
  assert.equal(typeof notifyHerdr, "function");
  assert.equal(typeof getGitChanges, "function");
  assert.equal(typeof parseGitStatus, "function");

  // Feature extensions
  assert.equal(typeof caritasExtension, "function");
  assert.equal(typeof profileDuelExtension, "function");
  assert.equal(typeof dcKeysExtension, "function");
  assert.equal(typeof dcChangesExtension, "function");
  assert.equal(typeof dcModelsExtension, "function");
  assert.equal(typeof dcQuotaExtension, "function");
  assert.equal(typeof dcStatusExtension, "function");
  assert.equal(typeof dcBannerExtension, "function");
  assert.equal(typeof dcUserExtension, "function");
  assert.equal(typeof dcTitleExtension, "function");
  assert.equal(typeof dcExitExtension, "function");
  assert.equal(typeof dcPreviewExtension, "function");
  assert.equal(typeof dcDoctorExtension, "function");
  assert.equal(typeof dcFaceAnimExtension, "function");
  assert.equal(typeof dcReloadExtension, "function");
  assert.equal(typeof dcToolBoxExtension, "function");
  assert.equal(typeof dcUserBoxExtension, "function");
  assert.equal(typeof dcMarkdownExtension, "function");
  assert.equal(typeof dcSidebarExtension, "function");
  assert.equal(typeof dcPromptExtension, "function");
  assert.equal(typeof dcDialogsExtension, "function");
  assert.equal(typeof dcStateMonitorExtension, "function");

  // Default and named unified extension
  assert.equal(typeof dcStudioExtension, "function");
  assert.equal(dcStudioExtension, dcStudioExtensionNamed);
});

test("dcStudioExtension registers all canonical commands and keybindings", () => {
  const commands = new Map<string, { description?: string; handler: Function }>();
  const shortcuts = new Map<string, { description?: string; handler: Function }>();
  const events = new Map<string, Function[]>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerShortcut(shortcut: string, def: any) {
      shortcuts.set(shortcut.toLowerCase(), def);
    },
    registerTool(_tool: any) {
      // Mock tool registration
    },
    on(event: string, fn: Function) {
      if (!events.has(event)) events.set(event, []);
      events.get(event)!.push(fn);
    },
    getThinkingLevel: () => "high",
  } as unknown as ExtensionAPI;

  const mockCtx = {
    hasUI: true,
    cwd: process.cwd(),
    ui: {
      notify: () => {},
      setWidget: () => {},
    },
  } as unknown as ExtensionContext;

  dcStudioExtension(mockPi, mockCtx);

  // Canonical commands specified in requirement
  const expectedCanonicalCommands = [
    "dc-caritas",
    "dc-models",
    "dc-quota",
    "dc-keys",
    "dc-changes",
    "dc-status",
    "dc-banner",
    "dc-user",
    "dc-title",
    "dc-preview",
    "dc-doctor",
    "dc-face",
    "dc-reload",
    "dc-tool-box",
    "dc-user-box",
    "dc-markdown",
    "dc-sidebar",
    "dc-prompt",
    "dc-dialogs",
    "dc-state-test",
  ];

  for (const cmd of expectedCanonicalCommands) {
    assert.ok(
      commands.has(cmd),
      `Expected canonical command '/${cmd}' to be registered, but it was not. Registered: ${Array.from(commands.keys()).join(", ")}`,
    );
  }

  // Profile duel command check
  assert.ok(commands.has("dc-faces"), "Expected /dc-faces to be registered by profileDuelExtension");

  // Essential shortcuts registered
  assert.ok(shortcuts.has("f5"), "Expected F5 shortcut for reload");
  assert.ok(shortcuts.has("alt+m"), "Expected Alt+M shortcut for models");
  assert.ok(shortcuts.has("alt+f"), "Expected Alt+F shortcut for changes");
  assert.ok(shortcuts.has("alt+e"), "Expected Alt+E shortcut for status");
  assert.ok(shortcuts.has("alt+c"), "Expected Alt+C shortcut for faces");
  assert.ok(shortcuts.has("alt+shift+b"), "Expected Alt+Shift+B shortcut for sidebar");
});
