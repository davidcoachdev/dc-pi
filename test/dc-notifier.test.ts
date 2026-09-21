import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DcNotifier } from "../src/integrations/dc-notify/dc-notifier.ts";
import dcNotifyExtension from "../src/integrations/dc-notify/dc-notifier.ts";

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
    registerCommand(name: string, def: { handler: Function }) {
      registeredCommand = name;
      commandHandler = def.handler;
    },
  } as unknown as ExtensionAPI;

  dcNotifyExtension(mockPi);
  assert.equal(registeredCommand, "dc-notify-test");
  assert.ok(commandHandler);
});
