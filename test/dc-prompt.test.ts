import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  cell,
  COLOR_CTX_HIGH,
  COLOR_CTX_MEDIUM,
  COLOR_CTX_OPTIMAL,
  DC_PROMPT,
  formatContextSize,
  formatCost,
  FRAMES,
  getContextColor,
  KITT_LEVELS,
  KITT_SPEED,
  KITT_WIDTH,
  NEON_PULSE_FRAMES,
  paintGauge,
  redToBlack,
  redToPink,
  sessionCost,
} from "../src/features/dc-prompt/dc-prompt-tokens.ts";
import {
  buildPromptStatusLine,
  checkContextNotification,
  G_CTX_ALERT,
  stopPulseTimer,
} from "../src/features/dc-prompt/dc-prompt-status.ts";
import {
  DcPromptEditor,
  type DcPromptDeps,
} from "../src/features/dc-prompt/dc-prompt-editor.ts";
import {
  getPromptAnimation,
  listPromptAnimations,
  pacmanAnimation,
} from "../src/features/dc-prompt/animations/index.ts";
import {
  PromptAnimPickerPanel,
  openPromptAnimPicker,
} from "../src/features/dc-prompt/views/dc-prompt-anim-picker.ts";
import { writePromptPrefs } from "../src/features/dc-prompt/core/dc-prompt-prefs.ts";
import dcPromptExtension, {
  getCurrentEditor,
  install,
  notifiedMessages,
  patchPendingMessages,
  setCurrentEditor,
} from "../src/features/dc-prompt/dc-prompt.ts";

function createMockTui() {
  let renders = 0;
  return {
    terminal: {
      rows: 24,
      columns: 80,
    },
    requestRender: () => {
      renders += 1;
    },
    getRenders: () => renders,
  };
}

function createMockTheme() {
  return {
    borderColor: (s: string) => s,
    selectList: {
      selectedPrefix: () => "> ",
      unselectedPrefix: () => "  ",
      item: (_type: any, text: string) => text,
      description: (text: string) => text,
      scrollInfo: (text: string) => text,
    },
  };
}

function createMockKeybindings() {
  return {
    getBinding: () => undefined,
    getEffectiveConfig: () => ({}),
    matches: () => false,
    reload: () => {},
  };
}

test("pure tokens, formatters, and gauge calculations", () => {
  // Frames
  assert.equal(FRAMES.single.tl, "┌");
  assert.equal(FRAMES.single.br, "┘");
  assert.equal(FRAMES.double.tl, "╔");
  assert.equal(FRAMES.double.br, "╝");
  assert.equal(FRAMES.double.v, "║");
  assert.equal(FRAMES.double.h, "═");

  // DC_PROMPT
  assert.equal(DC_PROMPT.frame, "double");
  assert.equal(DC_PROMPT.glyphIdle, "⛩");
  assert.equal(DC_PROMPT.queuedGlyph, "⏳");
  assert.equal(DC_PROMPT.pulseMs, 110);
  assert.equal(KITT_WIDTH, 8);
  assert.equal(KITT_LEVELS, 6);
  assert.equal(KITT_SPEED, 2);

  // redToPink / redToBlack
  const pink1 = redToPink(1);
  const pink0 = redToPink(0);
  assert.ok(pink1.includes("255;51;51m"));
  assert.ok(pink0.includes("255;204;204m"));

  const black1 = redToBlack(1);
  const black0 = redToBlack(0);
  assert.ok(black1.includes("255;0;0m"));
  assert.ok(black0.includes("0;0;0m"));

  // cell
  assert.equal(cell("abc", 5), "abc  ");
  assert.ok(cell("abcdef", 4).startsWith("abcd"));

  // formatContextSize
  assert.equal(formatContextSize(undefined), "");
  assert.equal(formatContextSize(0), "");
  assert.equal(formatContextSize(-10), "");
  assert.equal(formatContextSize(16_384), "16K TKS");
  assert.equal(formatContextSize(32_768), "32K TKS");
  assert.equal(formatContextSize(65_536), "64K TKS");
  assert.equal(formatContextSize(131_072), "128K TKS");
  assert.equal(formatContextSize(1_048_576), "1.0M TKS");
  assert.equal(formatContextSize(2_097_152), "2.0M TKS");
  assert.equal(formatContextSize(1_000_000), "1.0M TKS");
  assert.equal(formatContextSize(1_500_000), "1.5M TKS");
  assert.equal(formatContextSize(200_000), "200K TKS");
  assert.equal(formatContextSize(500), "500 TKS");

  // formatCost
  assert.equal(formatCost(0, false), "$0.00");
  assert.equal(formatCost(1.234, false), "$1.23");
  assert.equal(formatCost(1.234, true), "$1.23 sub");

  // sessionCost
  const mockCtxWithoutEntries = {} as ExtensionContext;
  assert.equal(sessionCost(mockCtxWithoutEntries), 0);

  const mockCtxWithEntries = {
    sessionManager: {
      getEntries: () => [
        { type: "custom", data: {} },
        { type: "message", message: { role: "user", content: "hi" } },
        {
          type: "message",
          message: {
            role: "assistant",
            usage: { cost: { total: 0.045 } },
          },
        },
        {
          type: "message",
          message: {
            role: "assistant",
            usage: { cost: { total: 0.015 } },
          },
        },
      ],
    },
  } as unknown as ExtensionContext;
  assert.equal(Math.round(sessionCost(mockCtxWithEntries) * 1000) / 1000, 0.06);

  // getContextColor
  assert.equal(getContextColor(null), "\x1b[38;2;140;90;95m");
  assert.equal(getContextColor(30), COLOR_CTX_OPTIMAL);
  assert.equal(getContextColor(55), COLOR_CTX_MEDIUM);
  assert.equal(getContextColor(75), COLOR_CTX_HIGH);
  assert.equal(getContextColor(90, 0), NEON_PULSE_FRAMES[0]);
  assert.equal(getContextColor(90, 3), NEON_PULSE_FRAMES[3]);

  // paintGauge
  const gauge0 = paintGauge(0, 0);
  assert.ok(gauge0.includes("░".repeat(10)));
  const gauge50 = paintGauge(50, 0);
  assert.ok(gauge50.includes("█".repeat(5)));
  assert.ok(gauge50.includes("░".repeat(5)));
  const gauge100 = paintGauge(100, 0);
  assert.ok(gauge100.includes("█".repeat(10)));
});

