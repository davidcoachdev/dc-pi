import test from "node:test";
import assert from "node:assert/strict";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import { Key } from "@earendil-works/pi-tui";
import {
  DC_DIALOG_TITLE,
  PATCHED,
  REV_SYM,
  splitPanel,
  titleOf,
  createFallbackTheme,
  getSafeTheme,
  setActiveContext,
  CleanExtensionSelectPanel,
  plainOf,
  isHintLine,
} from "../src/experimental/dc-dialogs-overlay/dc-dialogs-helpers.ts";
import {
  installDialogsPatch,
  uninstallDialogsPatch,
  isDialogsEnabled,
  setDialogsEnabled,
} from "../src/experimental/dc-dialogs-overlay/dc-dialogs-patch.ts";
import dcDialogsExtension from "../src/experimental/dc-dialogs-overlay/dc-dialogs.ts";
import { DcWindow } from "../src/ui/dc-window.ts";

const dummyTheme: Theme = {
  name: "test-theme",
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  dim: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  inverse: (text: string) => text,
  strikethrough: (text: string) => text,
  getFgAnsi: () => "",
  getBgAnsi: () => "",
  getColorMode: () => "truecolor",
  getThinkingBorderColor: () => (s: string) => s,
  getBashModeBorderColor: () => (s: string) => s,
} as unknown as Theme;

test("splitPanel extracts title and footer and leaves body clean", () => {
  const inner: Component = {
    render: () => [
      "",
      "  My Dialog Title  ",
      "Content row 1",
      "Content row 2",
      "↑/↓ navigate • enter select • esc close",
      "",
    ],
    invalidate: () => {},
  };

  const split = splitPanel(inner);
  assert.equal(split.title, "My Dialog Title");
  assert.ok(split.footer?.includes("navigate"));

  const bodyLines = split.body.render(80);
  assert.deepEqual(bodyLines, ["Content row 1", "Content row 2"]);
});

test("splitPanel handles edge cases defensively", () => {
  // Empty component
  const emptyComp: Component = {
    render: () => [],
    invalidate: () => {},
  };
  const emptySplit = splitPanel(emptyComp);
  assert.equal(emptySplit.title, undefined);
  assert.equal(emptySplit.footer, undefined);
  assert.deepEqual(emptySplit.body.render(80), []);

  // Throwing render
  const throwingComp: Component = {
    render: () => {
      throw new Error("Render exploded");
    },
    invalidate: () => {},
  };
  const throwingSplit = splitPanel(throwingComp);
  assert.equal(throwingSplit.title, undefined);
  assert.equal(throwingSplit.footer, undefined);

  // Component without hints or title
  const plainComp: Component = {
    render: () => ["Some very long content that exceeds sixty characters so it should not be picked as a title and does not have hints."],
    invalidate: () => {},
  };
  const plainSplit = splitPanel(plainComp);
  assert.equal(plainSplit.title, undefined);
  assert.equal(plainSplit.footer, undefined);

  // Body forwards invalidate and input
  let invalidated = false;
  let handledInput = "";
  let handledMouse = false;
  const interactiveComp: Component = {
    render: () => ["Line"],
    invalidate: () => { invalidated = true; },
    handleInput: (d: string) => { handledInput = d; return true; },
    handleMouse: () => { handledMouse = true; return { handled: true }; },
  };
  const s = splitPanel(interactiveComp);
  s.body.invalidate?.();
  assert.equal(invalidated, true);
  s.body.handleInput?.("x");
  assert.equal(handledInput, "x");
  (s.body as any).handleMouse?.({});
  assert.equal(handledMouse, true);
});

test("plainOf and isHintLine helpers", () => {
  assert.equal(plainOf("\x1b[31mHello\x1b[0m World"), "Hello World");
  assert.equal(isHintLine("enter select • esc close"), true);
  assert.equal(isHintLine("ctrl+s save | shift+tab back"), true);
  assert.equal(isHintLine("just some regular text"), false);
});

