import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { ProfileDuel, type ProfileId } from "../src/features/dc-faces/dc-profile-duel.ts";
import { DcWindow } from "../src/ui/dc-window.ts";
import profileDuelExtension from "../src/features/dc-faces/dc-faces.ts";

const dummyTheme: Pick<Theme, "fg" | "bg" | "bold"> = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("ProfileDuel renders dcdev and cubis ASCII faces side by side", () => {
  const duel = new ProfileDuel(dummyTheme, "dcdev");
  const lines = duel.render(74);

  assert.ok(lines.length >= 14);
  assert.ok(lines.some((l) => l.includes("dcdev") && l.includes("cubis")));
  assert.ok(lines.some((l) => l.includes("│"))); // divider between faces
});

test("ProfileDuel keyboard navigation toggles profiles and picks on Enter", () => {
  let picked: ProfileId | undefined;
  let cancelled = false;

  const duel = new ProfileDuel(dummyTheme, "dcdev");
  duel.onPick = (p) => { picked = p; };
  duel.onCancel = () => { cancelled = true; };

  assert.equal(duel.selected, 0);

  // Right arrow -> cubis
  assert.equal(duel.handleInput("\x1b[C"), true);
  assert.equal(duel.selected, 1);

  // Left arrow -> dcdev
  assert.equal(duel.handleInput("\x1b[D"), true);
  assert.equal(duel.selected, 0);

  // Enter picks dcdev
  assert.equal(duel.handleInput("\r"), true);
  assert.equal(picked, "dcdev");

  // Escape cancels
  assert.equal(duel.handleInput("\x1b"), true);
  assert.equal(cancelled, true);
});

test("ProfileDuel mouse click selects and second click picks", () => {
  let picked: ProfileId | undefined;

  const duel = new ProfileDuel(dummyTheme, "dcdev");
  duel.onPick = (p) => { picked = p; };
  duel.render(74);

  // Click on right side (x = 50, y = 5)
  const press = duel.handleMouse({
    type: "press",
    button: "left",
    x: 50,
    y: 5,
    screenX: 60,
    screenY: 15,
  } as unknown as TuiMouseEvent);
  assert.equal(press?.handled, true);
  assert.equal(duel.selected, 1);
  assert.equal(picked, undefined);

  // Second click applies
  const click = duel.handleMouse({
    type: "click",
    button: "left",
    x: 50,
    y: 5,
    screenX: 60,
    screenY: 15,
  } as unknown as TuiMouseEvent);
  assert.equal(click?.handled, true);
  assert.equal(picked, "cubis");
});

test("DcWindow renders two-sided footer and handles onFooterRightClick", () => {
  let footerClicked = false;
  const content = { render: () => ["body"], invalidate() {} };
  const win = new DcWindow({
    title: "Duel",
    theme: dummyTheme,
    content,
    onClose: () => {},
    maxHeight: 10,
    footer: {
      left: "  ←→ elegir",
      right: "[ Usar ]  ",
    },
    onFooterRightClick: () => { footerClicked = true; },
  });

  const lines = win.render(60);
  const footerLine = lines.at(-2)!;
  assert.ok(footerLine.includes("←→ elegir"));
  assert.ok(footerLine.includes("[ Usar ]"));

  // Click on [ Usar ] (near col 55)
  const click = win.handleMouse({
    type: "click",
    button: "left",
    x: 54,
    y: lines.length - 2, // footer line Y
    screenX: 70,
    screenY: 20,
    width: 60,
    height: 10,
  } as unknown as TuiMouseEvent);

  assert.equal(click?.handled, true);
  assert.equal(footerClicked, true);
});

test("profileDuelExtension registers only /dc-faces and handles non-TUI", async () => {
  const registeredCommands: string[] = [];
  let registeredShortcut: string | undefined;
  let commandHandler: Function | undefined;

  const mockPi = {
    registerCommand(name: string, def: { handler: Function }) {
      registeredCommands.push(name);
      if (name === "dc-faces") {
        commandHandler = def.handler;
      }
    },
    registerShortcut(name: string) {
      registeredShortcut = name;
    },
  } as unknown as ExtensionAPI;

  profileDuelExtension(mockPi);
  assert.deepEqual(registeredCommands, ["dc-faces"]);
  assert.equal(registeredShortcut, "alt+c");
  assert.ok(commandHandler);

  // Non-TUI notification
  const notifications: string[] = [];
  const nonTuiCtx = {
    hasUI: false,
    mode: "rpc",
    ui: {
      notify(msg: string) { notifications.push(msg); },
    },
  } as unknown as ExtensionCommandContext;

  await commandHandler!("", nonTuiCtx);
  assert.ok(notifications.some((n) => n.includes("necesita TUI")));
});
