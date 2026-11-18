import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  ensurePiDirProtected,
  writeHandoffNote,
  dcHandoffExtension,
} from "../src/features/dc-handoff/index.ts";

test("dc-handoff: ensurePiDirProtected creates .pi and .pi/.gitignore without overwriting custom rules", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-handoff-dir-"));
  try {
    const piDir = ensurePiDirProtected(tmpDir);
    assert.equal(piDir, path.join(tmpDir, ".pi"));
    const gitignorePath = path.join(piDir, ".gitignore");
    assert.equal(fs.existsSync(gitignorePath), true);
    assert.equal(fs.readFileSync(gitignorePath, "utf8"), "*\n!.gitignore\n");

    // Custom content is preserved on subsequent calls
    fs.writeFileSync(gitignorePath, "*\n!.gitignore\n!keep.md\n", "utf8");
    ensurePiDirProtected(tmpDir);
    assert.equal(fs.readFileSync(gitignorePath, "utf8"), "*\n!.gitignore\n!keep.md\n");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-handoff: writeHandoffNote writes restore command, metadata, and recent conversation tail", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-handoff-note-"));
  try {
    const mockCtx = {
      cwd: tmpDir,
      sessionManager: {
        getSessionFile: () => "/tmp/sessions/session-abc.jsonl",
        getSessionId: () => "session-abc",
        getEntries: () => [
          {
            type: "message",
            message: {
              role: "user",
              content: "Implementar el módulo de pagos con validación estricta.",
            },
          },
          {
            type: "message",
            message: {
              role: "assistant",
              content: [
                { type: "text", text: "Listo, agregué el validador y las pruebas unitarias correspondientes." },
              ],
            },
          },
        ],
      },
    } as unknown as ExtensionContext;

    const notePath = writeHandoffNote(mockCtx);
    assert.equal(notePath, path.join(tmpDir, ".pi", "handoff.md"));
    assert.ok(notePath && fs.existsSync(notePath));

    const content = fs.readFileSync(notePath, "utf8");
    assert.match(content, /pi --session "\/tmp\/sessions\/session-abc\.jsonl"/);
    assert.match(content, /\*\*Session ID:\*\* `session-abc`/);
    assert.match(content, /## Conversación Reciente|## Últimos Mensajes/);
    assert.match(content, /Implementar el módulo de pagos con validación estricta\./);
    assert.match(content, /Listo, agregué el validador y las pruebas unitarias correspondientes\./);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-handoff: dcHandoffExtension registers /dc-handoff and session_shutdown hook", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-handoff-ext-"));
  try {
    const commands: Record<string, (args: string, ctx: ExtensionContext) => Promise<void>> = {};
    const events: Record<string, (event: unknown, ctx: ExtensionContext) => void> = {};

    const mockPi = {
      registerCommand(name: string, def: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) {
        commands[name] = def.handler;
      },
      on(event: string, handler: (event: unknown, ctx: ExtensionContext) => void) {
        events[event] = handler;
      },
    } as unknown as ExtensionAPI;

    dcHandoffExtension(mockPi);

    assert.equal(typeof commands["dc-handoff"], "function");
    assert.equal(typeof events["session_shutdown"], "function");

    const mockCtx = {
      cwd: tmpDir,
      hasUI: false,
      sessionManager: {
        getSessionId: () => "shutdown-sess-42",
        getBranch: () => [
          { type: "message", message: { role: "user", content: "Cerrar sesión y guardar handoff" } },
        ],
      },
    } as unknown as ExtensionContext;

    await commands["dc-handoff"]!("", mockCtx);
    const handoffFile = path.join(tmpDir, ".pi", "handoff.md");
    assert.equal(fs.existsSync(handoffFile), true);
    assert.match(fs.readFileSync(handoffFile, "utf8"), /pi --session shutdown-sess-42/);
    assert.match(fs.readFileSync(handoffFile, "utf8"), /Cerrar sesión y guardar handoff/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