test("titleOf resolves title by priority", () => {
  // 1. DC_DIALOG_TITLE symbol
  const compWithSymbol: any = {
    [DC_DIALOG_TITLE]: "Symbolic Title",
    render: () => ["Render Line"],
    invalidate: () => {},
  };
  assert.equal(titleOf(compWithSymbol), "Symbolic Title");

  // 2. title property
  const compWithProp: any = {
    title: "Prop Title",
    render: () => ["Render Line"],
    invalidate: () => {},
  };
  assert.equal(titleOf(compWithProp), "Prop Title");

  // 3. First rendered line
  const compWithRender: Component = {
    render: () => ["", "First Header Line", "Second Line"],
    invalidate: () => {},
  };
  assert.equal(titleOf(compWithRender), "First Header Line");

  // 4. Fallback "Dc Studio"
  const emptyComp: Component = {
    render: () => [],
    invalidate: () => {},
  };
  assert.equal(titleOf(emptyComp), "Dc Studio");

  // 5. Exception during resolution falls back cleanly
  const badComp: any = {
    get title() {
      throw new Error("bad prop");
    },
    render: () => [],
    invalidate: () => {},
  };
  assert.equal(titleOf(badComp), "Dc Studio");
});

test("createFallbackTheme and getSafeTheme", () => {
  const fallback = createFallbackTheme();
  assert.equal(fallback.fg("accent", "text"), "text");
  assert.equal(fallback.bg("selectedBg", "text"), "text");
  assert.equal(fallback.bold("text"), "text");

  // getSafeTheme returns fallback when no context or global exists
  const safe = getSafeTheme();
  assert.ok(typeof safe.fg === "function");

  // with active context
  const mockCtx = {
    ui: {
      theme: dummyTheme,
    },
  } as unknown as ExtensionContext;
  setActiveContext(mockCtx);
  assert.equal(getSafeTheme(), dummyTheme);
  setActiveContext(undefined);

  // with thisArg.createExtensionUIContext
  const mockThis = {
    createExtensionUIContext: () => ({ theme: dummyTheme }),
  };
  assert.equal(getSafeTheme(mockThis), dummyTheme);
});

test("CleanExtensionSelectPanel renders and highlights selection", () => {
  const options = ["Option A", "Option B", "Option C"];
  let selected = "";
  let cancelled = false;
  let renderRequested = false;

  const panel = new CleanExtensionSelectPanel(
    options,
    dummyTheme,
    (opt) => { selected = opt; },
    () => { cancelled = true; },
    () => { renderRequested = true; },
  );

  assert.equal(panel.getSelectedIndex(), 0);
  const lines = panel.render(40);
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes("●"));
  assert.ok(lines[0].includes("Option A"));
  assert.ok(lines[1].includes("○"));
  assert.ok(lines[1].includes("Option B"));

  // Navigation down
  panel.handleInput("j");
  assert.equal(panel.getSelectedIndex(), 1);
  assert.equal(renderRequested, true);

  // Navigation down via Key.down
  panel.handleInput("\x1b[B");
  assert.equal(panel.getSelectedIndex(), 2);

  // Cannot go beyond last option
  panel.handleInput("\x1b[B");
  assert.equal(panel.getSelectedIndex(), 2);

  // Navigation up via Key.up and k
  panel.handleInput("\x1b[A");
  assert.equal(panel.getSelectedIndex(), 1);
  panel.handleInput("k");
  assert.equal(panel.getSelectedIndex(), 0);

  // Selection via Enter
  panel.handleInput("\r");
  assert.equal(selected, "Option A");

  // Cancel via Escape
  panel.handleInput(Key.escape);
  assert.equal(cancelled, true);
});

test("CleanExtensionSelectPanel page and home/end navigation", () => {
  const options = Array.from({ length: 25 }, (_, i) => `Item ${i + 1}`);
  const panel = new CleanExtensionSelectPanel(
    options,
    dummyTheme,
    () => {},
    () => {},
    () => {},
  );

  // End
  panel.handleInput(Key.end);
  assert.equal(panel.getSelectedIndex(), 24);

  // Home
  panel.handleInput(Key.home);
  assert.equal(panel.getSelectedIndex(), 0);

  // PageDown
  panel.handleInput(Key.pageDown);
  assert.equal(panel.getSelectedIndex(), 10);

  // PageUp
  panel.handleInput(Key.pageUp);
  assert.equal(panel.getSelectedIndex(), 0);
});

