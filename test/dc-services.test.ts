import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DcServicesManager } from "../src/features/dc-services/core/dc-services-manager.ts";
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
