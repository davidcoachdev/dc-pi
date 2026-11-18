import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  leaseTaxi,
  releaseTaxi,
  acquireOrchestratorTaxi,
  leaseAvailableTaxis,
  loadFleetState,
  saveFleetState,
  selectNextCycleTaxi,
} from "../src/features/dc-agents/core/dc-taxi-dispatcher.ts";
import {
  isVipAccount,
  VIP_ACCOUNTS,
  DEFAULT_VIP_ACCOUNTS,
} from "../src/features/dc-agents/core/dc-taxi-accounts.ts";
import type { DcTaxiFleetState, DcTaxiUnit } from "../src/features/dc-agents/core/dc-ephemeral-types.ts";

test("dc-taxi-vip: isVipAccount reconoce correctamente cuentas VIP de CC y UC, y rechaza nan", () => {
  assert.equal(isVipAccount("cc1"), true);
  assert.equal(isVipAccount("cc4"), true);
  assert.equal(isVipAccount("uc01"), true);
  assert.equal(isVipAccount("nan-01"), false);
  assert.equal(isVipAccount("nan-02"), false);
  assert.equal(isVipAccount("nan"), false);
  assert.equal(isVipAccount("ac01"), false);
  assert.equal(isVipAccount("ac50"), false);
  assert.equal(isVipAccount(undefined), false);

  assert.ok(DEFAULT_VIP_ACCOUNTS.includes("cc1"));
  assert.ok(DEFAULT_VIP_ACCOUNTS.includes("uc01"));
  assert.ok(!DEFAULT_VIP_ACCOUNTS.includes("nan-01"));
});