test("CleanExtensionSelectPanel mouse wheel and click selection", () => {
  const options = ["Apple", "Banana", "Cherry"];
  let selected = "";
  const panel = new CleanExtensionSelectPanel(
    options,
    dummyTheme,
    (opt) => { selected = opt; },
    () => {},
    () => {},
  );

  // Mouse wheel down
  panel.handleMouse({ type: "wheel", wheelDelta: 1 } as unknown as TuiMouseEvent);
  assert.equal(panel.getSelectedIndex(), 1);

  // Mouse wheel up
  panel.handleMouse({ type: "wheel", wheelDelta: -1 } as unknown as TuiMouseEvent);
  assert.equal(panel.getSelectedIndex(), 0);

  // Click on row 2 (Cherry)
  panel.handleMouse({ type: "click", y: 2, button: "left" } as unknown as TuiMouseEvent);
  assert.equal(panel.getSelectedIndex(), 2);

  // Second click on row 2 (already selected) triggers onSelect
  panel.handleMouse({ type: "click", y: 2, button: "left" } as unknown as TuiMouseEvent);
  assert.equal(selected, "Cherry");
});

test("patch installation, state toggling, and uninstallation", () => {
  // Ensure starting clean
  uninstallDialogsPatch();
  assert.equal(isDialogsEnabled(), true);

  const proto = InteractiveMode.prototype as any;
  const origCustom = proto.showExtensionCustom;
  const origSessionCmd = proto.handleSessionCommand;
  const origSessionSelector = proto.showSessionSelector;
  const origTreeSelector = proto.showTreeSelector;
  const origExtSelector = proto.showExtensionSelector;
  const origExtInput = proto.showExtensionInput;
  const origSelector = proto.showSelector;

  // Install
  installDialogsPatch();
  assert.equal(proto[PATCHED], true);
  assert.notEqual(proto.showExtensionCustom, origCustom);

  // Idempotent install
  installDialogsPatch();
  assert.equal(proto[PATCHED], true);

  // Toggle state
  setDialogsEnabled(false);
  assert.equal(isDialogsEnabled(), false);
  setDialogsEnabled(true);
  assert.equal(isDialogsEnabled(), true);

  // Uninstall restores everything
  uninstallDialogsPatch();
  assert.equal(proto[PATCHED], undefined);
  assert.equal(proto.showExtensionCustom, origCustom);
  assert.equal(proto.handleSessionCommand, origSessionCmd);
  assert.equal(proto.showSessionSelector, origSessionSelector);
  assert.equal(proto.showTreeSelector, origTreeSelector);
  assert.equal(proto.showExtensionSelector, origExtSelector);
  assert.equal(proto.showExtensionInput, origExtInput);
  assert.equal(proto.showSelector, origSelector);
});

test("dcDialogsExtension registers /dc-dialogs command and handles arguments", async () => {
  uninstallDialogsPatch();
  let registeredName = "";
  let registeredHandler: any;

  const mockPi = {
    on: () => {},
    registerCommand: (name: string, config: any) => {
      registeredName = name;
      registeredHandler = config.handler;
    },
  } as unknown as ExtensionAPI;

  dcDialogsExtension(mockPi);
  assert.equal(registeredName, "dc-dialogs");
  assert.ok(typeof registeredHandler === "function");

  let notifiedMessage = "";
  const mockCtx = {
    hasUI: true,
    ui: {
      notify: (msg: string) => { notifiedMessage = msg; },
    },
  } as unknown as ExtensionContext;

  // Test /dc-dialogs off
  await registeredHandler("off", mockCtx);
  assert.equal(isDialogsEnabled(), false);
  assert.ok(notifiedMessage.includes("disabled"));

  // Test /dc-dialogs on
  await registeredHandler("on", mockCtx);
  assert.equal(isDialogsEnabled(), true);
  assert.ok(notifiedMessage.includes("enabled"));

  // Test /dc-dialogs status
  await registeredHandler("status", mockCtx);
  assert.ok(notifiedMessage.includes("enabled"));

  uninstallDialogsPatch();
});

