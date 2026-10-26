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
} from "../src/features/dc-agents/core/dc-taxi-dispatcher.ts";
import { isVipAccount, VIP_ACCOUNTS } from "../src/features/dc-agents/core/dc-taxi-accounts.ts";

test("dc-taxi-vip: isVipAccount reconoce correctamente cc1..cc4", () => {
  assert.equal(isVipAccount("cc1"), true);
  assert.equal(isVipAccount("cc2"), true);
  assert.equal(isVipAccount("cc3"), true);
  assert.equal(isVipAccount("cc4"), true);
  assert.equal(isVipAccount("CC4"), true);
  assert.equal(isVipAccount("ac01"), false);
  assert.equal(isVipAccount("ac44"), false);
  assert.equal(isVipAccount(undefined), false);
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
    );

    assert.ok(vipResult);
    assert.equal(vipResult?.account, "cc4", "Selección explícita de cc4 asigna con éxito el taxi VIP cc4");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
