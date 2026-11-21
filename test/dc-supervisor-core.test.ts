import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { dcSupervisorBus, type SupervisorSessionInfo } from "../src/features/dc-control/core/dc-supervisor-bus.ts";
import { DcSessionRegistry } from "../src/features/dc-control/core/dc-session-registry.ts";
import { DcSupervisorWatchdog } from "../src/features/dc-control/core/dc-supervisor-watchdog.ts";

test("DcSupervisorCore - Bus emite y recibe eventos desacoplados", async () => {
  let discovered: SupervisorSessionInfo | undefined;
  const onDiscovered = (s: SupervisorSessionInfo) => {
    discovered = s;
  };

  dcSupervisorBus.on("session:discovered", onDiscovered);

  const sampleSession: SupervisorSessionInfo = {
    sessionId: "test-session-123",
    cwd: "/home/dc-studio/dc-lab/lab-test",
    projectName: "lab-test",
    state: "idle",
    lastActivityAt: Date.now(),
    startedAt: Date.now(),
  };

  dcSupervisorBus.emitDiscovered(sampleSession);
  assert.equal(discovered?.sessionId, "test-session-123");
  assert.equal(discovered?.projectName, "lab-test");

  dcSupervisorBus.off("session:discovered", onDiscovered);
});

test("DcSessionRegistry - Escaneo seguro de sesiones sin symlinks y bounded read", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-supervisor-test-"));
  const encodedDir = path.join(tmpDir, "--home-dc-studio-test--");
  fs.mkdirSync(encodedDir, { recursive: true });

  // Crear archivo .jsonl de sesión válido
  const sessionFile = path.join(encodedDir, "2026-11-20T00-00-00-000Z_sess-abc.jsonl");
  const headerContent = JSON.stringify({
    type: "session",
    version: 3,
    id: "sess-abc",
    timestamp: new Date().toISOString(),
    cwd: "/home/dc-studio/test-project",
  }) + "\n" + JSON.stringify({ type: "message", role: "user", content: "hola" }) + "\n";

  fs.writeFileSync(sessionFile, headerContent, "utf-8");

  // Crear un symlink que debe ser ignorado por seguridad
  const symlinkTarget = path.join(encodedDir, "malicious-symlink.jsonl");
  try {
    fs.symlinkSync(sessionFile, symlinkTarget);
  } catch {
    // Si el entorno restringe symlinks, continuar
  }

  const registry = new DcSessionRegistry({
    sessionsBaseDir: tmpDir,
    activeThresholdMs: 60_000,
  });

  const discovered = await registry.scanSessions();
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].sessionId, "sess-abc");
  assert.equal(discovered[0].projectName, "test-project");
  assert.equal(discovered[0].cwd, "/home/dc-studio/test-project");

  // Limpieza
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("DcSupervisorWatchdog - Detección de sesiones colgadas (hung) e inactividad out-of-band", async () => {
  const registry = new DcSessionRegistry();
  const watchdog = new DcSupervisorWatchdog(registry, {
    hungThresholdMs: 10_000, // 10s para considerar colgado
    idleThresholdMs: 2_000,  // 2s para pasar a idle
  });

  const baseTime = Date.now();
  const session: SupervisorSessionInfo = {
    sessionId: "sess-busy-watchdog",
    cwd: "/home/dc-studio/dc-lab/dc-pi",
    state: "busy",
    lastActivityAt: baseTime,
    startedAt: baseTime,
  };

  registry.upsertSession(session);

  let hungEmitted = false;
  const onHung = () => {
    hungEmitted = true;
  };
  dcSupervisorBus.on("session:hung", onHung);

  // Tick 1: A los 3 segundos (supera idleThresholdMs pero no hung) -> debe pasar a idle
  await watchdog.evaluateSessions(baseTime + 3_000);
  assert.equal(registry.getSession("sess-busy-watchdog")?.state, "idle");
  assert.equal(hungEmitted, false);

  // Volvemos a poner la sesión en 'busy'
  watchdog.recordHeartbeat("sess-busy-watchdog", "busy", baseTime);

  // Tick 2: A los 12 segundos (supera hungThresholdMs) -> debe emitir hung
  const alerts = await watchdog.evaluateSessions(baseTime + 12_000);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].sessionId, "sess-busy-watchdog");
  assert.equal(hungEmitted, true);
  assert.equal(registry.getSession("sess-busy-watchdog")?.state, "hung");

  dcSupervisorBus.off("session:hung", onHung);
  watchdog.stop();
});
