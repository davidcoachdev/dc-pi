import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DcServicesManager,
  assertValidServiceName,
} from "../src/features/dc-services/core/dc-services-manager.ts";
import dcServicesExtension from "../src/features/dc-services/dc-services.ts";

test("DcServicesManager manages lifecycle of background processes and reads logs", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-services-test-"));
  const piDir = path.join(tmpDir, ".pi");
  fs.mkdirSync(piDir, { recursive: true });

  // Configurar un servicio de prueba con sleep
  const servicesConfig = {
    services: {
      demo: {
        command: "sh -c 'echo \"Demo server ready\" && sleep 10'",
        description: "Test service",
      },
    },
  };
  fs.writeFileSync(path.join(piDir, "services.json"), JSON.stringify(servicesConfig, null, 2), "utf8");

  try {
    const manager = new DcServicesManager(tmpDir);
    const configured = manager.listConfiguredServices();
    assert.ok(configured.demo);
    assert.equal(configured.demo.description, "Test service");

    // 1. Iniciar servicio
    const started = await manager.startService("demo");
    assert.equal(started.name, "demo");
    assert.equal(started.state, "running");
    assert.ok(started.pid);
    assert.ok(manager.isProcessAlive(started.pid));

    // Esperar un instante para que el echo escriba en logs
    await new Promise((r) => setTimeout(r, 400));

    // 2. Verificar logs
    const logs = manager.getLogs({ service: "demo" });
    assert.equal(logs.service, "demo");
    assert.ok(logs.lines.some((l) => l.includes("Demo server ready")));

    // 3. Detener servicio
    const stopped = await manager.stopService("demo", 2000);
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.pid, undefined);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dcServicesExtension registers all 6 service tools and /dc-services command", () => {
  const registeredTools: string[] = [];
  const registeredCommands: string[] = [];

  const mockPi = {
    registerTool(tool: { name: string }) {
      registeredTools.push(tool.name);
    },
    registerCommand(name: string) {
      registeredCommands.push(name);
    },
  } as unknown as ExtensionAPI;

  dcServicesExtension(mockPi);

  const expectedTools = [
    "dc_services_list",
    "dc_service_start",
    "dc_service_stop",
    "dc_service_restart",
    "dc_service_status",
    "dc_service_logs",
  ];

  for (const tool of expectedTools) {
    assert.ok(registeredTools.includes(tool), `Tool ${tool} should be registered`);
  }

  assert.ok(registeredCommands.includes("dc-services"));
});

test("dcServicesExtension registers session_shutdown to stop session-started services cleanly", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-services-shutdown-"));
  const piDir = path.join(tmpDir, ".pi");
  fs.mkdirSync(piDir, { recursive: true });
  fs.writeFileSync(
    path.join(piDir, "services.json"),
    JSON.stringify({
      services: {
        ephemeralSvc: { command: "sh -c 'sleep 15'" },
        persistentSvc: { command: "sh -c 'sleep 15'", persistent: true },
      },
    }),
    "utf8",
  );

  const tools = new Map<string, any>();
  const events = new Map<string, Function[]>();
  const mockPi = {
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    registerCommand() {},
    on(event: string, fn: Function) {
      if (!events.has(event)) events.set(event, []);
      events.get(event)!.push(fn);
    },
  } as unknown as ExtensionAPI;

  dcServicesExtension(mockPi);
  assert.ok(events.has("session_shutdown"), "dcServicesExtension must register session_shutdown");

  const startTool = tools.get("dc_service_start");
  assert.ok(startTool);

  const mockCtx = { cwd: tmpDir } as any;
  await startTool.execute("1", { service: "ephemeralSvc" }, undefined, undefined, mockCtx);
  await startTool.execute("2", { service: "persistentSvc" }, undefined, undefined, mockCtx);

  const manager = new DcServicesManager(tmpDir);
  assert.equal(manager.getServiceStatus("ephemeralSvc").state, "running");
  assert.equal(manager.getServiceStatus("persistentSvc").state, "running");

  try {
    for (const fn of events.get("session_shutdown")!) {
      await fn({}, mockCtx);
    }

    assert.equal(manager.getServiceStatus("ephemeralSvc").state, "stopped", "Session-started non-persistent service must stop on session_shutdown");
    assert.equal(manager.getServiceStatus("persistentSvc").state, "running", "Explicit persistent service must remain running");
  } finally {
    await manager.stopService("ephemeralSvc", 1000).catch(() => {});
    await manager.stopService("persistentSvc", 1000).catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("DcServicesManager (S6): blocks path traversal and symlink escapes in dc_service_logs", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-services-sec-logs-"));
  const outsideFile = path.join(tmpDir, "secret.log");
  const workspaceDir = path.join(tmpDir, "workspace");
  fs.mkdirSync(path.join(workspaceDir, ".pi"), { recursive: true });
  fs.writeFileSync(outsideFile, "TOP_SECRET_DATA\n", "utf8");

  try {
    const manager = new DcServicesManager(workspaceDir);

    const maliciousNames = [
      "../state",
      "../../secret",
      "../../../etc/passwd",
      "foo/bar",
      "foo\\bar",
      "..",
      ".",
      "",
      "svc\0evil",
      "svc..evil",
      "svc name",
    ];

    for (const bad of maliciousNames) {
      assert.throws(() => assertValidServiceName(bad), /inválido/i);
      assert.throws(() => manager.getLogPath(bad), /inválido/i);
      assert.throws(() => manager.getLogs({ service: bad }), /inválido/i);
    }

    // Symlink inside logs dir pointing outside workspace must be blocked
    const symlinkLog = path.join(workspaceDir, ".pi", "dc-services", "logs", "sym-svc.log");
    fs.symlinkSync(outsideFile, symlinkLog);
    assert.throws(() => manager.getLogs({ service: "sym-svc" }), /Acceso denegado|symlinks/i);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("DcServicesManager (S6): confines config.cwd inside workspace root and blocks escapes", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-services-sec-cwd-"));
  const outsideDir = path.join(tmpDir, "outside");
  const workspaceDir = path.join(tmpDir, "workspace");
  const nestedDir = path.join(workspaceDir, "apps", "api");
  const symlinkEscape = path.join(workspaceDir, "link-out");

  fs.mkdirSync(outsideDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, ".pi"), { recursive: true });
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.symlinkSync(outsideDir, symlinkEscape);

  fs.writeFileSync(
    path.join(workspaceDir, ".pi", "services.json"),
    JSON.stringify({
      services: {
        absEscape: { command: "sh -c 'sleep 5'", cwd: outsideDir },
        relEscape: { command: "sh -c 'sleep 5'", cwd: "../outside" },
        symEscape: { command: "sh -c 'sleep 5'", cwd: "link-out" },
        badEnv: { command: "sh -c 'sleep 5'", env: { "BAD=KEY": "1" } },
        validNested: { command: "sh -c 'pwd && sleep 5'", cwd: "apps/api" },
      },
    }),
    "utf8",
  );

  const manager = new DcServicesManager(workspaceDir);

  try {
    await assert.rejects(() => manager.startService("absEscape"), /Acceso denegado/i);
    await assert.rejects(() => manager.startService("relEscape"), /Acceso denegado/i);
    await assert.rejects(() => manager.startService("symEscape"), /Acceso denegado/i);
    await assert.rejects(() => manager.startService("badEnv"), /Variable de entorno inválida/i);

    const status = await manager.startService("validNested");
    assert.equal(status.state, "running");
    await manager.stopService("validNested", 1000);
  } finally {
    await manager.stopService("validNested", 1000).catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

