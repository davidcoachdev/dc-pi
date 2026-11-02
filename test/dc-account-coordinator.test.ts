import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { CliProxyClient } from "../src/integrations/dc-cliproxy/dc-cliproxy-client.ts";
import { DcAccountCoordinator } from "../src/integrations/dc-cliproxy/dc-account-coordinator.ts";
import { syncLiveCliProxyModels, formatModelDisplayName } from "../src/features/dc-models/core/dc-models-sync.ts";

test("DcAccountCoordinator caches accounts and eliminates N+1 calls", async () => {
  let authFilesCalls = 0;
  let downloadCalls = 0;

  const server = http.createServer((req, res) => {
    if (req.url === "/v0/management/auth-files") {
      authFilesCalls++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        files: [
          { name: "ac01.json", email: "ac01@test.com" },
          { name: "ac02.json", email: "ac02@test.com" },
        ],
      }));
      return;
    }
    if (req.url?.startsWith("/v0/management/auth-files/download")) {
      downloadCalls++;
      const url = new URL(req.url, "http://localhost");
      const name = url.searchParams.get("name");
      const prefix = name?.replace(".json", "");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ prefix, provider: "antigravity" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  const originalEnv = process.env.CLIPROXY_BASE_URL;
  const originalKey = process.env.CLIPROXY_MGMT_KEY;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const client = new CliProxyClient({ baseUrl, managementKey: "test-token-123" });
    const coordinator = new DcAccountCoordinator({ accountsTtlMs: 5000, client });

    // Primera llamada: debe consultar la red
    const acc1 = await coordinator.getAccounts();
    assert.equal(acc1.size, 2);
    assert.equal(acc1.get("ac01")?.email, "ac01@test.com");
    assert.equal(authFilesCalls, 1);
    assert.equal(downloadCalls, 2);

    // Segunda llamada inmediata: debe responder desde caché en memoria sin red
    const acc2 = await coordinator.getAccounts();
    assert.equal(acc2.size, 2);
    assert.equal(authFilesCalls, 1, "No debe repetir llamada a /auth-files");
    assert.equal(downloadCalls, 2, "No debe repetir descargas N+1");

    // Single-flight concurrent call
    coordinator.invalidateAll();
    const [p1, p2] = await Promise.all([coordinator.getAccounts(), coordinator.getAccounts()]);
    assert.equal(p1.size, 2);
    assert.equal(p2.size, 2);
    assert.equal(authFilesCalls, 2, "Single-flight solo debe disparar 1 petición para llamadas concurrentes");
  } finally {
    if (originalEnv !== undefined) process.env.CLIPROXY_BASE_URL = originalEnv;
    else delete process.env.CLIPROXY_BASE_URL;
    if (originalKey !== undefined) process.env.CLIPROXY_MGMT_KEY = originalKey;
    else delete process.env.CLIPROXY_MGMT_KEY;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("syncLiveCliProxyModels merges new CPAM models dynamically", async () => {
  const existing = [
    { id: "ac01/claude-sonnet-4-6", provider: "cpam" },
  ];

  const server = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        data: [
          { id: "ac01/claude-sonnet-4-6" },
          { id: "ac50/gemini-3.8-flash-high" },
          { id: "gpt-5.6-terra" },
        ],
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const client = new CliProxyClient({ baseUrl: `http://127.0.0.1:${port}` });

  try {
    const res = await syncLiveCliProxyModels(existing as any, { persistToDisk: false, client });
    assert.equal(res.addedCount, 2);
    assert.equal(res.merged.length, 3);
    const ids = res.merged.map((m: any) => m.id);
    assert.ok(ids.includes("ac50/gemini-3.8-flash-high"));
    assert.ok(ids.includes("gpt-5.6-terra"));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("formatModelDisplayName formats prefixes and titles", () => {
  assert.equal(formatModelDisplayName("ac01/claude-sonnet-4-6"), "AC01 · Claude Sonnet 4 6");
  assert.equal(formatModelDisplayName("gpt-5.6-terra"), "Gpt 5.6 Terra");
});
