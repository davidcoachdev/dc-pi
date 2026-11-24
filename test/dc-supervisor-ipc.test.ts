import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import * as os from "node:os";

import { DcSessionRegistry } from "../src/features/dc-control/core/dc-session-registry.ts";
import { DcSupervisorIpcServer } from "../src/features/dc-control/core/dc-supervisor-ipc-server.ts";
import { DcSupervisorIpcClient } from "../src/features/dc-control/core/dc-supervisor-ipc-client.ts";
import { dcSupervisorBus } from "../src/features/dc-control/core/dc-supervisor-bus.ts";

test("DcSupervisorIPC - Conexión, Handshake y Registro en tiempo real", async () => {
  const socketPath = path.join(os.tmpdir(), `test-dc-sup-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
  const registry = new DcSessionRegistry();
  const server = new DcSupervisorIpcServer({ socketPath, registry });

  await server.start();
  assert.equal(server.running, true);

  const client = new DcSupervisorIpcClient({
    sessionId: "session-orchestrator-1",
    role: "orchestrator",
    socketPath,
    cwd: "/home/dc-studio/dc-lab/lab-01",
    projectName: "lab-01",
    model: "gemini-3.8-flash-high",
  });

  let registeredAck = false;
  client.on("registered", (ack) => {
    if (ack.sessionId === "session-orchestrator-1") {
      registeredAck = true;
    }
  });

  const connected = await client.connect();
  assert.equal(connected, true);

  // Esperar propagación del handshake
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(registeredAck, true);

  const session = registry.getSession("session-orchestrator-1");
  assert.ok(session);
  assert.equal(session.sessionId, "session-orchestrator-1");
  assert.equal(session.projectName, "lab-01");
  assert.equal(session.model, "gemini-3.8-flash-high");

  client.disconnect();
  await server.stop();
});

test("DcSupervisorIPC - Solicitud de Takeover y entrega de Decisión Humana", async () => {
  const socketPath = path.join(os.tmpdir(), `test-dc-sup-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
  const registry = new DcSessionRegistry();
  const server = new DcSupervisorIpcServer({ socketPath, registry });

  await server.start();

  const client = new DcSupervisorIpcClient({
    sessionId: "super-agent-86",
    role: "super_agent_86",
    socketPath,
    cwd: "/home/dc-studio/dc-lab/dc-pi",
    projectName: "dc-pi",
  });

  await client.connect();
  await new Promise((r) => setTimeout(r, 30));

  let takeoverReceived = false;
  const onTakeover = (event: any) => {
    if (event.sessionId === "super-agent-86") {
      takeoverReceived = true;
    }
  };
  dcSupervisorBus.on("session:takeover_requested", onTakeover);

  let humanDecisionReceived: any;
  client.on("takeover_decision", (decision) => {
    humanDecisionReceived = decision;
  });

  // El superagente solicita intervención humana
  client.requestTakeover(
    "Freno manual ICE Gate",
    "Verificar eliminación de tablas",
    "¿Desea continuar con el rollback?",
    ["Continuar", "Cancelar"]
  );

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(takeoverReceived, true);
  assert.equal(registry.getSession("super-agent-86")?.state, "waiting_human");

  // El supervisor envía la decisión humana de vuelta
  server.sendToSession("super-agent-86", {
    type: "takeover_decision",
    sessionId: "super-agent-86",
    decision: "continue",
    selectedOption: "Continuar",
    instruction: "Adelante con la operación",
    timestamp: Date.now(),
  });

  await new Promise((r) => setTimeout(r, 50));
  assert.ok(humanDecisionReceived);
  assert.equal(humanDecisionReceived.decision, "continue");
  assert.equal(humanDecisionReceived.selectedOption, "Continuar");

  dcSupervisorBus.off("session:takeover_requested", onTakeover);
  client.disconnect();
  await server.stop();
});

test("DcSupervisorIPC - Comunicación entre pares (Peer Messaging) coordinada por dc-control", async () => {
  const socketPath = path.join(os.tmpdir(), `test-dc-sup-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
  const registry = new DcSessionRegistry();
  const server = new DcSupervisorIpcServer({ socketPath, registry });

  await server.start();

  const peerA = new DcSupervisorIpcClient({
    sessionId: "peer-a-orchestrator",
    role: "orchestrator",
    socketPath,
    cwd: "/home/dc-studio/lab-a",
  });

  const peerB = new DcSupervisorIpcClient({
    sessionId: "peer-b-worker",
    role: "worker",
    socketPath,
    cwd: "/home/dc-studio/lab-b",
  });

  await peerA.connect();
  await peerB.connect();
  await new Promise((r) => setTimeout(r, 50));

  let receivedMessageOnB: any;
  peerB.on("peer_message", (msg) => {
    receivedMessageOnB = msg;
  });

  // Peer A envía un mensaje dirigido exclusivamente a Peer B
  peerA.sendPeerMessage("shared_resource_lock", { resource: "sqlite-db", status: "locked" }, "peer-b-worker");

  await new Promise((r) => setTimeout(r, 50));
  assert.ok(receivedMessageOnB);
  assert.equal(receivedMessageOnB.fromSessionId, "peer-a-orchestrator");
  assert.equal(receivedMessageOnB.topic, "shared_resource_lock");
  assert.deepEqual(receivedMessageOnB.payload, { resource: "sqlite-db", status: "locked" });

  peerA.disconnect();
  peerB.disconnect();
  await server.stop();
});

test("DcSupervisorIPC - Cliente consulta y recibe sesiones activas conectadas en vivo", async () => {
  const socketPath = path.join(os.tmpdir(), `test-dc-sup-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
  const registry = new DcSessionRegistry();
  const server = new DcSupervisorIpcServer({ socketPath, registry });

  await server.start();

  const client1 = new DcSupervisorIpcClient({
    sessionId: "live-session-alpha",
    role: "orchestrator",
    socketPath,
    cwd: "/home/dc-studio/dc-lab/lab-alpha",
    projectName: "lab-alpha",
  });

  const client2 = new DcSupervisorIpcClient({
    sessionId: "live-session-beta",
    role: "worker",
    socketPath,
    cwd: "/home/dc-studio/dc-lab/lab-beta",
    projectName: "lab-beta",
  });

  await client1.connect();
  await client2.connect();
  await new Promise((r) => setTimeout(r, 60));

  const list = await client1.querySessions();
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 2);

  const alpha = list.find((s) => s.sessionId === "live-session-alpha");
  const beta = list.find((s) => s.sessionId === "live-session-beta");
  assert.ok(alpha);
  assert.equal(alpha?.projectName, "lab-alpha");
  assert.ok(beta);
  assert.equal(beta?.projectName, "lab-beta");

  client1.disconnect();
  client2.disconnect();
  await server.stop();
});

test("DcSupervisorIPC - Evento sessions_changed en tiempo real cuando un cliente se conecta y desconecta", async () => {
  const socketPath = path.join(os.tmpdir(), `test-dc-sup-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
  const registry = new DcSessionRegistry();
  const server = new DcSupervisorIpcServer({ socketPath, registry });

  await server.start();

  const listenerClient = new DcSupervisorIpcClient({
    sessionId: "listener-orchestrator",
    role: "orchestrator",
    socketPath,
    cwd: "/home/dc-studio/dc-lab/listener",
    projectName: "listener",
  });

  await listenerClient.connect();
  await new Promise((r) => setTimeout(r, 40));

  const eventsReceived: any[] = [];
  listenerClient.on("sessions_changed", (msg) => {
    eventsReceived.push(msg);
  });

  // Conectar un nuevo cliente dinámicamente
  const joiningClient = new DcSupervisorIpcClient({
    sessionId: "dynamic-peer-gamma",
    role: "worker",
    socketPath,
    cwd: "/home/dc-studio/dc-lab/gamma",
    projectName: "gamma",
  });

  await joiningClient.connect();
  await new Promise((r) => setTimeout(r, 50));

  // Verificar que listenerClient recibió la notificación de conexión
  const connectEvt = eventsReceived.find((e) => e.action === "connected" && e.sessionId === "dynamic-peer-gamma");
  assert.ok(connectEvt, "Debe recibir evento connected");
  assert.equal(connectEvt.role, "worker");

  // Desconectar el cliente
  joiningClient.disconnect();
  await new Promise((r) => setTimeout(r, 50));

  // Verificar que listenerClient recibió la notificación de desconexión
  const disconnectEvt = eventsReceived.find((e) => e.action === "disconnected" && e.sessionId === "dynamic-peer-gamma");
  assert.ok(disconnectEvt, "Debe recibir evento disconnected");

  listenerClient.disconnect();
  await server.stop();
});

test("DcSupervisorIPC - Permisos 0600 en socket Unix, 0600 en token y 0700 en directorio creado", async (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-ipc-perm-"));
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));

  const runtimeDir = path.join(baseDir, "runtime");
  const socketPath = path.join(runtimeDir, "supervisor.sock");
  const registry = new DcSessionRegistry();
  const server = new DcSupervisorIpcServer({ socketPath, registry });

  await server.start();
  t.after(async () => {
    await server.stop();
  });

  if (process.platform !== "win32") {
    assert.equal(fs.statSync(runtimeDir).mode & 0o777, 0o700, "Parent runtime dir must be 0700");
    assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600, "Unix socket must have mode 0600");
    assert.equal(fs.statSync(server.getTokenPath()).mode & 0o777, 0o600, "Token file must have mode 0600");
  }

  await server.stop();
  assert.equal(fs.existsSync(socketPath), false);
  assert.equal(fs.existsSync(server.getTokenPath()), false);
});

test("DcSupervisorIPC - Rechaza clientes sin token o con token inválido y previene spoofing de sessionId", async (t) => {
  const socketPath = path.join(os.tmpdir(), `test-dc-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
  const registry = new DcSessionRegistry();
  const server = new DcSupervisorIpcServer({
    socketPath,
    registry,
    authToken: "expected-ipc-secret-token",
  });

  await server.start();
  t.after(async () => {
    await server.stop();
  });

  // 1. Cliente legítimo con token válido
  const victim = new DcSupervisorIpcClient({
    sessionId: "victim-session",
    role: "orchestrator",
    socketPath,
    authToken: "expected-ipc-secret-token",
    cwd: "/tmp/victim",
  });
  let victimRegistered = false;
  victim.on("registered", () => {
    victimRegistered = true;
  });
  assert.equal(await victim.connect(), true);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(victimRegistered, true);
  assert.ok(registry.getSession("victim-session"));

  // 2. Cliente con token equivocado es rechazado
  const badClient = new DcSupervisorIpcClient({
    sessionId: "intruder-wrong-token",
    role: "worker",
    socketPath,
    authToken: "wrong-token",
    cwd: "/tmp/intruder",
  });
  const badErrors: any[] = [];
  badClient.on("auth_error", (err) => badErrors.push(err));
  await badClient.connect();
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(badErrors.length >= 1, "Debe recibir auth_error con token equivocado");
  assert.equal(registry.getSession("intruder-wrong-token"), undefined);
  assert.equal(badClient.connected, false);

  // 3. Socket crudo sin autenticación intenta mandar session_offline para victim-session -> rechazado
  const unauthResponses: any[] = [];
  await new Promise<void>((resolve) => {
    const raw = net.createConnection(socketPath, () => {
      raw.write(
        JSON.stringify({
          type: "session_offline",
          sessionId: "victim-session",
          reason: "spoofed kill",
          timestamp: Date.now(),
        }) + "\n",
      );
    });
    let buf = "";
    raw.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (const line of buf.split("\n").filter(Boolean)) {
        try {
          unauthResponses.push(JSON.parse(line));
        } catch {}
      }
    });
    raw.on("close", () => resolve());
    raw.on("error", () => resolve());
  });
  assert.ok(unauthResponses.some((m) => m.type === "auth_error"));
  assert.equal(registry.getSession("victim-session")?.state, "idle", "Sesión víctima no debe ser afectada");

  // 4. Socket autenticado como attacker-session intenta spoofear heartbeat/session_offline de victim-session
  const spoofResponses: any[] = [];
  await new Promise<void>((resolve) => {
    const raw = net.createConnection(socketPath, () => {
      raw.write(
        JSON.stringify({
          type: "session_online",
          sessionId: "attacker-session",
          authToken: "expected-ipc-secret-token",
          role: "worker",
          pid: process.pid,
          cwd: "/tmp/attacker",
          timestamp: Date.now(),
        }) + "\n",
      );
      raw.write(
        JSON.stringify({
          type: "heartbeat",
          sessionId: "victim-session",
          state: "waiting_human",
          timestamp: Date.now(),
        }) + "\n",
      );
    });
    let buf = "";
    raw.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) {
        if (!line.trim()) continue;
        try {
          spoofResponses.push(JSON.parse(line));
        } catch {}
      }
    });
    raw.on("close", () => resolve());
    raw.on("error", () => resolve());
  });

  assert.ok(
    spoofResponses.some((m) => m.type === "auth_error" && /spoof/i.test(m.reason)),
    "Debe rechazar spoofing de sessionId con auth_error",
  );
  assert.equal(registry.getSession("victim-session")?.state, "idle", "El estado de victim-session debe permanecer intacto");

  // Confirmar que victim-session sigue pudiendo recibir mensajes del servidor
  let receivedDecision = false;
  victim.on("takeover_decision", () => {
    receivedDecision = true;
  });
  assert.equal(
    server.sendToSession("victim-session", {
      type: "takeover_decision",
      sessionId: "victim-session",
      decision: "continue",
      timestamp: Date.now(),
    }),
    true,
  );
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(receivedDecision, true);

  victim.disconnect();
});

