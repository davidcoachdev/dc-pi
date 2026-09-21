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

  const list = listFaceProfiles();
  assert.ok(list.some((p) => p.id === "dcdev"));
  assert.ok(list.some((p) => p.id === "cubis"));

  // Extensibility: adding a new face profile dynamically
  registerFaceProfile({
    id: "neko",
    name: "Neko Cat",
    defaultFace: ["(=^･ω･^=)"],
    frames: {},
  });

  const custom = getFaceProfile("neko");
  assert.equal(custom.id, "neko");
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

  // Second click toggles back to dcdev
  const res2 = (footer as any).handleMouse({ type: "click", button: "left" });
  assert.deepEqual(res2, { handled: true });
  assert.equal(readFacePrefs().profile, "dcdev");
});

test("ProfileDuel: keyboard navigation and selection", () => {
  const theme = {
    fg: (_role: string, text: string) => text,
    bold: (text: string) => text,
  };

  let chosen: string | undefined;
  const duel = new ProfileDuel(theme, "dcdev");
  duel.onPick = (p) => { chosen = p; };

  assert.equal(duel.selected, 0); // dcdev

  // Right arrow selects cubis
  duel.handleInput("\x1b[C"); // Right
  assert.equal(duel.selected, 1); // cubis

  // Left arrow selects dcdev
  duel.handleInput("\x1b[D"); // Left
  assert.equal(duel.selected, 0); // dcdev

  // Enter triggers onPick with dcdev
  duel.handleInput("\r");
  assert.equal(chosen, "dcdev");
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

  const renderedLines = capturedComponent.render(62);
  assert.ok(renderedLines.length >= 20);

  // 1. Title bar at top
  assert.ok(renderedLines[1].includes("Perfil de Carita"));
  assert.ok(renderedLines[1].includes("[ X ]") || renderedLines[1].includes("[X]"));

  // 2. Continuous divider across all body lines
  for (let i = 3; i < renderedLines.length - 3; i++) {
    assert.ok(renderedLines[i].includes("│"), `Line ${i} should have vertical divider: ${renderedLines[i]}`);
  }

  // 3. Footer rule and native footer row at bottom
  assert.ok(renderedLines[renderedLines.length - 2].includes("elegir"));
  assert.ok(renderedLines[renderedLines.length - 2].includes("[ Usar ]"));
  assert.ok(renderedLines[renderedLines.length - 3].includes("╠") || renderedLines[renderedLines.length - 3].includes("─"));
});
