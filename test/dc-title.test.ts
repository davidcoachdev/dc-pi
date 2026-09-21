import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  isHerdr,
  isTmux,
  renameTab,
} from "../src/features/dc-title/dc-title-renamer.ts";
import dcTitleExtension from "../src/features/dc-title/dc-title.ts";

test("isHerdr and isTmux detect environment correctly", () => {
  assert.equal(isHerdr({}), false);
  assert.equal(isHerdr({ HERDR_ENV: "1" }), true);
  assert.equal(isHerdr({ HERDR_PANE_ID: "pane-123" }), true);

  assert.equal(isTmux({}), false);
  assert.equal(isTmux({ TMUX: "/tmp/tmux-1000/default,1234,0" }), true);
});

test("renameTab emits OSC 0 sequence to terminal", () => {
  let emittedOsc = "";
  const res = renameTab("My-Project", {
    env: {},
    writeOscFn: (str) => {
      emittedOsc += str;
    },
  });

  assert.equal(res.osc, true);
  assert.equal(res.tmux, false);
  assert.equal(res.herdr, false);
  assert.equal(emittedOsc, "\x1b]0;My-Project\x07");
});

test("renameTab calls herdr when HERDR_TAB_ID is present", () => {
  const executed: Array<{ cmd: string; args: string[] }> = [];
  const res = renameTab("Workspace", {
    env: { HERDR_ENV: "1", HERDR_TAB_ID: "tab-99" },
    execFn: (cmd, args) => {
      executed.push({ cmd, args });
    },
    writeOscFn: () => {},
  });

  assert.equal(res.herdr, true);
  assert.equal(executed.length, 1);
  assert.equal(executed[0].cmd, "herdr");
  assert.deepEqual(executed[0].args, ["tab", "rename", "tab-99", "Workspace"]);
});

test("renameTab calls tmux when TMUX is present", () => {
  const executed: Array<{ cmd: string; args: string[] }> = [];
  const res = renameTab("Editor", {
    env: { TMUX: "1", TMUX_PANE: "%5" },
    execFn: (cmd, args) => {
      executed.push({ cmd, args });
    },
    writeOscFn: () => {},
  });

  assert.equal(res.tmux, true);
  assert.equal(executed.length, 1);
  assert.equal(executed[0].cmd, "tmux");
  assert.deepEqual(executed[0].args, ["rename-window", "-t", "%5", "Editor"]);
});

test("dcTitleExtension registers only single command /dc-title and session_start", async () => {
  const commands = new Map<string, { description?: string; handler: Function }>();
  const events = new Map<string, Function>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    on(event: string, handler: Function) {
      events.set(event, handler);
    },
  } as unknown as ExtensionAPI;

  dcTitleExtension(mockPi, { writeOscFn: () => {} });

  assert.equal(commands.size, 1);
  assert.ok(commands.has("dc-title"));
  assert.ok(events.has("session_start"));

  let notified = "";
  const mockCtx = {
    hasUI: true,
    ui: {
      notify(msg: string) {
        notified = msg;
      },
    },
  } as unknown as ExtensionContext;

  const handler = commands.get("dc-title")!.handler;
  await handler("Coding", mockCtx);
  assert.ok(notified.includes('Tab renamed to "Coding"'));
});
