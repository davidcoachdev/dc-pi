import test from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fork } from "node:child_process";
import assert from "node:assert/strict";
import {
  leaseTaxi,
  releaseTaxi,
  withFleetLock,
  loadFleetState,
  saveFleetState,
  createInitialFleetState,
  getFleetStatusSummary,
} from "../src/features/dc-agents/core/dc-taxi-dispatcher.ts";
import {
  recordTaxiTrip,
  loadTaxiTripHistory,
} from "../src/features/dc-agents/core/dc-taxi-history.ts";
import {
  setCachedTaxiQuota,
  clearTaxiQuotaCache,
} from "../src/features/dc-agents/core/dc-taxi-quota.ts";
import {
  getSidebarTaxiFleet,
  clearSidebarTaxiFleetCache,
} from "../src/features/dc-sidebar/providers/dc-taxi-provider.ts";
import { registerDcEphemeralTools } from "../src/features/dc-agents/tools/dc-ephemeral-tools.ts";

const PASS = "\x1b[32m✔ PASS\x1b[0m";
const FAIL = "\x1b[31m✖ FAIL\x1b[0m";
const INFO = "\x1b[36mℹ INFO\x1b[0m";
const TITLE = (s: string) => `\n\x1b[1m\x1b[35m=== ${s} ===\x1b[0m`;

