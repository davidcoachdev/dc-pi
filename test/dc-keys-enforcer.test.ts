import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { enforceKeybindings } from "../src/features/dc-keys/dc-keys-enforcer.ts";

test("enforceKeybindings configures cursorWordLeft and cursorWordRight without alt+b or alt+f", () => {
  const tmpDir = path.join(os.tmpdir(), `dc-keys-enforcer-test-${Date.now()}`);
  const tmpFile = path.join(tmpDir, "keybindings.json");

  try {
    // 1. Archivo inexistente -> crea y configura ambos atajos
    const updated1 = enforceKeybindings(tmpFile);
    assert.equal(updated1, true);

    const cfg1 = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
    assert.deepEqual(cfg1["tui.editor.cursorWordLeft"], ["alt+left", "ctrl+left"]);
    assert.deepEqual(cfg1["tui.editor.cursorWordRight"], ["alt+right", "ctrl+right"]);
    assert.equal(cfg1["app.message.dequeue"], "alt+up");

    // 2. Archivo ya configurado -> no hace cambios innecesarios
    const updated2 = enforceKeybindings(tmpFile);
    assert.equal(updated2, false);

    // 3. Archivo con conflicto explícito de alt+b
    fs.writeFileSync(tmpFile, JSON.stringify({ "tui.editor.cursorWordLeft": "alt+b" }), "utf8");
    const updated3 = enforceKeybindings(tmpFile);
    assert.equal(updated3, true);

    const cfg3 = JSON.parse(fs.readFileSync(tmpFile, "utf8"));
    assert.deepEqual(cfg3["tui.editor.cursorWordLeft"], ["alt+left", "ctrl+left"]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("resolveKeybindingsPath and enforceKeybindings honor PI_CODING_AGENT_DIR and write atomically", async () => {
  const { resolveKeybindingsPath } = await import("../src/features/dc-keys/dc-keys-enforcer.ts");
  const tmpAgentDir = path.join(os.tmpdir(), `dc-keys-agent-dir-${Date.now()}`);
  fs.mkdirSync(tmpAgentDir, { recursive: true });
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  const prevKeybindingsPath = process.env.PI_KEYBINDINGS_PATH;

  try {
    delete process.env.PI_KEYBINDINGS_PATH;
    process.env.PI_CODING_AGENT_DIR = tmpAgentDir;

    const resolved = resolveKeybindingsPath();
    assert.equal(resolved, path.join(tmpAgentDir, "keybindings.json"));

    const updated = enforceKeybindings();
    assert.equal(updated, true);
    assert.ok(fs.existsSync(resolved));

    const entries = fs.readdirSync(tmpAgentDir);
    assert.ok(!entries.some((e) => e.endsWith(".tmp")), "No temporary files should remain after atomic write");
  } finally {
    if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    if (prevKeybindingsPath === undefined) delete process.env.PI_KEYBINDINGS_PATH;
    else process.env.PI_KEYBINDINGS_PATH = prevKeybindingsPath;
    fs.rmSync(tmpAgentDir, { recursive: true, force: true });
  }
});
