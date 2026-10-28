import os from "node:os";
import fs from "node:fs";
import path from "node:path";

// Isolate HOME before any package imports
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "dc-taxi-vip-home-"));
process.env.HOME = isolatedHome;

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acquireOrchestratorTaxi,
  loadFleetState,
  saveFleetState,
} from "../src/features/dc-agents/core/dc-taxi-dispatcher.ts";

test("startup inherited cc4: new Pi terminal starting up with inherited cc4 MUST acquire standard ac* taxi, NEVER VIP", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-startup-cc4-"));
  const fleetPath = path.join(tmpDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac44", "cc4"];
    const state = {
      fleet: {
        ac01: { account: "ac01", status: "libre" as const, tier: "standard" as const, passenger: null },
        ac44: { account: "ac44", status: "libre" as const, tier: "standard" as const, passenger: null },
        cc4: { account: "cc4", status: "libre" as const, tier: "vip" as const, passenger: null },
      },
      lastUpdated: Date.now(),
    };
    saveFleetState(state, fleetPath);

    // Startup of a new Pi instance: inherited model in ctx.model is cpam/cc4/gpt-6.1-sol
    // Default startup acquisition MUST NOT acquire cc4, even though cc4 is libre!
    const result = acquireOrchestratorTaxi(
      "new-startup-session",
      "cpam/cc4/gpt-6.1-sol",
      fleetPath,
      process.pid + 100,
      customAccounts,
    );

    assert.ok(result, "Startup acquisition should find a free standard unit");
    assert.notEqual(result.account, "cc4", "Startup acquisition must NEVER acquire cc4 (VIP)");
    assert.ok(
      result.account === "ac01" || result.account === "ac44",
      `Acquired account must be standard ac* (got ${result.account})`,
    );
    // Crucial: fallback modelId must be a valid standard Gemini model, NOT acXX/gpt...
    assert.ok(
      result.modelId.includes("gemini-3.8-flash-high"),
      `Model ID must be a standard Gemini fallback, got: ${result.modelId}`,
    );
    assert.ok(!result.modelId.includes("gpt"), `Model ID must not preserve gpt on standard account: ${result.modelId}`);

    // Verify cc4 in fleet remains untouched (libre)
    const freshState = loadFleetState(fleetPath, customAccounts);
    assert.equal(freshState.fleet.cc4?.status, "libre", "VIP unit cc4 must remain libre");
    assert.equal(freshState.fleet[result.account]?.status, "ocupado");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("exact busy rejection unchanged fleet: explicit cc4 selection when busy must reject and NOT release existing reservation", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-busy-cc4-"));
  const fleetPath = path.join(tmpDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "cc1", "cc4"];
    const mySessionId = "sess-terminal-1";
    // Usamos el PID actual (vivo) para Terminal 2 para que el reaper no lo considere zombi
    const livePid = process.pid;

    // Terminal 1 actualmente ocupa ac01
    // Terminal 2 (proceso vivo) ocupa cc4
    // cc1 está libre (otra unidad VIP)
    const state = {
      fleet: {
        ac01: {
          account: "ac01",
          status: "ocupado" as const,
          tier: "standard" as const,
          passenger: {
            type: "orchestrator" as const,
            sessionId: mySessionId,
            pid: livePid,
            model: "cpam/ac01/gemini-3.8-flash-high",
            plate: `DC-HOST-${livePid}-t1`,
            startedAt: Date.now() - 5000,
            heartbeatAt: Date.now(),
          },
        },
        cc1: { account: "cc1", status: "libre" as const, tier: "vip" as const, passenger: null },
        cc4: {
          account: "cc4",
          status: "ocupado" as const,
          tier: "vip" as const,
          passenger: {
            type: "orchestrator" as const,
            sessionId: "other-terminal-sess",
            pid: livePid,
            model: "cpam/cc4/gpt-6.1-sol",
            plate: `DC-HOST-${livePid}-t2`,
            startedAt: Date.now() - 10000,
            heartbeatAt: Date.now(),
          },
        },
      },
      lastUpdated: Date.now(),
    };
    saveFleetState(state, fleetPath);

    // Terminal 1 intenta selección manual explícita de cc4 (que está ocupada por Terminal 2)
    const result = acquireOrchestratorTaxi(
      mySessionId,
      "cpam/cc4/gpt-6.1-sol",
      fleetPath,
      livePid,
      customAccounts,
      "gemini-3.8-flash-high",
      "cpam",
      undefined,
      { isExplicitSelection: true },
    );

    // 1. Debe retornar null (rechazado, cc4 ocupada)
    assert.equal(result, null, "Explicit selection of busy cc4 must return null");

    // 2. Estado de la flota debe mantenerse intacto (inmutable)
    const freshState = loadFleetState(fleetPath, customAccounts);

    // ac01 NO debe ser liberado
    assert.equal(
      freshState.fleet.ac01?.status,
      "ocupado",
      "Terminal 1 existing reservation on ac01 must NOT be released when cc4 is busy",
    );
    assert.equal(freshState.fleet.ac01?.passenger?.sessionId, mySessionId);

    // cc1 NO debe ser asignado como sustituto
    assert.equal(freshState.fleet.cc1?.status, "libre", "Must not pool or substitute other VIP unit cc1");

    // cc4 sigue perteneciendo a Terminal 2
    assert.equal(freshState.fleet.cc4?.status, "ocupado");
    assert.equal(freshState.fleet.cc4?.passenger?.sessionId, "other-terminal-sess");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("explicit selection: explicit manual cc4 selection when free acquires cc4 and cleanly releases previous reservation", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-explicit-cc4-"));
  const fleetPath = path.join(tmpDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "cc4"];
    const mySessionId = "sess-terminal-1";
    const myPid = process.pid + 301;

    // Terminal 1 currently occupies ac01, cc4 is libre
    const state = {
      fleet: {
        ac01: {
          account: "ac01",
          status: "ocupado" as const,
          tier: "standard" as const,
          passenger: {
            type: "orchestrator" as const,
            sessionId: mySessionId,
            pid: myPid,
            model: "cpam/ac01/gemini-3.8-flash-high",
            plate: `DC-HOST-${myPid}-test`,
            startedAt: Date.now() - 5000,
            heartbeatAt: Date.now(),
          },
        },
        cc4: { account: "cc4", status: "libre" as const, tier: "vip" as const, passenger: null },
      },
      lastUpdated: Date.now(),
    };
    saveFleetState(state, fleetPath);

    // Terminal 1 explicitly selects cc4
    const result = acquireOrchestratorTaxi(
      mySessionId,
      "cpam/cc4/gpt-6.1-sol",
      fleetPath,
      myPid,
      customAccounts,
      "gemini-3.8-flash-high",
      "cpam",
      undefined,
      { isExplicitSelection: true },
    );

    assert.ok(result, "Explicit selection of free cc4 must succeed");
    assert.equal(result.account, "cc4");
    assert.equal(result.modelId, "cpam/cc4/gpt-6.1-sol");

    const freshState = loadFleetState(fleetPath, customAccounts);
    assert.equal(freshState.fleet.cc4?.status, "ocupado");
    assert.equal(freshState.fleet.cc4?.passenger?.sessionId, mySessionId);
    assert.equal(freshState.fleet.ac01?.status, "libre", "Previous reservation ac01 must be released");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("automatic failover: auto-handover / failover must exclude VIP and construct valid Gemini fallback", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-failover-"));
  const fleetPath = path.join(tmpDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02", "cc4"];
    const mySessionId = "sess-terminal-failover";
    const myPid = process.pid + 401;

    // Terminal was on ac01, but ac01 failed and is excluded; ac02 and cc4 are libre
    const state = {
      fleet: {
        ac01: { account: "ac01", status: "ocupado" as const, tier: "standard" as const, passenger: null },
        ac02: { account: "ac02", status: "libre" as const, tier: "standard" as const, passenger: null },
        cc4: { account: "cc4", status: "libre" as const, tier: "vip" as const, passenger: null },
      },
      lastUpdated: Date.now(),
    };
    saveFleetState(state, fleetPath);

    const result = acquireOrchestratorTaxi(
      mySessionId,
      "cpam/ac01/gemini-3.8-flash-high",
      fleetPath,
      myPid,
      customAccounts,
      "gemini-3.8-flash-high",
      "cpam",
      ["ac01"], // excluded
    );

    assert.ok(result);
    assert.equal(result.account, "ac02", "Failover must select free standard ac02, never cc4");
    assert.ok(result.modelId.includes("gemini-3.8-flash-high"));
    assert.ok(!result.modelId.includes("cc4"));

    const freshState = loadFleetState(fleetPath, customAccounts);
    assert.equal(freshState.fleet.cc4?.status, "libre", "cc4 must remain libre");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("standard existing allocation: routine bookkeeping preserves existing legitimate reservation", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-preserve-"));
  const fleetPath = path.join(tmpDir, "dc-taxis.json");

  try {
    const customAccounts = ["ac01", "ac02", "cc4"];
    const mySessionId = "sess-terminal-existing";
    const myPid = process.pid + 501;

    // Terminal already legitimately owns ac01
    const state = {
      fleet: {
        ac01: {
          account: "ac01",
          status: "ocupado" as const,
          tier: "standard" as const,
          passenger: {
            type: "orchestrator" as const,
            sessionId: mySessionId,
            pid: myPid,
            model: "cpam/ac01/gemini-3.8-flash-high",
            plate: `DC-HOST-${myPid}-existing`,
            startedAt: Date.now() - 20000,
            heartbeatAt: Date.now() - 5000,
          },
        },
        ac02: { account: "ac02", status: "libre" as const, tier: "standard" as const, passenger: null },
        cc4: { account: "cc4", status: "libre" as const, tier: "vip" as const, passenger: null },
      },
      lastUpdated: Date.now(),
    };
    saveFleetState(state, fleetPath);

    const result = acquireOrchestratorTaxi(
      mySessionId,
      "cpam/ac01/gemini-3.8-flash-high",
      fleetPath,
      myPid,
      customAccounts,
    );

    assert.ok(result);
    assert.equal(result.account, "ac01");
    assert.equal(result.changed, false);

    const freshState = loadFleetState(fleetPath, customAccounts);
    assert.equal(freshState.fleet.ac01?.status, "ocupado");
    assert.equal(freshState.fleet.ac01?.passenger?.sessionId, mySessionId);
    assert.ok(freshState.fleet.ac01?.passenger?.heartbeatAt! > Date.now() - 2000);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
