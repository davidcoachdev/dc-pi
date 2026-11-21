import test from "node:test";
import assert from "node:assert/strict";
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
