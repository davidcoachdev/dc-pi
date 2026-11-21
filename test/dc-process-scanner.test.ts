import test from "node:test";
import assert from "node:assert/strict";
import { scanRunningPiProcesses } from "../src/features/dc-control/core/dc-process-scanner.ts";

test("scanRunningPiProcesses detecta el proceso actual de Node/Pi o retorna array válido", () => {
  const processes = scanRunningPiProcesses();
  assert.ok(Array.isArray(processes));
  // Si hay procesos vivos, validar su estructura
  for (const p of processes) {
    assert.equal(typeof p.pid, "number");
    assert.equal(typeof p.cwd, "string");
    assert.equal(typeof p.projectName, "string");
    assert.equal(typeof p.isCurrent, "boolean");
  }
});