test("DcSupervisorIPC - Reconexión de sesión no es expulsada cuando se cierra el socket antiguo", async (t) => {
  const socketPath = path.join(os.tmpdir(), `test-dc-race-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
  const registry = new DcSessionRegistry();
  const server = new DcSupervisorIpcServer({ socketPath, registry });

  await server.start();
  t.after(async () => {
    await server.stop();
  });

  const observer = new DcSupervisorIpcClient({
    sessionId: "observer-session",
    role: "orchestrator",
    socketPath,
    cwd: "/tmp/observer",
  });
  await observer.connect();

  const disconnectEvents: any[] = [];
  observer.on("sessions_changed", (evt) => {
    if (evt.action === "disconnected") {
      disconnectEvents.push(evt);
    }
  });

  const oldClient = new DcSupervisorIpcClient({
    sessionId: "flaky-session",
    role: "worker",
    socketPath,
    cwd: "/tmp/flaky",
  });
  await oldClient.connect();
  await new Promise((r) => setTimeout(r, 40));

  // Reconectar misma sesión sobre un socket nuevo ANTES de que cierre el socket viejo
  const newClient = new DcSupervisorIpcClient({
    sessionId: "flaky-session",
    role: "worker",
    socketPath,
    cwd: "/tmp/flaky",
  });
  let newClientRegistered = false;
  newClient.on("registered", () => {
    newClientRegistered = true;
  });
  await newClient.connect();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(newClientRegistered, true);

  // Cerrar abruptamente el socket antiguo (dispara close en servidor)
  oldClient.disconnect();
  await new Promise((r) => setTimeout(r, 60));

  // La sesión reconectada NO debe haberse marcado terminada ni expulsada
  const session = registry.getSession("flaky-session");
  assert.ok(session);
  assert.notEqual(session.state, "terminated", "Cerrar socket antiguo no debe marcar terminada la sesión reconectada");
  assert.equal(
    disconnectEvents.some((e) => e.sessionId === "flaky-session"),
    false,
    "No debe emitir sessions_changed disconnected para la sesión reconectada",
  );

  let receivedOnNew = false;
  newClient.on("takeover_decision", () => {
    receivedOnNew = true;
  });
  assert.equal(
    server.sendToSession("flaky-session", {
      type: "takeover_decision",
      sessionId: "flaky-session",
      decision: "continue",
      timestamp: Date.now(),
    }),
    true,
  );
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(receivedOnNew, true, "El socket nuevo debe seguir recibiendo mensajes del servidor");

  newClient.disconnect();
  observer.disconnect();
});

test("DcSupervisorIPC - Buffer NDJSON acotado cierra el socket ante línea sobredimensionada sin salto de línea", async (t) => {
  const socketPath = path.join(os.tmpdir(), `test-dc-buf-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
  const registry = new DcSessionRegistry();
  const server = new DcSupervisorIpcServer({ socketPath, registry });

  await server.start();
  t.after(async () => {
    await server.stop();
  });

  // Enviar >256 KiB sin ningún '\n'
  const closedByServer = await new Promise<boolean>((resolve) => {
    const raw = net.createConnection(socketPath, () => {
      const oversized = Buffer.alloc(300 * 1024, 0x41); // 300 KiB de 'A' sin '\n'
      raw.write(oversized);
    });
    const timeout = setTimeout(() => {
      raw.destroy();
      resolve(false);
    }, 2000);
    timeout.unref?.();
    raw.on("close", () => {
      clearTimeout(timeout);
      resolve(true);
    });
    raw.on("error", () => {
      // EPIPE/ECONNRESET esperado cuando el servidor destruye el socket
    });
  });

  assert.equal(closedByServer, true, "El servidor debe destruir el socket cuando excede el límite NDJSON");
  assert.equal(server.running, true, "El servidor debe permanecer operativo tras cerrar el cliente abusivo");

  // Confirmar que un cliente legítimo todavía puede conectarse y registrarse
  const healthyClient = new DcSupervisorIpcClient({
    sessionId: "healthy-after-overflow",
    role: "worker",
    socketPath,
    cwd: "/tmp/healthy",
  });
  let acked = false;
  healthyClient.on("registered", () => {
    acked = true;
  });
  assert.equal(await healthyClient.connect(), true);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(acked, true);
  healthyClient.disconnect();
});