test("showExtensionCustom wraps components in DcWindow and skips existing DcWindows", async () => {
  uninstallDialogsPatch();
  installDialogsPatch();
  setDialogsEnabled(true);

  const proto = InteractiveMode.prototype as any;
  let customPassedComponent: any;

  // Create a mock instance of InteractiveMode
  const instance: any = Object.create(proto);
  instance.editor = { getText: () => "" };
  instance.editorContainer = { clear: () => {}, addChild: () => {} };
  instance.ui = {
    showOverlay: (c: any) => {
      customPassedComponent = c;
      return { hide: () => {} };
    },
    hideOverlay: () => {},
    setFocus: () => {},
    requestRender: () => {},
  };
  instance.keybindings = {};

  // 1. Regular component overlay wrapped in DcWindow
  const rawComp: Component = {
    render: () => ["Header Title", "Body Content", "esc close"],
    invalidate: () => {},
  };

  await instance.showExtensionCustom(
    (_tui: any, _theme: any, _kb: any, done: any) => {
      setTimeout(() => done("done-result"), 10);
      return rawComp;
    },
    { overlay: true, overlayOptions: { anchor: "center" } },
  );

  assert.ok(customPassedComponent);
  assert.equal(customPassedComponent[Symbol.for("dc.window")], true);
  assert.ok(customPassedComponent instanceof DcWindow);

  // 2. Component that is ALREADY a DcWindow is not double-wrapped
  const alreadyWindow = new DcWindow({
    title: "Already Wrapped",
    content: rawComp,
    theme: dummyTheme,
    onClose: () => {},
  });

  await instance.showExtensionCustom(
    (_tui: any, _theme: any, _kb: any, done: any) => {
      setTimeout(() => done("done-result-2"), 10);
      return alreadyWindow;
    },
    { overlay: true, overlayOptions: { anchor: "center" } },
  );

  assert.equal(customPassedComponent, alreadyWindow);

  // 3. When dialogs are disabled, bypass wrapper
  setDialogsEnabled(false);
  await instance.showExtensionCustom(
    (_tui: any, _theme: any, _kb: any, done: any) => {
      setTimeout(() => done("done-result-3"), 10);
      return rawComp;
    },
    { overlay: true },
  );
  // Without dialogs enabled, rawComp is passed directly to showOverlay
  assert.equal(customPassedComponent, rawComp);

  uninstallDialogsPatch();
  setDialogsEnabled(true);
});

test("showExtensionSelector presents CleanExtensionSelectPanel in DcWindow", async () => {
  uninstallDialogsPatch();
  installDialogsPatch();
  setDialogsEnabled(true);

  const proto = InteractiveMode.prototype as any;
  let overlayComp: any;

  const instance: any = Object.create(proto);
  instance.editor = { getText: () => "" };
  instance.editorContainer = { clear: () => {}, addChild: () => {} };
  instance.ui = {
    showOverlay: (c: any) => {
      overlayComp = c;
      return { hide: () => {} };
    },
    hideOverlay: () => {},
    setFocus: () => {},
    requestRender: () => {},
  };
  instance.keybindings = {};

  const selectPromise = instance.showExtensionSelector("Select an option", ["Alpha", "Beta", "Gamma"]);

  // Wait for microtask tick
  await new Promise((r) => setTimeout(r, 20));

  assert.ok(overlayComp);
  assert.equal(overlayComp[Symbol.for("dc.window")], true);

  // Access the inner CleanExtensionSelectPanel and select "Beta"
  const panel = (overlayComp as any).options?.content as CleanExtensionSelectPanel;
  assert.ok(panel instanceof CleanExtensionSelectPanel);
  panel.handleInput("j"); // move to Beta
  panel.handleInput("\r"); // select Beta

  const result = await selectPromise;
  assert.equal(result, "Beta");

  uninstallDialogsPatch();
});