test("checkContextNotification triggers Herdr warning on >= 81 and resets on < 75", () => {
  const globalState = globalThis as unknown as Record<symbol, boolean>;
  globalState[G_CTX_ALERT] = false;

  checkContextNotification(80);
  assert.equal(globalState[G_CTX_ALERT], false);

  checkContextNotification(85);
  assert.equal(globalState[G_CTX_ALERT], true);

  // Stays alerted above 75
  checkContextNotification(76);
  assert.equal(globalState[G_CTX_ALERT], true);

  // Drops below 75: flag resets
  checkContextNotification(74);
  assert.equal(globalState[G_CTX_ALERT], false);
});

test("buildPromptStatusLine responsive layout (wide, medium, compact)", () => {
  const mockPi = {
    getThinkingLevel: () => "high",
  } as unknown as ExtensionAPI;

  const mockCtx = {
    model: {
      id: "claude-3-7-sonnet",
      contextWindow: 200_000,
    },
    getContextUsage: () => ({
      percent: 45,
      contextWindow: 200_000,
    }),
    modelRegistry: {
      isUsingOAuth: () => true,
    },
    sessionManager: {
      getEntries: () => [
        {
          type: "message",
          message: {
            role: "assistant",
            usage: { cost: { total: 0.12 } },
          },
        },
      ],
    },
    ui: {
      theme: {
        fg: (_color: string, text: string) => text,
        bold: (text: string) => text,
      },
    },
  } as unknown as ExtensionContext;

  // 1. Wide width (120) -> all 3 items fit with ⟡ separator
  const wide = buildPromptStatusLine(mockPi, mockCtx, 120);
  assert.ok(wide.includes("claude-3-7-sonnet"));
  assert.ok(wide.includes("high"));
  assert.ok(wide.includes("CTX"));
  assert.ok(wide.includes("45% - 200K TKS"));
  assert.ok(wide.includes("Usage Cost"));
  assert.ok(wide.includes("$0.12 sub"));
  assert.ok(wide.includes("⟡"));

  // 2. Medium width (60) -> Usage Cost drops, Model and CTX survive
  const medium = buildPromptStatusLine(mockPi, mockCtx, 60);
  assert.ok(medium.includes("claude-3-7-sonnet"));
  assert.ok(medium.includes("CTX"));
  assert.ok(!medium.includes("Usage Cost"));

  // 3. Compact width (22) -> only Model survives
  const compact = buildPromptStatusLine(mockPi, mockCtx, 22);
  assert.ok(compact.includes("claude-3-7-sonnet"));
  assert.ok(!compact.includes("CTX"));

  // 4. Critical level (90%) -> triggers neon pulse
  const mockCriticalCtx = {
    ...mockCtx,
    getContextUsage: () => ({
      percent: 90,
      contextWindow: 200_000,
    }),
  } as unknown as ExtensionContext;

  const critical = buildPromptStatusLine(mockPi, mockCriticalCtx, 120);
  assert.ok(critical.includes("90%"));
  stopPulseTimer();
});

