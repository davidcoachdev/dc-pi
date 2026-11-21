import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import * as os from "node:os";

import { DcControlSupervisorLifecycle } from "../src/features/dc-control/dc-control-lifecycle.ts";
import { DcControlDaemonHub } from "../src/features/dc-control/core/dc-control-daemon-hub.ts";
import { DcSessionRegistry } from "../src/features/dc-control/core/dc-session-registry.ts";

test("DcControlSupervisorLifecycle - onSessionStart conecta y envía turn_start/turn_end/close", async () => {
  const tmpPrefix = path.join(os.tmpdir(), `test-life-${Date.now()}`);
  const socketPath = `${tmpPrefix}.sock`;
  const pidPath = `${tmpPrefix}.pid`;

  const hub = new DcControlDaemonHub({ socketPath, pidPath });
  await hub.start();

  const lifecycle = new DcControlSupervisorLifecycle();
  // Sobrescribir socketPath para la prueba
  (lifecycle as any).launcher = {
    ensureDaemonRunning: async () => true,
  };

  const fakeCtx: any = {
    cwd: "/home/dc-studio/dc-lab/lab-lifecycle-test",
    sessionManager: {
      getSessionId: () => "sess-lifecycle-test-1",
    },
    model: {
      provider: "google",
      id: "gemini-3.8-flash-high",
    },
  };

  // Simular arranque de sesión
  await lifecycle.onSessionStart(fakeCtx);
  const client = (lifecycle as any).client;
  // Conectar con el socketPath del test
  (client as any).socketPath = socketPath;
  const connected = await client.connect();
  assert.equal(connected, true);

  await new Promise((r) => setTimeout(r, 40));

  // Simular turn_start y turn_end
  lifecycle.onTurnStart("Analizando código");
  lifecycle.onTurnEnd();

  // Simular session_close
  lifecycle.onSessionClose();
  assert.equal(lifecycle.getIpcClient(), undefined);

  await hub.stop();
});
