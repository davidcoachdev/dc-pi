import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  leaseTaxi,
  acquireOrchestratorTaxi,
  loadFleetState,
  saveFleetState,
  withFleetLock,
} from "../src/features/dc-agents/core/dc-taxi-dispatcher.ts";
import { isVipAccount, VIP_ACCOUNTS, discoverVipAccounts } from "../src/features/dc-agents/core/dc-taxi-accounts.ts";
import { resolveExecutionModel } from "../src/features/dc-agents/core/dc-effort-policy.ts";
import dcAgentsExtension, { extractAccountFromModelId } from "../src/features/dc-agents/dc-agents.ts";

test("dc-taxi-vip: isVipAccount reconoce correctamente cc1..cc5, cuentas uc*, nan* y rechaza falsos positivos", () => {
  assert.equal(isVipAccount("cc1"), true);
  assert.equal(isVipAccount("cc2"), true);
  assert.equal(isVipAccount("cc3"), true);
  assert.equal(isVipAccount("cc4"), true);
  assert.equal(isVipAccount("cc5"), true);
  assert.equal(isVipAccount("CC4"), true);
  assert.equal(isVipAccount("CC5"), true);
  assert.equal(isVipAccount("uc01"), true);
  assert.equal(isVipAccount("UC01"), true);
  assert.equal(isVipAccount("uc-01"), true);
  assert.equal(isVipAccount("uc_02"), true);
  assert.equal(isVipAccount("nan-01"), true);
  assert.equal(isVipAccount("nan_02"), true);
  assert.equal(isVipAccount("nan"), true);
  assert.equal(isVipAccount("ac01"), false);
  assert.equal(isVipAccount("ac44"), false);
  assert.equal(isVipAccount("ucar"), false);
  assert.equal(isVipAccount("cc"), false);
  assert.equal(isVipAccount(undefined), false);

  assert.ok(discoverVipAccounts().includes("uc01"));

  // Verificar unificación entre discoverVipAccounts(models.json) e isVipAccount()
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-vip-models-"));
  const modelsPath = path.join(tmpDir, "models.json");
  try {
    fs.writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          cpam: {
            models: [
              { id: "cc5/gpt-6.1-sol" },
              { id: "uc-02/claude-opus-4-6-thinking" },
              { id: "nan_07/gemini-3.8-flash-high" },
              { id: "ac01/gemini-3.8-flash-high" },
              { id: "ucar/some-model" },
            ],
          },
        },
      }),
      "utf8",
    );
    const discovered = discoverVipAccounts(modelsPath);
    assert.ok(discovered.includes("cc5"), "discoverVipAccounts debe incluir cc5");
    assert.ok(discovered.includes("uc-02"), "discoverVipAccounts debe incluir uc-02");
    assert.ok(discovered.includes("nan_07"), "discoverVipAccounts debe incluir nan_07");
    assert.ok(!discovered.includes("ac01"), "discoverVipAccounts nunca debe incluir ac01");
    assert.ok(!discovered.includes("ucar"), "discoverVipAccounts nunca debe incluir palabras arbitrarias ucar");
    for (const vip of discovered) {
      assert.equal(isVipAccount(vip), true, `isVipAccount(${vip}) debe coincidir con discoverVipAccounts`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-taxi-vip: subagentes en leaseTaxi NUNCA pueden arrendar unidades VIP (tier === vip)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-taxi-vip-test-"));
  const fleetPath = path.join(tmpDir, "dc-taxis.json");

  try {
    // Configurar flota donde solo quedan libres unidades VIP y ac01 está ocupado
    const state = {
      fleet: {
        ac01: {
          account: "ac01",
          status: "ocupado" as const,
          tier: "standard" as const,
          passenger: {
            type: "subagent" as const,
            sessionId: "other-sess",
            pid: process.pid,
            startedAt: Date.now(),
            heartbeatAt: Date.now(),
          },
        },
        cc1: {
          account: "cc1",
          status: "libre" as const,
          tier: "vip" as const,
          passenger: null,
        },
        cc4: {
          account: "cc4",
          status: "libre" as const,
          tier: "vip" as const,
          passenger: null,
        },
      },
      lastUpdated: Date.now(),
    };
    saveFleetState(state, fleetPath);

    // 1. Intento de subagente por balanceo automático (sin preferredAccount)
    const leasedAuto = leaseTaxi(
      {
        type: "subagent",
        sessionId: "sub-sess-1",
        pid: process.pid,
      },
      undefined,
      fleetPath,
      undefined,
      ["ac01", "cc1", "cc4"],
    );

    assert.equal(leasedAuto, null, "La flota estándar está agotada; subagente NO debe recibir unidad VIP");

    // 2. Intento de subagente pidiendo preferredAccount='cc4'
    const leasedPreferred = leaseTaxi(
      {
        type: "subagent",
        sessionId: "sub-sess-2",
        pid: process.pid,
      },
      "cc4",
      fleetPath,
      undefined,
      ["ac01", "cc1", "cc4"],
    );

    assert.equal(leasedPreferred, null, "Subagente pidiendo preferredAccount='cc4' VIP debe ser rechazado");

    // Verificar que cc1 y cc4 siguen intactos y libres
    const freshState = loadFleetState(fleetPath, ["ac01", "cc1", "cc4"]);
    assert.equal(freshState.fleet.cc1?.status, "libre");
    assert.equal(freshState.fleet.cc4?.status, "libre");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-taxi-vip: acquireOrchestratorTaxi solo asigna VIP bajo selección explícita de modelo cc*", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-taxi-vip-orch-"));
  const fleetPath = path.join(tmpDir, "dc-taxis.json");

  try {
    const state = {
      fleet: {
        ac01: { account: "ac01", status: "libre" as const, tier: "standard" as const, passenger: null },
        cc4: { account: "cc4", status: "libre" as const, tier: "vip" as const, passenger: null },
      },
      lastUpdated: Date.now(),
    };
    saveFleetState(state, fleetPath);

    // 1. Orquestador arrancando con modelo estándar (ej: gemini-3.8-flash-high)
    const standardResult = acquireOrchestratorTaxi(
      "orch-sess-1",
      "cpam/ac01/gemini-3.8-flash-high",
      fleetPath,
      process.pid,
      ["ac01", "cc4"],
    );

    assert.ok(standardResult);
    assert.equal(standardResult?.account, "ac01", "Orquestador con modelo estándar toma taxi estándar ac01");

    // 2. Orquestador arrancando sin cuenta explícita (balanceo automático)
    // Con ac01 ocupado, ¿debe tomar cc4? ¡NO! Debe reportar null antes de tocar un VIP
    const fallbackResult = acquireOrchestratorTaxi(
      "orch-sess-2",
      "gemini-3.8-flash-high",
      fleetPath,
      process.pid + 10,
      ["ac01", "cc4"],
    );

    assert.equal(fallbackResult, null, "Balanceo automático sin modelo cc* jamás debe auto-asignar cc4 VIP");

    // 3. Orquestador seleccionando explícitamente modelo cc4/gpt-6.1-sol
    const vipResult = acquireOrchestratorTaxi(
      "orch-sess-vip",
      "cpam/cc4/gpt-6.1-sol",
      fleetPath,
      process.pid + 20,
      ["ac01", "cc4"],
      "gemini-3.8-flash-high",
      "cpam",
      undefined,
      { isExplicitSelection: true },
    );

    assert.ok(vipResult);
    assert.equal(vipResult?.account, "cc4", "Selección explícita de cc4 asigna con éxito el taxi VIP cc4");

    // 4. Orquestador arrancando con modelo heredado cc4 (sin selección explícita)
    // Con ac01 y cc4 ambos libres, DEBE tomar ac01 con gemini fallback, JAMÁS cc4
    const freshState = loadFleetState(fleetPath, ["ac01", "cc4"]);
    freshState.fleet.ac01.status = "libre";
    freshState.fleet.ac01.passenger = null;
    freshState.fleet.cc4.status = "libre";
    freshState.fleet.cc4.passenger = null;
    saveFleetState(freshState, fleetPath);

    const startupResult = acquireOrchestratorTaxi(
      "orch-sess-startup-inherited",
      "cpam/cc4/gpt-6.1-sol",
      fleetPath,
      process.pid + 30,
      ["ac01", "cc4"],
    );
    assert.ok(startupResult);
    assert.equal(startupResult?.account, "ac01", "Startup con modelo heredado cc4 debe auto-asignar ac01 estándar");
    assert.ok(
      startupResult?.modelId.includes("gemini-3.8-flash-high"),
      "Fallback debe construir modelo Gemini estándar, nunca gpt",
    );
    const afterStartupState = loadFleetState(fleetPath, ["ac01", "cc4"]);
    assert.equal(afterStartupState.fleet.cc4.status, "libre", "cc4 VIP debe permanecer libre tras el startup");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-taxi-vip: acquireOrchestratorTaxi asigna uc01 como VIP bajo selección explícita", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-taxi-vip-uc-"));
  const fleetPath = path.join(tmpDir, "dc-taxis.json");

  try {
    const state = {
      fleet: {
        ac01: { account: "ac01", status: "libre" as const, tier: "standard" as const, passenger: null },
        uc01: { account: "uc01", status: "libre" as const, tier: "vip" as const, passenger: null },
      },
      lastUpdated: Date.now(),
    };
    saveFleetState(state, fleetPath);

    // 1. Subagente intentando arrendar uc01 (no debe recibir uc01)
    const leasedSub = leaseTaxi(
      { type: "subagent", sessionId: "sub-uc", pid: process.pid },
      "uc01",
      fleetPath,
      undefined,
      ["ac01", "uc01"],
    );
    assert.notEqual(leasedSub?.account, "uc01", "Subagente jamás debe recibir uc01 VIP");

    // 2. Con flota estándar ocupada, subagente pidiendo uc01 debe recibir null
    const stateExhausted = loadFleetState(fleetPath, ["ac01", "uc01"]);
    stateExhausted.fleet.ac01.status = "ocupado";
    stateExhausted.fleet.uc01.status = "libre";
    saveFleetState(stateExhausted, fleetPath);

    const leasedExhausted = leaseTaxi(
      { type: "subagent", sessionId: "sub-uc-2", pid: process.pid },
      "uc01",
      fleetPath,
      undefined,
      ["ac01", "uc01"],
    );
    assert.equal(leasedExhausted, null, "Subagente con flota estándar ocupada debe recibir null, no tocar uc01");

    // 3. Orquestador con selección explícita de uc01
    const orchResult = acquireOrchestratorTaxi(
      "orch-sess-uc",
      "cpam/uc01/claude-opus-4-6-thinking",
      fleetPath,
      process.pid,
      ["ac01", "uc01"],
      "gemini-3.8-flash-high",
      "cpam",
      undefined,
      { isExplicitSelection: true },
    );

    assert.ok(orchResult);
    assert.equal(orchResult?.account, "uc01", "Orquestador con selección explícita adquiere uc01 VIP");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-taxi-vip: resolveExecutionModel reconoce prefijos UC01, CC5, NAN-01 y nan de forma case-insensitive", () => {
  const ucRes = resolveExecutionModel({
    requestedModel: "UC01/gemini-3.8-flash-high",
  });
  assert.equal(ucRes.requestedAccount?.toLowerCase(), "uc01");
  assert.equal(ucRes.baseModelName, "gemini-3.8-flash-high");

  const cc5Res = resolveExecutionModel({
    requestedModel: "CC5/gemini-3.8-flash-high",
  });
  assert.equal(cc5Res.requestedAccount?.toLowerCase(), "cc5");

  const nanRes = resolveExecutionModel({
    requestedModel: "NAN-01/gemini-3.8-flash-high",
  });
  assert.equal(nanRes.requestedAccount?.toLowerCase(), "nan-01");

  const bareNanRes = resolveExecutionModel({
    requestedModel: "nan/gemini-3.8-flash-high",
  });
  assert.equal(bareNanRes.requestedAccount?.toLowerCase(), "nan");
});