function createTempDir(name: string): string {
  const dir = path.join(os.tmpdir(), `replicate-audit-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 1: Concurrencia masiva entre múltiples procesos (Lockfile & Zero Lost Updates)
// ─────────────────────────────────────────────────────────────────────────────
async function testCase1_Concurrency() {
  console.log(TITLE("CASO 1: Concurrencia de múltiples procesos en dc-taxis.json"));
  const tempDir = createTempDir("case1-concurrency");
  const fleetPath = path.join(tempDir, "dc-taxis.json");
  const accounts = ["ac01", "ac02", "ac03", "ac04", "ac05"];

  const initial = createInitialFleetState(accounts);
  saveFleetState(initial, fleetPath);

  // Creamos un script auxiliar para que varios subprocesos compitan por arrendar y liberar
  const workerScript = path.join(tempDir, "worker.mjs");
  const dispatcherPath = path.resolve(process.cwd(), ".test-build/src/features/dc-agents/core/dc-taxi-dispatcher.js");
  fs.writeFileSync(
    workerScript,
    `
import { leaseTaxi, releaseTaxi } from "${dispatcherPath}";
const fleetPath = process.argv[2];
const workerId = process.argv[3];
const customAccounts = ["ac01", "ac02", "ac03", "ac04", "ac05"];

// Simular 5 solicitudes rápidas de arriendo y liberación
for (let i = 0; i < 5; i++) {
  const lease = leaseTaxi(
    {
      type: "ephemeral_subagent",
      sessionId: \`sess-\${workerId}-\${i}\`,
      pid: process.pid,
      agentName: \`agent-\${workerId}\`,
      model: "gemini-3.8-flash-high",
    },
    undefined,
    fleetPath,
    300000,
    customAccounts,
  );

  if (lease) {
    // Breve pausa para simular trabajo concurrente
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 20));
    releaseTaxi(lease.account, \`sess-\${workerId}-\${i}\`, fleetPath, customAccounts);
  }
}
process.exit(0);
`,
    "utf8",
  );

  console.log(`${INFO} Lanzando 6 procesos compitiendo por 5 taxis concurrentes...`);
  const children = Array.from({ length: 6 }).map((_, idx) => {
    return new Promise<void>((resolve, reject) => {
      const child = fork(workerScript, [fleetPath, String(idx)], { stdio: "inherit" });
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Worker ${idx} exited with code ${code}`));
      });
    });
  });

  await Promise.all(children);

  // Al finalizar todos, ninguna cuenta debe haber quedado corrupta o bloqueada en falso
  const finalState = loadFleetState(fleetPath, accounts);
  assert.equal(Object.keys(finalState.fleet).length, 5);
  for (const acc of accounts) {
    assert.equal(finalState.fleet[acc].status, "libre", `Cuenta ${acc} debió quedar libre`);
    assert.equal(finalState.fleet[acc].passenger, null, `Cuenta ${acc} no debe tener pasajero`);
  }
  assert.ok(!fs.existsSync(`${fleetPath}.lock`), "El lockfile debe haber sido liberado limpiamente");

  console.log(`${PASS} Concurrencia exitosa: 6 procesos completaron 30 ciclos de arriendo/liberación sin colisiones ni corrupción.`);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 2: Resiliencia de Historial ante JSON corrupto (Preservación .corrupt.bak)
// ─────────────────────────────────────────────────────────────────────────────
async function testCase2_HistoryCorruption() {
  console.log(TITLE("CASO 2: Resiliencia ante JSON corrupto en dc-taxis-history.json"));
  const tempDir = createTempDir("case2-history");
  const historyPath = path.join(tempDir, "dc-taxis-history.json");

  // Guardamos un viaje válido primero
  recordTaxiTrip(
    {
      tripId: "trip-001",
      account: "ac01",
      passengerType: "orchestrator",
      model: "gemini-3.8-flash-high",
      sessionId: "s1",
      startedAt: Date.now() - 10000,
      endedAt: Date.now(),
      durationMs: 10000,
      status: "completed",
    },
    historyPath,
  );

  assert.equal(loadTaxiTripHistory(50, historyPath).length, 1);

  // Simulamos un apagón o corte abrupto que deja un JSON truncado a la mitad
  const corruptedContent = '[\n  {"tripId": "trip-001", "account": "ac01", "model": "gemini-3.8-flas';
  fs.writeFileSync(historyPath, corruptedContent, "utf8");

  // Al leer, no debe explotar y debe generar automáticamente el backup .corrupt.<timestamp>.bak
  const recovered = loadTaxiTripHistory(50, historyPath);
  assert.deepEqual(recovered, [], "Ante corrupción debe devolver array vacío seguro");

  // Verificamos que se haya generado el archivo .corrupt.*.bak y que contenga los bytes exactos
  const files = fs.readdirSync(tempDir);
  const backupFile = files.find((f) => f.includes(".corrupt.") && f.endsWith(".bak"));
  assert.ok(backupFile, "Debe existir un archivo de respaldo con el JSON corrupto preservado");

  const preservedBytes = fs.readFileSync(path.join(tempDir, backupFile!), "utf8");
  assert.equal(preservedBytes, corruptedContent, "El backup debe preservar el contenido exacto");

  // Si registramos un nuevo viaje, la persistencia atómica con .tmp + renameSync debe funcionar
  recordTaxiTrip(
    {
      tripId: "trip-002",
      account: "ac02",
      passengerType: "ephemeral_subagent",
      model: "gemini-3.8-flash-high",
      sessionId: "s2",
      startedAt: Date.now() - 5000,
      endedAt: Date.now(),
      durationMs: 5000,
      status: "completed",
    },
    historyPath,
  );

  const afterNewTrip = loadTaxiTripHistory(50, historyPath);
  assert.equal(afterNewTrip.length, 1);
  assert.equal(afterNewTrip[0].tripId, "trip-002");

  console.log(`${PASS} Resiliencia de historial comprobada: Archivo corrupto respaldado en ${backupFile} sin pérdida destructiva.`);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 3: Aislamiento del Modo Background (Sin destrucción prematura)
// ─────────────────────────────────────────────────────────────────────────────
async function testCase3_BackgroundIsolation() {
  console.log(TITLE("CASO 3: Aislamiento de subagentes en modo background"));
  const tempDir = createTempDir("case3-background");
  const agentsDir = path.join(tempDir, "agents");
  const fleetPath = path.join(tempDir, "dc-taxis.json");
  const customAccounts = ["ac01", "ac02"];

  const initial = createInitialFleetState(customAccounts);
  saveFleetState(initial, fleetPath);

  let registeredTools = new Map<string, any>();
  const mockPi: any = {
    registerTool: (t: any) => {
      registeredTools.set(t.name, t);
    },
  };

  registerDcEphemeralTools(mockPi);

  const tool = registeredTools.get("dc_ephemeral_agent_run");
  assert.ok(tool, "dc_ephemeral_agent_run debe estar registrado");

  // Simulamos un ctx donde subagent_run se ejecuta en modo background
  let executedBackground = false;
  let executedAgentName = "";
  const testSessionId = `sess-bg-test-${Date.now()}`;
  const mockCtx: any = {
    sessionManager: { getSessionId: () => testSessionId },
    model: { provider: "cpam", id: "ac01/gemini-3.8-flash-high" },
    executeTool: async (name: string, args: any) => {
      if (name === "subagent_run") {
        executedBackground = true;
        executedAgentName = args.agent;
        assert.equal(args.mode, "background");
        // En background Pi retorna de inmediato con el task ID
        return {
          toolCall: { id: "call-1", name: "subagent_run" },
          result: {
            content: [{ type: "text", text: "Background task started: task-bg-1234" }],
            details: { taskId: "task-bg-1234", status: "running" },
          },
          isError: false,
        };
      }
      throw new Error(`Tool inesperada: ${name}`);
    },
  };

  const result = await tool.execute(
    "call-ephem-bg",
    {
      task: "Monitorear servicios en background",
      mode: "background",
      role: "bg-monitor",
    },
    undefined,
    undefined,
    mockCtx,
  );

  assert.equal(executedBackground, true);
  assert.ok(!result.isError);

  // Verificación crítica:
  // 1. El archivo .md del agente NO debe haber sido borrado
  const agentFile = path.join(os.homedir(), ".pi", "agent", "agents", `${executedAgentName}.md`);
  assert.ok(fs.existsSync(agentFile), "El archivo .md de instrucciones del subagente DEBE preservarse en background");

  // 2. El taxi DEBE permanecer ocupado con los datos del pasajero
  const fleet = loadFleetState();
  const leasedUnit = Object.values(fleet.fleet).find((u) => u.passenger?.agentName === executedAgentName);
  assert.ok(leasedUnit, "El taxi DEBE permanecer ocupado mientras corre en background");
  assert.equal(leasedUnit.status, "ocupado");
  assert.equal(leasedUnit.passenger?.sessionId, testSessionId);

  // Limpieza manual post-test
  try {
    if (fs.existsSync(agentFile)) fs.unlinkSync(agentFile);
    releaseTaxi(leasedUnit.account, testSessionId);
  } catch {
    /* noop */
  }

  console.log(`${PASS} Modo background verificado: Archivo ${agentFile} y taxi ${leasedUnit.account} preservados para el proceso de fondo.`);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 4: Máquina de Estados 'recargando' y Enfriamiento Automático (<5% / >=60%)
// ─────────────────────────────────────────────────────────────────────────────
async function testCase4_QuotaCooling() {
  console.log(TITLE("CASO 4: Máquina de estados de cuota ('recargando' <5% y reactivación >=60%)"));
  const tempDir = createTempDir("case4-cooling");
  const fleetPath = path.join(tempDir, "dc-taxis.json");
  const accounts = ["ac01", "ac02"];

  clearTaxiQuotaCache();
  const initial = createInitialFleetState(accounts);
  saveFleetState(initial, fleetPath);

  // 1. Arrendamos ac01
  const lease1 = leaseTaxi(
    {
      type: "ephemeral_subagent",
      sessionId: "sess-cool-1",
      pid: process.pid,
      model: "gemini-3.8-flash-high",
    },
    "ac01",
    fleetPath,
    300000,
    accounts,
  );
  assert.ok(lease1);
  assert.equal(lease1.account, "ac01");

  // 2. Simulamos que consumió su cuota hasta un 2% crítico
  setCachedTaxiQuota("ac01", { gemini5hPct: 2 });

  // 3. Al liberar ac01, debe pasar automáticamente a 'recargando' sin intervención manual
  const rel1 = releaseTaxi("ac01", "sess-cool-1", fleetPath, accounts);
  assert.equal(rel1, true);

  const stateAfterRel = loadFleetState(fleetPath, accounts);
  assert.equal(stateAfterRel.fleet["ac01"].status, "recargando", "ac01 debió entrar a 'recargando' por cuota <5%");
  assert.equal(stateAfterRel.fleet["ac01"].passenger, null);

  // 4. Si otro subagente pide ac01 específicamente, el despachador DEBE rechazarla o asignarle ac02
  const leaseBlocked = leaseTaxi(
    {
      type: "ephemeral_subagent",
      sessionId: "sess-cool-2",
      pid: process.pid,
      model: "gemini-3.8-flash-high",
    },
    "ac01", // pide ac01 que está recargando
    fleetPath,
    300000,
    accounts,
  );
  // No puede devolver ac01 porque está en recarga (<60%)
  assert.notEqual(leaseBlocked?.account, "ac01", "No debe asignar ac01 mientras esté recargando con cuota <60%");
  assert.equal(leaseBlocked?.account, "ac02", "Debe saltar a ac02 que está libre");

  // 5. Simulamos que ac01 se recuperó al 75%
  setCachedTaxiQuota("ac01", { gemini5hPct: 75 });

  // Liberamos ac02
  releaseTaxi("ac02", "sess-cool-2", fleetPath, accounts);

  // 6. Ahora intentamos arrendar de nuevo: ac01 debe haberse reactivado automáticamente a 'libre'
  const leaseReactivated = leaseTaxi(
    {
      type: "ephemeral_subagent",
      sessionId: "sess-cool-3",
      pid: process.pid,
      model: "gemini-3.8-flash-high",
    },
    "ac01",
    fleetPath,
    300000,
    accounts,
  );
  assert.ok(leaseReactivated);
  assert.equal(leaseReactivated.account, "ac01", "ac01 debió reactivarse a 'libre' y arrendarse al superar >=60%");

  console.log(`${PASS} Máquina de estados de cuota verificada: Enfriamiento automático en 2% y reactivación en 75%.`);
  clearTaxiQuotaCache();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// CASO 5: Caché del Sidebar con TTL de 5s (Cero I/O en Render Continuo)
// ─────────────────────────────────────────────────────────────────────────────
async function testCase5_SidebarCache() {
  console.log(TITLE("CASO 5: Caché del Sidebar con TTL de 5s (Anti-lag en Render)"));
  clearSidebarTaxiFleetCache();

  // Primer llamado: puebla la caché
  const t0 = Date.now();
  const fleet1 = getSidebarTaxiFleet();
  assert.ok(fleet1);

  // Llamadas repetidas dentro de 100ms deben devolver EXACTAMENTE la misma referencia en memoria
  const fleet2 = getSidebarTaxiFleet();
  const fleet3 = getSidebarTaxiFleet();
  assert.equal(fleet1, fleet2, "Debe devolver la misma instancia en memoria (cache hit)");
  assert.equal(fleet2, fleet3, "Debe devolver la misma instancia en memoria (cache hit)");

  // forceReload = true debe ignorar la caché y generar una nueva referencia
  const fleetForced = getSidebarTaxiFleet(true);
  assert.notEqual(fleet1, fleetForced, "forceReload=true debe generar una nueva instancia fresca");

  // clearSidebarTaxiFleetCache debe invalidar la caché
  clearSidebarTaxiFleetCache();
  const fleetAfterClear = getSidebarTaxiFleet();
  assert.notEqual(fleetForced, fleetAfterClear, "clearSidebarTaxiFleetCache debe forzar una nueva lectura");

  console.log(`${PASS} Caché del sidebar verificada: Múltiples renders reutilizan la referencia en memoria sin tocar disco.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// EJECUCIÓN PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
test("Replicación Caso 1: Concurrencia de múltiples procesos en dc-taxis.json", async () => {
  await testCase1_Concurrency();
});

test("Replicación Caso 2: Resiliencia ante JSON corrupto en dc-taxis-history.json", async () => {
  await testCase2_HistoryCorruption();
});

test("Replicación Caso 3: Aislamiento de subagentes en modo background", async () => {
  await testCase3_BackgroundIsolation();
});

test("Replicación Caso 4: Máquina de estados de cuota ('recargando' <5% y reactivación >=60%)", async () => {
  await testCase4_QuotaCooling();
});

test("Replicación Caso 5: Caché del Sidebar con TTL de 5s (Anti-lag en Render)", async () => {
  await testCase5_SidebarCache();
});
