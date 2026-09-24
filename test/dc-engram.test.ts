import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  EngramPanel,
  EngramEnrollPanel,
  dcEngramExtension,
  getProjectObservations,
  isProjectEnrolled,
} from "../src/features/dc-engram/index.ts";

test("dc-engram: getProjectObservations reads observations with optional project filter", () => {
  const obs = getProjectObservations(5, "lab-cofig-pi");
  assert.ok(Array.isArray(obs));
});

test("dc-engram: isProjectEnrolled returns boolean", () => {
  const enrolled = isProjectEnrolled("lab-cofig-pi");
  assert.equal(typeof enrolled, "boolean");
});

test("dc-engram: EngramPanel renders two-panel layout without crashing", () => {
  const theme = {
    fg: (_r: string, t: string) => t,
    bg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  };

  const panel = new EngramPanel({
    theme,
    projectName: "lab-cofig-pi",
    requestRender: () => {},
  });

  const lines = panel.render(80);
  assert.ok(Array.isArray(lines));
  assert.ok(lines.length > 0);
  assert.ok(lines[0].includes("│")); // vertical divider
});

test("dc-engram: EngramEnrollPanel renders and generates footer", () => {
  const theme = {
    fg: (_r: string, t: string) => t,
    bg: (_r: string, t: string) => t,
    bold: (t: string) => t,
  };

  const panel = new EngramEnrollPanel({
    projectName: "lab-cofig-pi",
    theme,
    requestRender: () => {},
  });

  const lines = panel.render(60);
  assert.ok(Array.isArray(lines));
  assert.ok(lines.length > 0);

  const footer = panel.getFooterText();
  assert.ok(typeof footer === "string");
  assert.ok(footer.length > 0);

  panel.destroy();
});

test("dc-engram: dcEngramExtension registers commands and shortcut", () => {
  const commands = new Map<string, any>();
  const shortcuts = new Map<string, any>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerShortcut(shortcut: string, def: any) {
      shortcuts.set(shortcut.toLowerCase(), def);
    },
  } as unknown as ExtensionAPI;

  dcEngramExtension(mockPi);
  assert.ok(commands.has("dc-engram"));
  assert.ok(commands.has("dc-engram-enroll"));
  assert.ok(commands.has("dc-enroll"));
  assert.ok(shortcuts.has("alt+shift+g"));
});
