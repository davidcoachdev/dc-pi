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
