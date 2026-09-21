import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import {
  getUserName,
  saveUserName,
  userName,
  resolveUserFilePath,
} from "../src/features/dc-user/dc-user-store.ts";
import { DcPromptInputComponent } from "../src/features/dc-user/dc-user-prompt-input.ts";
import dcUserExtension from "../src/features/dc-user/dc-user.ts";

const dummyTheme: Pick<Theme, "fg" | "bg" | "bold"> = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("getUserName returns empty string if file does not exist", () => {
  const tmpPath = path.join(os.tmpdir(), `dc-user-test-nonexistent-${Date.now()}.json`);
  assert.equal(getUserName(tmpPath), "");
  assert.equal(userName(tmpPath), "");
});

test("saveUserName persists data and getUserName retrieves it", () => {
  const tmpDir = path.join(os.tmpdir(), `dc-user-test-${Date.now()}`);
  const tmpPath = path.join(tmpDir, "sub", "dc-user.json");

  try {
    const saved = saveUserName("  el Gentleman  ", tmpPath);
    assert.equal(saved, true);

    const name = getUserName(tmpPath);
    assert.equal(name, "el Gentleman");

    // Corrupted JSON returns empty string gracefully
    fs.writeFileSync(tmpPath, "{ corrupted json: 123", "utf8");
    assert.equal(getUserName(tmpPath), "");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("resolveUserFilePath prioritizes customPath, env, and default", () => {
  const custom = "/custom/path/dc-user.json";
  assert.equal(resolveUserFilePath(custom), custom);

  const prevEnv = process.env.DC_USER_CONFIG_PATH;
  try {
    process.env.DC_USER_CONFIG_PATH = "/env/path/dc-user.json";
    assert.equal(resolveUserFilePath(), "/env/path/dc-user.json");
  } finally {
    if (prevEnv !== undefined) {
      process.env.DC_USER_CONFIG_PATH = prevEnv;
    } else {
      delete process.env.DC_USER_CONFIG_PATH;
    }
  }
});

test("DcPromptInputComponent handles typing, backspace, enter, and escape", () => {
  let submitted: string | undefined;
  let cancelled = false;
  let renderCount = 0;

  const mockTui = {
    requestRender: () => {
      renderCount++;
    },
  } as any;

  const input = new DcPromptInputComponent(dummyTheme as Theme, mockTui, {
    label: "Tu nombre:",
    initialValue: "Neo",
    onSubmit: (v) => {
      submitted = v;
    },
    onCancel: () => {
      cancelled = true;
    },
  });

  const lines = input.render(60);
  assert.ok(lines.some((l) => l.includes("Tu nombre:")));
  assert.ok(lines.some((l) => l.includes("Neo")));

  // Type characters
  input.handleInput(" ");
  input.handleInput("M");
  input.handleInput("a");
  input.handleInput("t");
  input.handleInput("r");
  input.handleInput("i");
  input.handleInput("x");
  assert.equal(input.getValue(), "Neo Matrix");

  // Backspace (\x7f)
  input.handleInput("\x7f");
  assert.equal(input.getValue(), "Neo Matri");

  // Enter (\r)
  input.handleInput("\r");
  assert.equal(submitted, "Neo Matri");

  // Escape (\x1b)
  input.handleInput("\x1b");
  assert.equal(cancelled, true);
});

test("dcUserExtension registers only /dc-user and shortcut alt+n", async () => {
  const commands = new Map<string, { description?: string; handler: Function }>();
  const shortcuts = new Map<string, { description?: string; handler: Function }>();
  const events = new Map<string, Function>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerShortcut(key: string, def: any) {
      shortcuts.set(key, def);
    },
    on(event: string, handler: Function) {
      events.set(event, handler);
    },
  } as unknown as ExtensionAPI;

  dcUserExtension(mockPi);

  assert.equal(commands.size, 1);
  assert.ok(commands.has("dc-user"));
  assert.ok(shortcuts.has("alt+n"));
  assert.ok(events.has("session_start"));
  assert.ok(events.has("session_shutdown"));
  assert.ok(events.has("message_start"));

  // Calling command with argument directly saves and notifies
  const tmpDir = path.join(os.tmpdir(), `dc-user-ext-test-${Date.now()}`);
  const tmpFile = path.join(tmpDir, "dc-user.json");
  const prevEnv = process.env.DC_USER_CONFIG_PATH;
  process.env.DC_USER_CONFIG_PATH = tmpFile;

  let notifiedMessage: string | undefined;
  const mockCtx = {
    hasUI: true,
    mode: "tui",
    ui: {
      notify(msg: string) {
        notifiedMessage = msg;
      },
    },
  } as unknown as ExtensionContext;

  try {
    const handler = commands.get("dc-user")!.handler;
    await handler("Morpheus", mockCtx);

    assert.equal(getUserName(tmpFile), "Morpheus");
    assert.equal(notifiedMessage, "usuario: Morpheus");
  } finally {
    if (prevEnv !== undefined) {
      process.env.DC_USER_CONFIG_PATH = prevEnv;
    } else {
      delete process.env.DC_USER_CONFIG_PATH;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
