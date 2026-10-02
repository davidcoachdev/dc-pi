import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { DcNotifier } from "../src/integrations/dc-notify/dc-notifier.ts";
import dcNotifyExtension from "../src/integrations/dc-notify/dc-notifier.ts";
import { patchPiChangelogNotice } from "../src/integrations/dc-notify/dc-core-patches.ts";

test("DcNotifier detects Herdr presence from environment variables", () => {
  const originalSocket = process.env.HERDR_SOCKET_PATH;
  const originalEnv = process.env.HERDR_ENV;

  try {
    delete process.env.HERDR_SOCKET_PATH;
    delete process.env.HERDR_ENV;
    const notifier = new DcNotifier();
    assert.equal(notifier.isHerdrAvailable(), false);

    process.env.HERDR_ENV = "1";
    assert.equal(notifier.isHerdrAvailable(), true);

    delete process.env.HERDR_ENV;
    process.env.HERDR_SOCKET_PATH = "/tmp/herdr.sock";
    assert.equal(notifier.isHerdrAvailable(), true);
  } finally {
    if (originalSocket !== undefined) process.env.HERDR_SOCKET_PATH = originalSocket;
    else delete process.env.HERDR_SOCKET_PATH;
    if (originalEnv !== undefined) process.env.HERDR_ENV = originalEnv;
    else delete process.env.HERDR_ENV;
  }
});

test("DcNotifier falls back to ctx.ui.notify when Herdr is unavailable", () => {
  const originalSocket = process.env.HERDR_SOCKET_PATH;
  const originalEnv = process.env.HERDR_ENV;

  try {
    delete process.env.HERDR_SOCKET_PATH;
    delete process.env.HERDR_ENV;
    const notifier = new DcNotifier();

    const notifications: Array<{ text: string; type: string }> = [];
    const mockCtx = {
      ui: {
        notify(text: string, type: string) {
          notifications.push({ text, type });
        },
      },
    } as unknown as ExtensionCommandContext;

    // String overload
    const res1 = notifier.notify(mockCtx, "Hello", "World", "warning");
    assert.equal(res1, false);
    assert.deepEqual(notifications, [{ text: "Hello: World", type: "warning" }]);

    // Object payload overload
    const res2 = notifier.notify(mockCtx, { title: "Alert", body: "Something happened", type: "error" });
    assert.equal(res2, false);
    assert.deepEqual(notifications.at(-1), { text: "Alert: Something happened", type: "error" });
  } finally {
    if (originalSocket !== undefined) process.env.HERDR_SOCKET_PATH = originalSocket;
    else delete process.env.HERDR_SOCKET_PATH;
    if (originalEnv !== undefined) process.env.HERDR_ENV = originalEnv;
    else delete process.env.HERDR_ENV;
  }
});

test("dcNotifyExtension registers /dc-notify-test", () => {
  let registeredCommand: string | undefined;
  let commandHandler: Function | undefined;

  const mockPi = {
    on(_event: string, _fn: any) {},
    registerCommand(name: string, def: { handler: Function }) {
      registeredCommand = name;
      commandHandler = def.handler;
    },
  } as unknown as ExtensionAPI;

  dcNotifyExtension(mockPi);
  assert.equal(registeredCommand, "dc-notify-test");
  assert.ok(commandHandler);
});

test("patchPiChangelogNotice intercepts startup notices, captures notice and markdown without adding to chatContainer", () => {
  patchPiChangelogNotice();

  const G_CHANGELOG = Symbol.for("dc.env.changelog-notice");
  const G_CHANGELOG_MD = Symbol.for("dc.env.changelog-markdown");
  delete (globalThis as any)[G_CHANGELOG];
  delete (globalThis as any)[G_CHANGELOG_MD];

  const addedChildren: any[] = [];
  const fakeInteractiveHost: any = {
    startupNoticesShown: false,
    changelogMarkdown: "## [1.0.0]\n- Cambios importantes",
    version: "1.0.0",
    chatContainer: {
      children: [],
      addChild(child: any) {
        addedChildren.push(child);
      },
    },
  };

  // Obtenemos el método patcheado en el prototipo de InteractiveMode
  assert.ok(typeof (InteractiveMode as any).prototype.showStartupNoticesIfNeeded === "function");

  (InteractiveMode as any).prototype.showStartupNoticesIfNeeded.call(fakeInteractiveHost);

  // Verificamos que se haya marcado startupNoticesShown para no re-ejecutar en Pi
  assert.equal(fakeInteractiveHost.startupNoticesShown, true);

  // Verificamos que NO se haya ensuciado chatContainer con DynamicBorder ni Text
  assert.equal(addedChildren.length, 0);

  // Verificamos que se haya guardado el aviso y markdown en los símbolos globales
  assert.equal((globalThis as any)[G_CHANGELOG], "Updated to v1.0.0. Use /changelog to view full changelog.");
  assert.equal((globalThis as any)[G_CHANGELOG_MD], "## [1.0.0]\n- Cambios importantes");
});
