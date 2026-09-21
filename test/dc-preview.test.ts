import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import {
  parseToolArg,
  parseOrientationArg,
  buildFishToolCommand,
  launchPanel,
} from "../src/features/dc-preview/dc-preview-launcher.ts";
import { DcPreviewSelectPanel } from "../src/features/dc-preview/dc-preview-panel.ts";
import dcPreviewExtension from "../src/features/dc-preview/dc-preview.ts";

const dummyTheme: Pick<Theme, "fg" | "bg" | "bold"> = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("parseToolArg and parseOrientationArg parse arguments accurately", () => {
  assert.equal(parseToolArg("nvim"), "nvim");
  assert.equal(parseToolArg("vim"), "nvim");
  assert.equal(parseToolArg("fzf"), "fzf");
  assert.equal(parseToolArg("yazi"), "yazi");
  assert.equal(parseToolArg("manager"), "manager");
  assert.equal(parseToolArg("task-manager"), "manager");
  assert.equal(parseToolArg("dc"), "dc-studio");
  assert.equal(parseToolArg("dc-studio"), "dc-studio");
  assert.equal(parseToolArg("unknown"), undefined);
  assert.equal(parseToolArg(undefined), undefined);

  assert.equal(parseOrientationArg("h"), "h");
  assert.equal(parseOrientationArg("right"), "h");
  assert.equal(parseOrientationArg("derecha"), "h");
  assert.equal(parseOrientationArg("v"), "v");
  assert.equal(parseOrientationArg("down"), "v");
  assert.equal(parseOrientationArg("abajo"), "v");
  assert.equal(parseOrientationArg("other"), undefined);
  assert.equal(parseOrientationArg(undefined), undefined);
});

test("buildFishToolCommand returns appropriate commands", () => {
  assert.equal(buildFishToolCommand("nvim", "h"), "nvim .");
  assert.equal(buildFishToolCommand("yazi", "v"), "yazi .");
  assert.equal(buildFishToolCommand("dc-studio", "h"), "dc");
  assert.ok(buildFishToolCommand("fzf", "h").includes("fzf --height=100%"));
  assert.ok(buildFishToolCommand("fzf", "v").includes("fzf --layout=reverse"));
});

test("launchPanel handles non-multiplexer, Tmux, and Herdr environments", () => {
  // 1. None
  const noneRes = launchPanel("nvim", "h", "/tmp", { env: {} });
  assert.equal(noneRes.success, false);
  assert.equal(noneRes.target, "none");
  assert.ok(noneRes.message.includes("No estás en tmux ni herdr"));

  // 2. Tmux
  const tmuxExecuted: Array<{ cmd: string; args: string[] }> = [];
  const tmuxRes = launchPanel("yazi", "v", "/my/project", {
    env: { TMUX: "1" },
    execFn: (cmd, args) => {
      tmuxExecuted.push({ cmd, args });
    },
  });

  assert.equal(tmuxRes.success, true);
  assert.equal(tmuxRes.target, "tmux");
  assert.ok(tmuxRes.message.includes("yazi → panel abajo (40%)"));
  assert.ok(tmuxExecuted.some((e) => e.cmd === "tmux" && e.args.includes("-v") && e.args.includes("yazi .")));

  // 3. Herdr
  const herdrExecuted: Array<{ cmd: string; args: string[] }> = [];
  const herdrRes = launchPanel("nvim", "h", "/my/project", {
    env: { HERDR_ENV: "1", HERDR_PANE_ID: "pane-root" },
    execFn: (cmd, args) => {
      herdrExecuted.push({ cmd, args });
      if (cmd === "herdr" && args[0] === "pane" && args[1] === "split") {
        return JSON.stringify({ result: { pane: { pane_id: "pane-new-42" } } });
      }
      return "";
    },
  });

  assert.equal(herdrRes.success, true);
  assert.equal(herdrRes.target, "herdr");
  assert.ok(herdrRes.message.includes("nvim → panel derecha (40%)"));
  assert.ok(herdrExecuted.some((e) => e.cmd === "herdr" && e.args.includes("pane-new-42") && e.args.includes("nvim .")));
});

test("DcPreviewSelectPanel handles navigation, mouse and selection", () => {
  const items = [
    { value: "opt1", label: "Option 1" },
    { value: "opt2", label: "Option 2" },
  ];

  let selected: string | undefined;
  let cancelled = false;
  let renders = 0;

  const panel = new DcPreviewSelectPanel(
    items,
    dummyTheme as Theme,
    (val) => {
      selected = val;
    },
    () => {
      cancelled = true;
    },
    () => {
      renders++;
    },
  );

  const lines = panel.render(40);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("Option 1"));

  // Navigate down
  panel.handleInput("\x1b[B");
  assert.equal(panel.getSelectedIndex(), 1);

  // Submit
  panel.handleInput("\r");
  assert.equal(selected, "opt2");

  // Cancel
  panel.handleInput("\x1b");
  assert.equal(cancelled, true);

  // Mouse wheel up -> moves selection back
  panel.handleMouse({ type: "wheel", wheelDelta: -1 } as any);
  assert.equal(panel.getSelectedIndex(), 0);
});

test("dcPreviewExtension registers only single command /dc-preview and Alt+Shift+V", async () => {
  const commands = new Map<string, { description?: string; handler: Function }>();
  let registeredShortcut: string | undefined;

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerShortcut(key: string) {
      registeredShortcut = key;
    },
  } as unknown as ExtensionAPI;

  const executed: Array<{ cmd: string; args: string[] }> = [];
  dcPreviewExtension(mockPi, {
    env: { TMUX: "1" },
    execFn: (cmd, args) => {
      executed.push({ cmd, args });
    },
  });

  assert.equal(commands.size, 1);
  assert.ok(commands.has("dc-preview"));
  assert.equal(registeredShortcut, "alt+shift+v");

  let notification = "";
  const mockCtx = {
    hasUI: true,
    cwd: "/work/repo",
    ui: {
      notify(msg: string) {
        notification = msg;
      },
    },
  } as unknown as ExtensionContext;

  const handler = commands.get("dc-preview")!.handler;
  await handler("yazi h", mockCtx);

  assert.ok(notification.includes("yazi → panel derecha (40%)"));
  assert.ok(executed.some((e) => e.cmd === "tmux" && e.args.includes("-h")));
});
