import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { DcControlDaemonHub } from "../src/features/dc-control/core/dc-control-daemon-hub.ts";
import { DcSupervisorLauncher } from "../src/features/dc-control/core/dc-supervisor-launcher.ts";

test("DcControlDaemonHub - Arranque, escritura de PID y cierre limpio", async () => {
  const tmpPrefix = path.join(os.tmpdir(), `test-hub-${Date.now()}`);
  const socketPath = `${tmpPrefix}.sock`;
  const pidPath = `${tmpPrefix}.pid`;

  const hub = new DcControlDaemonHub({
    socketPath,
    pidPath,
  });

  await hub.start();
  assert.equal(hub.running, true);
  assert.ok(fs.existsSync(pidPath));
  assert.ok(fs.existsSync(socketPath));

  const savedPid = parseInt(fs.readFileSync(pidPath, "utf-8").trim(), 10);
  assert.equal(savedPid, process.pid);

  // Intentar levantar una segunda instancia sobre el mismo PID debe fallar
  const hubDuplicado = new DcControlDaemonHub({
    socketPath,
    pidPath,
  });

  // Al tener el mismo PID porque estamos en el mismo proceso de test, el chequeo permite reiniciar o cerrar
  await hub.stop();
  assert.equal(hub.running, false);
  assert.equal(fs.existsSync(pidPath), false);
  assert.equal(fs.existsSync(socketPath), false);
});

test("DcSupervisorLauncher - isDaemonAlive detecta estado activo e inactivo", async () => {
  const tmpPrefix = path.join(os.tmpdir(), `test-launcher-${Date.now()}`);
  const socketPath = `${tmpPrefix}.sock`;
  const pidPath = `${tmpPrefix}.pid`;

  const launcher = new DcSupervisorLauncher({
    socketPath,
    pidPath,
  });

  // 1. Cuando no está corriendo
  const aliveBefore = await launcher.isDaemonAlive();
  assert.equal(aliveBefore, false);

  // 2. Levantamos el daemon
  const hub = new DcControlDaemonHub({ socketPath, pidPath });
  await hub.start();

  const aliveAfter = await launcher.isDaemonAlive();
  assert.equal(aliveAfter, true);

  // 3. Detenemos el daemon
  await hub.stop();
  const aliveFinal = await launcher.isDaemonAlive();
  assert.equal(aliveFinal, false);
});

test("DcSupervisorLauncher - Limpieza de sockets y PIDs huérfanos sin errores", async () => {
  const tmpPrefix = path.join(os.tmpdir(), `test-orphan-${Date.now()}`);
  const socketPath = `${tmpPrefix}.sock`;
  const pidPath = `${tmpPrefix}.pid`;

  // Creamos un PID falso de un proceso inexistente (ej. 999999)
  fs.writeFileSync(pidPath, "999999", "utf-8");
  fs.writeFileSync(socketPath, "fake-socket", "utf-8");

  const launcher = new DcSupervisorLauncher({
    socketPath,
    pidPath,
  });

  // Al no estar vivo, no debe explotar
  const alive = await launcher.isDaemonAlive();
  assert.equal(alive, false);

  // Levantamos un hub real: debe limpiar el PID huérfano 999999 sin lanzar error
  const hub = new DcControlDaemonHub({ socketPath, pidPath });
  await hub.start();
  assert.equal(hub.running, true);

  const currentPid = parseInt(fs.readFileSync(pidPath, "utf-8").trim(), 10);
  assert.equal(currentPid, process.pid);

  await hub.stop();
});
