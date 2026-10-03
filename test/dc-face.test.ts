import test from "node:test";
import assert from "node:assert/strict";
import {
  BIG_FACE_MIN_ROWS,
  getFaceProfile,
  listFaceProfiles,
  registerFaceProfile,
  bigFramesFor,
  bigDefaultFor,
  getMiniFaceFrame,
  paintBigLine,
  readFacePrefs,
  writeFacePrefs,
  getFaceFrameIndex,
  setFaceFrameIndex,
  ProfileDuel,
  openProfilePicker,
  dcFaceExtension,
} from "../src/features/dc-face/index.ts";
import {
  createSidebarFooter,
  getTerminalRows,
} from "../src/features/dc-sidebar/views/dc-sidebar-footer.ts";
import { agentVisualStateStore } from "../src/core/dc-agent-state/index.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

test("dc-face/art: getFaceProfile, bigDefaultFor and listFaceProfiles", () => {
  const dcdev = getFaceProfile("dcdev");
  assert.equal(dcdev.id, "dcdev");
  assert.equal(dcdev.defaultFace.length, 12);

  const cubis = getFaceProfile("cubis");
  assert.equal(cubis.id, "cubis");
  assert.equal(cubis.defaultFace.length, 10);

  const neko = getFaceProfile("neko");
  assert.equal(neko.id, "neko");
  assert.ok(neko.defaultFace.length >= 3);

  const list = listFaceProfiles();
  assert.ok(list.some((p) => p.id === "dcdev"));
  assert.ok(list.some((p) => p.id === "cubis"));
  assert.ok(list.some((p) => p.id === "neko"));

  // Extensibility: adding a new face profile dynamically
  registerFaceProfile({
    id: "custom_cat",
    name: "Custom Cat",
    defaultFace: ["(=^･ω･^=)"],
    frames: {},
  });

  const custom = getFaceProfile("custom_cat");
  assert.equal(custom.id, "custom_cat");
  assert.equal(custom.defaultFace[0], "(=^･ω･^=)");
});

test("dc-face/art: mini faces have stable frames for all modes", () => {
  const idleFace = getMiniFaceFrame("feliz", 0);
  assert.ok(idleFace.includes("❂‿❂"));

  const thinkingFace = getMiniFaceFrame("pensando", 0);
  assert.ok(thinkingFace.includes("≖.≖"));

  const sleepFace = getMiniFaceFrame("dormido", 2);
  assert.ok(sleepFace.includes("zZ"));
});

test("dc-face/art: paintBigLine applies ANSI semantic colors", () => {
  const lineHeart = " │══║  ♥  ║═══║  ♥  ║══│ ";
  const fg = (role: string, text: string) => `[${role}:${text}]`;
  const paintedHeart = paintBigLine(lineHeart, fg);

  assert.ok(paintedHeart.includes("[error:♥]"));
  assert.ok(paintedHeart.includes("[text:║]"));

  const lineCubis = "│  ▲▲▲▲▲▲▲   ▲▲▲▲▲▲▲  │";
  const paintedCubis = paintBigLine(lineCubis, fg);
  assert.ok(paintedCubis.includes("[error:│]"));
  assert.ok(paintedCubis.includes("[error:▲]"));
});

test("dc-face/core: BIG_FACE_MIN_ROWS is 46 and prefs persist cleanly", () => {
  assert.equal(BIG_FACE_MIN_ROWS, 46);

  writeFacePrefs({ profile: "cubis" });
  assert.equal(readFacePrefs().profile, "cubis");

  writeFacePrefs({ profile: "dcdev" });
  assert.equal(readFacePrefs().profile, "dcdev");
});