test("DcPromptEditor renders DOS double frame, idle username, and statusLine", () => {
  const tui = createMockTui();
  const theme = createMockTheme();
  const keybindings = createMockKeybindings();

  let renderedStatusWidth = 0;
  const deps: DcPromptDeps = {
    fg: (_color, text) => text,
    bold: (text) => text,
    borderColor: (text) => text,
    requestRender: () => tui.requestRender(),
    statusLine: (w) => {
      renderedStatusWidth = w;
      return `[STATUS ${w}]`;
    },
  };

  const editor = new DcPromptEditor(
    tui as any,
    theme as any,
    keybindings as any,
    deps,
  );

  // Initial state: idle
  assert.equal(editor.isWorking(), false);
  assert.equal(editor.isQueued(), false);

  const lines = editor.render(80);
  assert.ok(lines.length >= 3);

  // Top border: starts with ╔═ ⛩ and ends with ╗
  const top = lines[0]!;
  assert.ok(top.includes("╔═"));
  assert.ok(top.includes("⛩"));
  assert.ok(top.endsWith("╗"));

  // Body: starts and ends with ║
  const body = lines.slice(1, -2);
  for (const line of body) {
    assert.ok(line.startsWith("║"));
    assert.ok(line.endsWith("║"));
  }

  // Bottom border: starts with ╚ and ends with ╝
  const bottom = lines[lines.length - 2]!;
  assert.ok(bottom.startsWith("╚"));
  assert.ok(bottom.endsWith("╝"));

  // Status line: appended at the very end
  const status = lines[lines.length - 1]!;
  assert.equal(status, "[STATUS 80]");
  assert.equal(renderedStatusWidth, 80);

  // Working state: switches to KITT animation
  editor.setWorking(true);
  assert.equal(editor.isWorking(), true);
  const kittGlyph = editor.kitt();
  assert.ok(kittGlyph.includes("\u2022") || kittGlyph.includes("\u25a0"));

  const workingLines = editor.render(80);
  assert.ok(workingLines[0]!.includes("\u2022") || workingLines[0]!.includes("\u25a0"));

  // Queued state: switches to ⏳
  editor.setQueued(true);
  assert.equal(editor.isQueued(), true);
  assert.equal(editor.glyph(), "⏳");

  // Settled
  editor.setWorking(false);
  editor.setQueued(false);
  assert.equal(editor.glyph(), "⛩");

  editor.dispose();
});

test("dcPromptExtension installs on session_start, hooks lifecycle and handles /dc-prompt command", async () => {
  const commands = new Map<string, { description?: string; handler: Function }>();
  const shortcuts = new Map<string, any>();
  const events = new Map<string, Function[]>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerShortcut(shortcut: string, def: any) {
      shortcuts.set(shortcut.toLowerCase(), def);
    },
    on(event: string, fn: Function) {
      if (!events.has(event)) events.set(event, []);
      events.get(event)!.push(fn);
    },
    getThinkingLevel: () => "high",
  } as unknown as ExtensionAPI;

  dcPromptExtension(mockPi);

  // Single canonical command registered
  assert.equal(commands.size, 1);
  assert.ok(commands.has("dc-prompt"));
  assert.ok(shortcuts.has("alt+i"));

  // Lifecycle events registered
  assert.ok(events.has("session_start"));
  assert.ok(events.has("agent_start"));
  assert.ok(events.has("agent_settled"));
  assert.ok(events.has("agent_end"));
  assert.ok(events.has("thinking_level_select"));
  assert.ok(events.has("model_select"));

  // Simulate install on session_start
  let workingVisible = true;
  let installedEditorComponent: any = null;
  let notified: string[] = [];

  const mockCtx = {
    hasUI: true,
    mode: "tui",
    ui: {
      setWorkingVisible: (v: boolean) => {
        workingVisible = v;
      },
      setEditorComponent: (factory: any) => {
        installedEditorComponent = factory;
      },
      theme: {
        fg: (_c: string, t: string) => t,
        bold: (t: string) => t,
        getThinkingBorderColor: () => (t: string) => t,
      },
      notify: (text: string) => {
        notified.push(text);
      },
    },
  } as unknown as ExtensionContext;

  // Trigger session_start
  for (const fn of events.get("session_start")!) {
    fn({}, mockCtx);
  }

  assert.equal(workingVisible, false);
  assert.ok(typeof installedEditorComponent === "function");

  // Instantiate the editor through the factory
  const tui = createMockTui();
  const theme = createMockTheme();
  const keybindings = createMockKeybindings();
  const editor = installedEditorComponent(tui, theme, keybindings);
  assert.ok(editor instanceof DcPromptEditor);
  assert.equal(getCurrentEditor(), editor);

  // Test agent lifecycle hooks
  events.get("agent_start")?.forEach((fn) => fn());
  assert.equal(editor.isWorking(), true);

  events.get("agent_settled")?.forEach((fn) => fn());
  assert.equal(editor.isWorking(), false);
  assert.equal(editor.isQueued(), false);

  notifiedMessages.add("steer:test");
  events.get("agent_end")?.forEach((fn) => fn());
  assert.equal(notifiedMessages.size, 0);

  // Test /dc-prompt off
  const cmdHandler = commands.get("dc-prompt")!.handler;
  await cmdHandler("off", mockCtx);
  assert.equal(workingVisible, true);
  assert.equal(installedEditorComponent, undefined);
  assert.equal(getCurrentEditor(), undefined);

  // Test /dc-prompt anim kitt
  await cmdHandler("anim kitt", mockCtx);
  assert.ok(notified.some((n) => n.includes("kitt")));

  // Test /dc-prompt anim invalid
  await cmdHandler("anim invalid_name", mockCtx);
  assert.ok(notified.some((n) => n.includes("Animación no válida")));
});

