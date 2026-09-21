import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import {
  installUserBoxPatch,
  isUserBoxEnabled,
  isUserBoxVerticalPadding,
  resolveCurrentUserName,
  setUserBoxEnabled,
  setUserBoxVerticalPadding,
} from "../src/features/dc-user-box/dc-user-box-patch.ts";
import dcUserBoxExtension from "../src/features/dc-user-box/dc-user-box.ts";

test("user-box config manages enabled and vertical padding states", () => {
  setUserBoxEnabled(true);
  assert.equal(isUserBoxEnabled(), true);

  setUserBoxEnabled(false);
  assert.equal(isUserBoxEnabled(), false);

  setUserBoxVerticalPadding(true);
  assert.equal(isUserBoxVerticalPadding(), true);

  setUserBoxVerticalPadding(false);
  assert.equal(isUserBoxVerticalPadding(), false);

  // Restore default
  setUserBoxEnabled(true);
});

test("resolveCurrentUserName retrieves name or falls back to User", () => {
  const name = resolveCurrentUserName();
  assert.ok(typeof name === "string");
  assert.ok(name.length > 0);
});

test("installUserBoxPatch wraps UserMessageComponent.prototype.render", () => {
  const installed = installUserBoxPatch();
  assert.equal(installed, true);

  // Mock instance of UserMessageComponent
  const mockInstance: any = Object.create(UserMessageComponent.prototype);
  mockInstance.message = {
    role: "user",
    content: "Please refactor my code.",
  };
  mockInstance[Symbol.for("dc.user-message.orig-render")] = () => [
    "Please refactor my code.",
  ];

  setUserBoxEnabled(true);
  setUserBoxVerticalPadding(false);

  const lines = mockInstance.render(60);
  assert.ok(lines.length >= 3);
  // Header with Torii and name
  assert.ok(lines.some((l: string) => l.includes("╭") && l.includes("⛩")));
  // Footer with copy button
  assert.ok(lines.some((l: string) => l.includes("╰") && l.includes("📋")));
  // Content line
  assert.ok(lines.some((l: string) => l.includes("Please refactor my code.")));

  // Test with vertical padding enabled
  setUserBoxVerticalPadding(true);
  const paddedLines = mockInstance.render(60);
  assert.equal(paddedLines.length, lines.length + 2);

  // Restore defaults
  setUserBoxVerticalPadding(false);
});

test("dcUserBoxExtension registers only single command /dc-user-box", async () => {
  const commands = new Map<string, { description?: string; handler: Function }>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
  } as unknown as ExtensionAPI;

  dcUserBoxExtension(mockPi);

  assert.equal(commands.size, 1);
  assert.ok(commands.has("dc-user-box"));

  let notifiedMsg = "";
  const mockCtx = {
    hasUI: true,
    ui: {
      notify(msg: string) {
        notifiedMsg = msg;
      },
    },
  } as unknown as ExtensionContext;

  const handler = commands.get("dc-user-box")!.handler;

  // 1. Off
  await handler("off", mockCtx);
  assert.equal(isUserBoxEnabled(), false);
  assert.ok(notifiedMsg.includes("disabled"));

  // 2. On
  await handler("on", mockCtx);
  assert.equal(isUserBoxEnabled(), true);
  assert.ok(notifiedMsg.includes("enabled"));

  // 3. Pad toggle
  await handler("pad", mockCtx);
  assert.equal(isUserBoxVerticalPadding(), true);
  assert.ok(notifiedMsg.includes("vertical padding enabled"));

  // Restore defaults
  setUserBoxVerticalPadding(false);
});