test("Sidebar Footer: responsive height (<46 rows renders 1-line mini, >=46 renders Big Face)", () => {
  writeFacePrefs({ profile: "dcdev" });

  // 1. Tall terminal (50 rows >= 46) -> Big Face (16 lines total)
  const tallTui = { terminal: { rows: 50 } };
  assert.equal(getTerminalRows(tallTui), 50);

  const tallFooter = createSidebarFooter(tallTui, 50);
  const tallLines = tallFooter.render(50);
  assert.equal(tallLines.length, 16);
  assert.ok(tallLines[0].includes("═")); // separator
  assert.ok(tallLines.some((l) => l.includes("♥") || l.includes("▲"))); // big face
  assert.ok(tallLines[tallLines.length - 1].includes("feliz") || tallLines[tallLines.length - 1].includes("listo"));

  // 2. Short terminal (35 rows < 46) -> 1-line mini face (5 lines total)
  const shortTui = { terminal: { rows: 35 } };
  assert.equal(getTerminalRows(shortTui), 35);

  const shortFooter = createSidebarFooter(shortTui, 50);
  const shortLines = shortFooter.render(50);
  assert.equal(shortLines.length, 5); // sepLine, empty, miniFace, empty, label
  assert.ok(shortLines[0].includes("═"));
  assert.ok(shortLines[2].includes("❂‿❂")); // mini face
  assert.ok(shortLines[4].includes("dcdev"));
});

test("Sidebar Footer: reactive to agentVisualStateStore state changes", () => {
  const tui = { terminal: { rows: 50 } };
  const footer = createSidebarFooter(tui, 50);

  // Transition to thinking
  (agentVisualStateStore as any).setState?.("thinking");
  let lines = footer.render(50);
  assert.ok(lines[lines.length - 1].includes("pensando"));

  // Verify frame index updates change animation lines
  setFaceFrameIndex(0);
  const frame0 = footer.render(50);
  setFaceFrameIndex(1);
  const frame1 = footer.render(50);
  // Frame 0 and Frame 1 for thinking have different pupil positions
  assert.notDeepEqual(frame0, frame1);

  // Transition to dormant (sleep)
  (agentVisualStateStore as any).setState?.("dormant");
  lines = footer.render(50);
  assert.ok(lines[lines.length - 1].includes("dormido"));

  // Reset back to idle
  (agentVisualStateStore as any).setState?.("idle");
  setFaceFrameIndex(0);
});

test("Sidebar Footer: mouse click toggles profile between dcdev and cubis", () => {
  writeFacePrefs({ profile: "dcdev" });
  let renderRequested = false;
  const tui = {
    terminal: { rows: 50 },
    requestRender: () => { renderRequested = true; },
  };

  const footer = createSidebarFooter(tui, 50);

  // First click toggles to cubis
  const res1 = (footer as any).handleMouse({ type: "click", button: "left" });
  assert.deepEqual(res1, { handled: true });
  assert.equal(readFacePrefs().profile, "cubis");
  assert.equal(renderRequested, true);

  // Second click toggles to neko
  const res2 = (footer as any).handleMouse({ type: "click", button: "left" });
  assert.deepEqual(res2, { handled: true });
  assert.equal(readFacePrefs().profile, "neko");
});

test("ProfileDuel: N-way keyboard navigation and selection across profiles", () => {
  const theme = {
    fg: (_role: string, text: string) => text,
    bold: (text: string) => text,
  };

  let chosen: string | undefined;
  const duel = new ProfileDuel(theme, "dcdev");
  duel.onPick = (p) => { chosen = p; };

  const N = duel.profiles.length;
  assert.equal(duel.selectedIndex, 0); // dcdev

  // Right arrow selects index 1 (cubis)
  duel.handleInput("\x1b[C");
  assert.equal(duel.selectedIndex, 1);

  // Right arrow selects index 2 (neko)
  duel.handleInput("\x1b[C");
  assert.equal(duel.selectedIndex, 2);

  // Left arrow selects index 1 (cubis)
  duel.handleInput("\x1b[D");
  assert.equal(duel.selectedIndex, 1);

  // Enter triggers onPick with cubis
  duel.handleInput("\r");
  assert.equal(chosen, "cubis");

  // Render produces columns separated by vertical divider │
  const lines = duel.render(80);
  assert.ok(lines.length >= 8);
  assert.ok(lines.some((l) => l.includes("dcdev") && l.includes("cubis")));
});