test("patchPendingMessages wraps updatePendingMessagesDisplay and suppresses steering container", () => {
  let cleared = false;
  let queuedMessages: any = { steering: ["fast mode"], followUp: [] };

  const fakeHost = {
    pendingMessagesContainer: {
      clear: () => {
        cleared = true;
      },
    },
    getAllQueuedMessages: () => queuedMessages,
  };

  const tui = createMockTui();
  const theme = createMockTheme();
  const keybindings = createMockKeybindings();
  const editor = new DcPromptEditor(tui as any, theme as any, keybindings as any, {
    fg: (_c, t) => t,
    bold: (t) => t,
    borderColor: (t) => t,
    requestRender: () => {},
  });
  setCurrentEditor(editor);

  patchPendingMessages();

  // Call the global pending handler directly
  const gHandler = (globalThis as any)[Symbol.for("dc.prompt.pending-handler")];
  assert.ok(typeof gHandler === "function");

  gHandler(fakeHost);
  assert.equal(cleared, true);
  assert.equal(editor.isQueued(), true);

  editor.dispose();
  setCurrentEditor(undefined);
});

test("PacmanAnimation renders valid frames and alternates mouth", () => {
  const anim = getPromptAnimation("pacman");
  assert.equal(anim.name, "pacman");

  // Tick 2 gives phase = 2 -> pos = 0 (visible on screen)
  const tick2 = anim.render(2).replace(/\x1b\[[0-9;]*m/g, "");
  assert.ok(tick2.includes("C") || tick2.includes("O")); // Pacman on screen
  assert.ok(tick2.includes("·")); // Pellets

  const tick3 = anim.render(3).replace(/\x1b\[[0-9;]*m/g, "");
  assert.ok(tick3.includes("C") || tick3.includes("O"));

  // Check that pacman is in listPromptAnimations
  const list = listPromptAnimations().map((a) => a.name);
  assert.ok(list.includes("pacman"));
  assert.ok(list.includes("kitt"));

  // Reset prefs
  writePromptPrefs({ animation: "kitt" });
});

test("PromptAnimPickerPanel renders live previews and handles navigation", () => {
  const theme = {
    fg: (_role: string, text: string) => text,
    bold: (text: string) => text,
  };

  const panel = new PromptAnimPickerPanel(theme, "kitt");
  assert.equal(panel.selectedIndex, 0); // kitt

  // Test render: must show bullet and live preview box
  const lines = panel.render(50);
  assert.ok(lines.some((l) => l.includes("KITT")));
  assert.ok(lines.some((l) => l.includes("PACMAN")));
  assert.ok(lines.some((l) => l.includes("│"))); // vertical divider

  // Down arrow moves to pacman
  panel.handleInput("\x1b[B"); // Down
  assert.equal(panel.selectedIndex, 1);

  // Up arrow returns to kitt
  panel.handleInput("\x1b[A"); // Up
  assert.equal(panel.selectedIndex, 0);

  let picked = "";
  panel.onPick = (name) => { picked = name; };

  // Select pacman and press Enter
  panel.handleInput("\x1b[B");
  panel.handleInput("\r");
  assert.equal(picked, "pacman");

  panel.stop();
});
