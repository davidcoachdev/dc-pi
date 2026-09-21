import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import dcReloadExtension, {
  RELOAD_BODY,
  triggerReload,
} from "../src/features/dc-reload/dc-reload.ts";

test("triggerReload executes ctx.reload and notifies", async () => {
  let reloadCalled = false;
  let notifiedMsg = "";

  const mockCtx = {
    hasUI: true,
    reload: async () => {
      reloadCalled = true;
    },
    ui: {
      notify(msg: string) {
        notifiedMsg = msg;
      },
    },
  } as unknown as ExtensionContext;

  const res = await triggerReload(mockCtx);
  assert.equal(res, true);
  assert.equal(reloadCalled, true);
  assert.ok(notifiedMsg.includes("Recargando entorno"));
});

test("triggerReload gracefully handles context without reload capability or interactive mode", async () => {
  let notifiedMsg = "";

  // Asegurar que no hay mock global de InteractiveMode interfiriendo
  const prev = (globalThis as any)[Symbol.for("dc.interactive-mode")];
  delete (globalThis as any)[Symbol.for("dc.interactive-mode")];

  const mockCtx = {
    hasUI: true,
    ui: {
      notify(msg: string) {
        notifiedMsg = msg;
      },
    },
  } as unknown as ExtensionContext;

  try {
    const res = await triggerReload(mockCtx);
    assert.equal(res, false);
    assert.ok(notifiedMsg.includes("/reload"));
  } finally {
    if (prev) (globalThis as any)[Symbol.for("dc.interactive-mode")] = prev;
  }
});

test("triggerReload executes via captured InteractiveMode when called from shortcut without ctx.reload", async () => {
  let handleReloadCalled = false;
  let notifiedMsg = "";

  (globalThis as any)[Symbol.for("dc.interactive-mode")] = {
    handleReloadCommand: async () => {
      handleReloadCalled = true;
    },
  };

  const mockCtx = {
    hasUI: true,
    ui: {
      notify(msg: string) {
        notifiedMsg = msg;
      },
    },
  } as unknown as ExtensionContext;

  try {
    const res = await triggerReload(mockCtx);
    assert.equal(res, true);
    assert.equal(handleReloadCalled, true);
    assert.ok(notifiedMsg.includes("Recargando entorno"));
  } finally {
    delete (globalThis as any)[Symbol.for("dc.interactive-mode")];
  }
});

test("dcReloadExtension registers strictly F5 shortcut and single /dc-reload command", async () => {
  const commands = new Map<string, { description?: string; handler: Function }>();
  const shortcuts = new Map<string, { description?: string; handler: Function }>();
  const events = new Map<string, Function>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerShortcut(key: string, def: any) {
      shortcuts.set(key, def);
    },
    on(event: string, handler: Function) {
      events.set(event, handler);
    },
  } as unknown as ExtensionAPI;

  let herdrTitle = "";
  let herdrBody: string | undefined;

  dcReloadExtension(mockPi, {
    notifier: {
      notifyHerdr: (title, body) => {
        herdrTitle = title;
        herdrBody = body;
        return false; // simulate fallback to ctx.ui.notify
      },
    },
  });

  // Exactly single command and single shortcut
  assert.equal(commands.size, 1);
  assert.ok(commands.has("dc-reload"));
  assert.equal(shortcuts.size, 1);
  assert.ok(shortcuts.has("f5"));
  assert.ok(events.has("session_start"));

  // Trigger session_start with reason 'reload'
  let reloadNotified = "";
  const mockCtx = {
    hasUI: true,
    ui: {
      notify(msg: string) {
        reloadNotified = msg;
      },
    },
  } as unknown as ExtensionContext;

  // 1. Reason: startup -> should NOT notify reload
  events.get("session_start")!({ reason: "startup" }, mockCtx);
  assert.equal(reloadNotified, "");

  // 2. Reason: reload -> notifies Herdr and fallback
  events.get("session_start")!({ reason: "reload" }, mockCtx);
  assert.ok(herdrTitle.includes("reload"));
  assert.equal(reloadNotified, RELOAD_BODY);
});