test("dc-taxi-cycle: rotación estricta sin repetición en flota pequeña (3 taxis)", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-taxi-cycle-test-"));
  const fleetPath = path.join(tmpDir, "dc-taxis.json");

  try {
    const state: DcTaxiFleetState = {
      fleet: {
        ac01: { account: "ac01", status: "libre", tier: "standard", passenger: null },
        ac02: { account: "ac02", status: "libre", tier: "standard", passenger: null },
        ac03: { account: "ac03", status: "libre", tier: "standard", passenger: null },
      },
      lastUpdated: Date.now(),
      cycleDispatched: [],
    };
    saveFleetState(state, fleetPath);

    // Asignación 1
    const t1 = leaseTaxi(
      { type: "subagent", sessionId: "s1", pid: process.pid },
      undefined,
      fleetPath,
      undefined,
      ["ac01", "ac02", "ac03"],
    );
    assert.ok(t1);
    releaseTaxi(t1.account, "s1", fleetPath, ["ac01", "ac02", "ac03"]);

    // Asignación 2
    const t2 = leaseTaxi(
      { type: "subagent", sessionId: "s2", pid: process.pid },
      undefined,
      fleetPath,
      undefined,
      ["ac01", "ac02", "ac03"],
    );
    assert.ok(t2);
    assert.notEqual(t2.account, t1.account, "El segundo taxi debe ser diferente al primero");
    releaseTaxi(t2.account, "s2", fleetPath, ["ac01", "ac02", "ac03"]);

    // Asignación 3
    const t3 = leaseTaxi(
      { type: "subagent", sessionId: "s3", pid: process.pid },
      undefined,
      fleetPath,
      undefined,
      ["ac01", "ac02", "ac03"],
    );
    assert.ok(t3);
    assert.notEqual(t3.account, t1.account);
    assert.notEqual(t3.account, t2.account);
    releaseTaxi(t3.account, "s3", fleetPath, ["ac01", "ac02", "ac03"]);

    const assigned = new Set([t1.account, t2.account, t3.account]);
    assert.equal(assigned.size, 3, "Los 3 taxis deben haberse asignado sin repetir");

    // Asignación 4: Ronda completada -> debe auto-resetear y asignar limpiamente
    const t4 = leaseTaxi(
      { type: "subagent", sessionId: "s4", pid: process.pid },
      undefined,
      fleetPath,
      undefined,
      ["ac01", "ac02", "ac03"],
    );
    assert.ok(t4);
    assert.ok(["ac01", "ac02", "ac03"].includes(t4.account));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-taxi-cycle: exclusión rigurosa de averiadas (en_taller), recargando y ocupadas", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-taxi-damaged-test-"));
  const fleetPath = path.join(tmpDir, "dc-taxis.json");

  try {
    const state: DcTaxiFleetState = {
      fleet: {
        ac01: { account: "ac01", status: "libre", tier: "standard", passenger: null },
        ac02: {
          account: "ac02",
          status: "en_taller",
          tier: "standard",
          passenger: null,
          workshopReason: "Error 429 persistente",
        },
        ac03: { account: "ac03", status: "recargando", tier: "standard", passenger: null },
        ac04: {
          account: "ac04",
          status: "ocupado",
          tier: "standard",
          passenger: {
            type: "subagent",
            sessionId: "active-sess",
            pid: process.pid,
            startedAt: Date.now(),
            heartbeatAt: Date.now(),
          },
        },
        ac05: { account: "ac05", status: "libre", tier: "standard", passenger: null },
      },
      lastUpdated: Date.now(),
      cycleDispatched: [],
    };
    saveFleetState(state, fleetPath);

    // Solo ac01 y ac05 están libres. ac02 (taller), ac03 (recargando), ac04 (ocupado) deben ser ignorados.
    const t1 = leaseTaxi(
      { type: "subagent", sessionId: "s1", pid: process.pid },
      undefined,
      fleetPath,
      undefined,
      ["ac01", "ac02", "ac03", "ac04", "ac05"],
    );
    assert.ok(t1);
    assert.ok(t1.account === "ac01" || t1.account === "ac05");
    releaseTaxi(t1.account, "s1", fleetPath, ["ac01", "ac02", "ac03", "ac04", "ac05"]);

    const t2 = leaseTaxi(
      { type: "subagent", sessionId: "s2", pid: process.pid },
      undefined,
      fleetPath,
      undefined,
      ["ac01", "ac02", "ac03", "ac04", "ac05"],
    );
    assert.ok(t2);
    assert.ok(t2.account === "ac01" || t2.account === "ac05");
    assert.notEqual(t2.account, t1.account);
    releaseTaxi(t2.account, "s2", fleetPath, ["ac01", "ac02", "ac03", "ac04", "ac05"]);

    // En la 3ª asignación, se resetea la ronda. ac02 sigue en taller, ac03 recargando y ac04 ocupado.
    // Solo ac01 y ac05 pueden ser elegidas de nuevo en el nuevo ciclo.
    const t3 = leaseTaxi(
      { type: "subagent", sessionId: "s3", pid: process.pid },
      undefined,
      fleetPath,
      undefined,
      ["ac01", "ac02", "ac03", "ac04", "ac05"],
    );
    assert.ok(t3);
    assert.ok(t3.account === "ac01" || t3.account === "ac05", "No debe tocar la unidad en taller ni recargando");
    assert.notEqual(t3.account, "ac02");
    assert.notEqual(t3.account, "ac03");
    assert.notEqual(t3.account, "ac04");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-taxi-cycle: rotación completa en 50 taxis (ac01..ac50) sin repetir", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-taxi-50-test-"));
  const fleetPath = path.join(tmpDir, "dc-taxis.json");

  try {
    const fleet: Record<string, DcTaxiUnit> = {};
    const accounts: string[] = [];
    for (let i = 1; i <= 50; i++) {
      const ac = `ac${String(i).padStart(2, "0")}`;
      accounts.push(ac);
      fleet[ac] = {
        account: ac,
        status: "libre",
        tier: "standard",
        passenger: null,
      };
    }

    const state: DcTaxiFleetState = {
      fleet,
      lastUpdated: Date.now(),
      cycleDispatched: [],
    };
    saveFleetState(state, fleetPath);

    const dispatchedInRound: string[] = [];

    // Ejecutar 50 arrendamientos sucesivos con liberación inmediata
    for (let i = 0; i < 50; i++) {
      const leased = leaseTaxi(
        { type: "subagent", sessionId: `task-${i}`, pid: process.pid },
        undefined,
        fleetPath,
        undefined,
        accounts,
      );
      assert.ok(leased, `Debe asignar un taxi en el turno ${i}`);
      assert.ok(
        !dispatchedInRound.includes(leased.account),
        `El taxi ${leased.account} se repitió en el turno ${i} antes de agotar la ronda`,
      );
      dispatchedInRound.push(leased.account);

      // Liberar para que quede libre para la siguiente ronda, pero ya consumido en esta ronda
      releaseTaxi(leased.account, `task-${i}`, fleetPath, accounts);
    }

    assert.equal(dispatchedInRound.length, 50);
    const uniqueAccounts = new Set(dispatchedInRound);
    assert.equal(uniqueAccounts.size, 50, "Las 50 unidades ac01..ac50 fueron utilizadas exactamente una vez");

    // Turno 51: auto-reset del ciclo
    const leased51 = leaseTaxi(
      { type: "subagent", sessionId: "task-51", pid: process.pid },
      undefined,
      fleetPath,
      undefined,
      accounts,
    );
    assert.ok(leased51);
    assert.ok(accounts.includes(leased51.account));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-taxi-vip: VIPs (cc1, cc2) están estrictamente aisladas del ciclo estándar", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-taxi-cc-vip-test-"));
  const fleetPath = path.join(tmpDir, "dc-taxis.json");

  try {
    const state: DcTaxiFleetState = {
      fleet: {
        ac01: {
          account: "ac01",
          status: "ocupado",
          tier: "standard",
          passenger: {
            type: "subagent",
            sessionId: "sess-busy",
            pid: process.pid,
            startedAt: Date.now(),
            heartbeatAt: Date.now(),
          },
        },
        cc1: { account: "cc1", status: "libre", tier: "vip", passenger: null },
        cc2: { account: "cc2", status: "libre", tier: "vip", passenger: null },
      },
      lastUpdated: Date.now(),
      cycleDispatched: [],
    };
    saveFleetState(state, fleetPath);

    // 1. Subagente nunca puede arrendar cc1 o cc2
    const leasedSubagent = leaseTaxi(
      { type: "subagent", sessionId: "sub-1", pid: process.pid },
      undefined,
      fleetPath,
      undefined,
      ["ac01", "cc1", "cc2"],
    );
    assert.equal(leasedSubagent, null, "Subagente no debe tener acceso a cc1 ni cc2");

    // 2. Orquestador en startup o balanceo automático NUNCA adquiere cc1
    const autoOrch = acquireOrchestratorTaxi(
      "orch-sess-1",
      "cpam/ac01/gemini-3.8-flash-high",
      fleetPath,
      process.pid,
      ["ac01", "cc1", "cc2"],
    );
    assert.equal(autoOrch, null, "Orquestador sin selección explícita jamás debe tomar unidades vip");

    // 3. Orquestador con selección explícita de modelo cc1 SÍ adquiere cc1
    const explicitOrch = acquireOrchestratorTaxi(
      "orch-sess-1",
      "cc1/gpt-6-luna",
      fleetPath,
      process.pid,
      ["ac01", "cc1", "cc2"],
      undefined,
      undefined,
      undefined,
      { isExplicitSelection: true },
    );
    assert.ok(explicitOrch);
    assert.equal(explicitOrch.account, "cc1");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-taxi-cycle: leaseAvailableTaxis respeta el ciclo y auto-resetea a mitad de lote si es necesario", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-taxi-batch-test-"));
  const fleetPath = path.join(tmpDir, "dc-taxis.json");

  try {
    const state: DcTaxiFleetState = {
      fleet: {
        ac01: { account: "ac01", status: "libre", tier: "standard", passenger: null },
        ac02: { account: "ac02", status: "libre", tier: "standard", passenger: null },
        ac03: { account: "ac03", status: "libre", tier: "standard", passenger: null },
      },
      lastUpdated: Date.now(),
      // ac01 ya fue usado en este ciclo; solo quedan ac02 y ac03 disponibles en esta ronda
      cycleDispatched: ["ac01"],
    };
    saveFleetState(state, fleetPath);

    // Pedir lote de 3 taxis para un swarm
    const leased = leaseAvailableTaxis(
      3,
      (idx) => ({
        type: "subagent",
        sessionId: `swarm-${idx}`,
        pid: process.pid,
      }),
      fleetPath,
      undefined,
      ["ac01", "ac02", "ac03"],
    );

    assert.equal(leased.length, 3, "Debe arrendar 3 taxis");
    const leasedAccounts = leased.map((u) => u.account);
    // Deben ser ac02, ac03 y ac01 (tras el auto-reset)
    assert.ok(leasedAccounts.includes("ac02"));
    assert.ok(leasedAccounts.includes("ac03"));
    assert.ok(leasedAccounts.includes("ac01"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
