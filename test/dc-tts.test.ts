import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  dcTtsExtension,
  DcTtsPanel,
  extractAssistantMessageText,
  formatOpenCodeTtsBadge,
  readTtsPrefs,
  writeTtsPrefs,
  resetTtsPrefsCache,
  resolveTtsDaemonPaths,
  type TtsStatus,
} from "../src/features/dc-tts/index.ts";

const mockTheme: Pick<Theme, "fg" | "bg" | "bold"> = {
  fg: (_role, text) => text,
  bg: (_role, text) => text,
  bold: (text) => text,
};

test("formatOpenCodeTtsBadge renders playing, paused, and offline states", () => {
  assert.equal(formatOpenCodeTtsBadge(null), "● tts down");

  const playing: TtsStatus = {
    status: "playing",
    queue: 2,
    autoRead: true,
    voice: "Microsoft Sabina Desktop",
    rate: 1.25,
    volume: 90,
  };
  assert.equal(formatOpenCodeTtsBadge(playing, true), "▶ tts (2) 🔊 🔔 ⚡1.25× 🔉90%");

  const idle: TtsStatus = {
    status: "idle",
    queue: 0,
    autoRead: false,
    voice: "Microsoft Helena Desktop",
    rate: 1.0,
    volume: 100,
  };
  assert.equal(formatOpenCodeTtsBadge(idle, false), "⏸ tts 🔈 🔕");
});

test("extractAssistantMessageText strips thinking and toolCall blocks", () => {
  const msg = {
    role: "assistant",
    content: [
      { type: "thinking", text: "internal reasoning" },
      { type: "toolCall", name: "bash" },
      { type: "text", text: "Primera parte." },
      { type: "text", text: "Segunda parte." },
    ],
  };
  assert.equal(extractAssistantMessageText(msg), "Primera parte.\n\nSegunda parte.");
});

test("readTtsPrefs and writeTtsPrefs persist isolated config JSON", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-tts-prefs-"));
  const file = path.join(tmpDir, "dc-tts.json");
  resetTtsPrefsCache();

  const initial = readTtsPrefs(file);
  assert.equal(initial.autoStart, true);
  assert.equal(initial.autoRead, true);
  assert.equal(initial.rate, 1.0);

  const updated = writeTtsPrefs({ voice: "Microsoft Sabina Desktop", rate: 1.25, volume: 80 }, file);
  assert.equal(updated.voice, "Microsoft Sabina Desktop");
  assert.equal(updated.rate, 1.25);
  assert.equal(updated.volume, 80);

  resetTtsPrefsCache();
  const reloaded = readTtsPrefs(file);
  assert.equal(reloaded.voice, "Microsoft Sabina Desktop");
  assert.equal(reloaded.rate, 1.25);
  assert.equal(reloaded.volume, 80);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("resolveTtsDaemonPaths locates embedded Go module in dc-pi/native/dc-tts", () => {
  const paths = resolveTtsDaemonPaths();
  assert.ok(
    fs.existsSync(path.join(paths.nativeSourceDir, "go.mod")),
    `Expected go.mod at ${paths.nativeSourceDir}`,
  );
  assert.ok(paths.daemonBinPath.endsWith("dc-tts-win"));
  assert.ok(paths.cliBinPath.endsWith("dc-tts"));
});

test("DcTtsPanel renders tabs, status card, and handles keyboard navigation", () => {
  const initialStatus: TtsStatus = {
    status: "idle",
    queue: 0,
    autoRead: true,
    voice: "Microsoft Sabina Desktop",
    rate: 1.0,
    volume: 100,
    wakeWord: "dc",
    language: "es-MX",
  };

  let closed = false;
  const panel = new DcTtsPanel(
    mockTheme,
    { hasUI: true } as unknown as ExtensionContext,
    {
      fetchStatus: async () => initialStatus,
      fetchVoices: async () => [
        { name: "Microsoft Sabina Desktop", culture: "es-MX", gender: "Female" },
      ],
      sendAction: async () => initialStatus,
      ensureDaemon: async () => true,
      isSoundOn: () => true,
      toggleSound: () => false,
      dictateNow: async () => {},
      getParagraphInfo: () => ({ current: 0, total: 3 }),
    },
    () => {
      closed = true;
    },
    () => {},
    initialStatus,
    [{ name: "Microsoft Sabina Desktop", culture: "es-MX", gender: "Female" }],
  );

  const linesControl = panel.render(84).join("\n");
  assert.ok(linesControl.includes("TTS Monitor & Asistente"));
  assert.ok(linesControl.includes("Sabina"));
  assert.ok(linesControl.includes("Auto-read:"));

  // Tab -> Voices
  panel.handleInput("\t");
  const linesVoices = panel.render(84).join("\n");
  assert.ok(linesVoices.includes("Microsoft Sabina Desktop"));
  assert.ok(linesVoices.includes("[ACTIVA]"));

  // Tab -> Shortcuts
  panel.handleInput("\t");
  const linesShortcuts = panel.render(84).join("\n");
  assert.ok(linesShortcuts.includes("Alt+U"));
  assert.ok(linesShortcuts.includes("Alt+V"));
  assert.ok(!linesShortcuts.includes("Alt+←"));
  assert.ok(!linesShortcuts.includes("Alt+→"));

  // Close with q
  panel.handleInput("q");
  assert.equal(closed, true);
});

test("dcTtsExtension registers /dc-tts command, shortcuts, and prevents duplicate registration", () => {
  const commands = new Map<string, any>();
  const shortcuts = new Map<string, any>();
  const events = new Map<string, Function[]>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerShortcut(key: string, def: any) {
      shortcuts.set(key, def);
    },
    on(ev: string, fn: Function) {
      if (!events.has(ev)) events.set(ev, []);
      events.get(ev)!.push(fn);
    },
  } as unknown as ExtensionAPI;

  dcTtsExtension(mockPi);
  // Second call must be no-op thanks to idempotency symbol
  dcTtsExtension(mockPi);

  assert.ok(commands.has("dc-tts"));
  assert.ok(shortcuts.has("alt+u"));
  assert.ok(shortcuts.has("alt+p"));
  assert.ok(shortcuts.has("alt+,"));
  assert.ok(shortcuts.has("alt+."));
  assert.ok(shortcuts.has("alt+r"));
  assert.ok(shortcuts.has("alt+x"));
  assert.ok(shortcuts.has("alt+v"));
  assert.equal(events.get("agent_settled")?.length, 1);
});