test("openProfilePicker renders with DcWindow native footer and complete divider", async () => {
  let capturedComponent: any;
  const mockCtx: any = {
    hasUI: true,
    mode: "tui",
    ui: {
      custom: async (factory: any) => {
        const theme = {
          fg: (_r: string, t: string) => t,
          bg: (_r: string, t: string) => t,
          bold: (t: string) => t,
        };
        const tui = { terminal: { rows: 50, columns: 120 }, requestRender() {} };
        capturedComponent = factory(tui, theme, {}, () => {});
        return "dcdev";
      },
      notify: () => {},
    },
  };

  await openProfilePicker(mockCtx);
  assert.ok(capturedComponent);

  const renderedLines = capturedComponent.render(80);
  assert.ok(renderedLines.length >= 10);
});

test("dcFaceExtension: binds to agentVisualStateStore reactively and stays quiet at idle", async () => {
  const events = new Map<string, Function[]>();
  let registeredCommands = new Map<string, any>();
  let registeredShortcuts = new Map<string, any>();

  const mockPi: any = {
    on: (evt: string, fn: Function) => {
      if (!events.has(evt)) events.set(evt, []);
      events.get(evt)!.push(fn);
    },
    registerCommand: (name: string, def: any) => {
      registeredCommands.set(name, def);
    },
    registerShortcut: (name: string, def: any) => {
      registeredShortcuts.set(name, def);
    },
  };

  let workingIndicatorDef: any;
  let widgetRegistered = false;

  const mockCtx: any = {
    hasUI: true,
    ui: {
      theme: { fg: (_r: string, t: string) => t },
      setWorkingIndicator: (def: any) => {
        workingIndicatorDef = def;
      },
      setWidget: (name: string, _factory: any, _opts: any) => {
        if (name === "dc-face-anchor") widgetRegistered = true;
      },
      onTerminalInput: () => () => {},
      notify: () => {},
    },
  };

  // Register extension
  dcFaceExtension(mockPi);
  assert.ok(registeredCommands.has("dc-face"));
  assert.ok(registeredCommands.has("dc-faces"));
  assert.ok(registeredShortcuts.has("alt+c"));

  // Fire session_start
  const sessionStartHandlers = events.get("session_start") || [];
  for (const handler of sessionStartHandlers) {
    await handler({}, mockCtx);
  }
  assert.ok(widgetRegistered);

  // Initial state should be idle (feliz)
  const faceKey = Symbol.for("dc.face.mini");
  let currentFace = (globalThis as any)[faceKey];
  assert.ok(currentFace.includes("feliz"));

  // Reactive state: Transition to thinking
  agentVisualStateStore.setState("thinking");
  currentFace = (globalThis as any)[faceKey];
  assert.ok(currentFace.includes("pensando"));
  assert.ok(workingIndicatorDef !== undefined);

  // Reactive state: Transition to working
  agentVisualStateStore.setState("working");
  currentFace = (globalThis as any)[faceKey];
  assert.ok(currentFace.includes("trabajando"));

  // Reactive state: Transition to dormant (sleep)
  agentVisualStateStore.setState("dormant");
  currentFace = (globalThis as any)[faceKey];
  assert.ok(currentFace.includes("dormido"));

  // Reactive state: Back to idle
  agentVisualStateStore.setState("idle");
  currentFace = (globalThis as any)[faceKey];
  assert.ok(currentFace.includes("feliz"));

  // Shutdown cleans up listeners and timers
  const shutdownHandlers = events.get("session_shutdown") || [];
  for (const handler of shutdownHandlers) {
    handler();
  }
});