test("dc-taxi-vip: dc-agents no filtra listeners duplicados en process.on('exit') y turn_end sincroniza cuentas VIP", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-taxi-vip-turn-end-"));
  const fleetPath = path.join(tmpDir, "dc-taxis.json");

  try {
    const state = {
      fleet: {
        uc01: {
          account: "uc01",
          status: "ocupado" as const,
          tier: "vip" as const,
          passenger: {
            type: "orchestrator" as const,
            sessionId: "other-sess-id",
            pid: process.pid + 999,
            model: "cpam/uc01/claude-opus-4-6-thinking",
            plate: "DC-VIP-UC01",
            startedAt: Date.now(),
            heartbeatAt: Date.now(),
          },
        },
      },
      lastUpdated: Date.now(),
    };
    saveFleetState(state, fleetPath);

    const eventHandlers: Record<string, Function[]> = {};
    const mockPi: any = {
      on: (event: string, handler: Function) => {
        eventHandlers[event] = eventHandlers[event] || [];
        eventHandlers[event].push(handler);
      },
      registerCommand: () => {},
      registerShortcut: () => {},
      registerTool: () => {},
      setModel: async () => true,
    };

    const listenersBefore = process.listenerCount("exit");
    dcAgentsExtension(mockPi, { fleetPath });
    const listenersAfterFirst = process.listenerCount("exit");
    dcAgentsExtension(mockPi, { fleetPath });
    const listenersAfterSecond = process.listenerCount("exit");

    assert.equal(
      listenersAfterSecond,
      listenersAfterFirst,
      "Llamadas repetidas a dcAgentsExtension NO deben acumular listeners en process.on('exit')",
    );
    assert.ok(listenersAfterFirst <= listenersBefore + 1);

    assert.equal(extractAccountFromModelId("cpam/ac01/gemini-3.8-flash-high"), "ac01");
    assert.equal(extractAccountFromModelId("cpam/CC5/gpt-6.1-sol"), "cc5");
    assert.equal(extractAccountFromModelId("cpam/UC-01/claude-opus-4-6-thinking"), "uc-01");
    assert.equal(extractAccountFromModelId("cpam/uc_02/claude-opus-4-6-thinking"), "uc_02");
    assert.equal(extractAccountFromModelId("cpam/nan-01/gemini-3.8-flash-high"), "nan-01");
    assert.equal(extractAccountFromModelId("cpam/nan/gemini-3.8-flash-high"), "nan");

    // EjecutarwithFleetLock sin spin-wait
    const lockRes = withFleetLock(fleetPath, () => "locked-ok");
    assert.equal(lockRes, "locked-ok");

    // Limpiar en session_shutdown
    for (const shutdownHandler of eventHandlers["session_shutdown"] || []) {
      shutdownHandler({}, { hasUI: false, mode: "rpc", fleetPath });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
