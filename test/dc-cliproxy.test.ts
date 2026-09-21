import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CliProxyClient } from "../src/integrations/dc-cliproxy/dc-cliproxy-client.ts";

test("CliProxyClient resolves baseUrl and trims trailing slashes", () => {
  const client1 = new CliProxyClient({ baseUrl: "http://my-proxy:9000///" });
  assert.equal(client1.getBaseUrl(), "http://my-proxy:9000");

  const originalEnv = process.env.CLIPROXY_BASE_URL;
  try {
    process.env.CLIPROXY_BASE_URL = "http://env-proxy:8317/";
    const client2 = new CliProxyClient();
    assert.equal(client2.getBaseUrl(), "http://env-proxy:8317");
  } finally {
    if (originalEnv !== undefined) process.env.CLIPROXY_BASE_URL = originalEnv;
    else delete process.env.CLIPROXY_BASE_URL;
  }
});

test("CliProxyClient resolves management key from env or file", () => {
  const originalEnv = process.env.CLIPROXY_MGMT_KEY;
  const tmpFile = path.join(os.tmpdir(), `test-mgmt-key-${Date.now()}.txt`);

  try {
    // Explicit key takes priority
    const explicit = new CliProxyClient({ managementKey: "secret-key-1" });
    assert.equal(explicit.getManagementKey(), "secret-key-1");
    assert.equal(explicit.hasManagementKey(), true);

    // Environment key
    process.env.CLIPROXY_MGMT_KEY = "env-secret-2";
    const fromEnv = new CliProxyClient({ mgmtKeyFile: tmpFile });
    assert.equal(fromEnv.getManagementKey(), "env-secret-2");

    // File fallback
    delete process.env.CLIPROXY_MGMT_KEY;
    fs.writeFileSync(tmpFile, "  file-secret-3 \n", "utf8");
    const fromFile = new CliProxyClient({ mgmtKeyFile: tmpFile });
    assert.equal(fromFile.getManagementKey(), "file-secret-3");

    // None available
    fs.unlinkSync(tmpFile);
    const none = new CliProxyClient({ mgmtKeyFile: tmpFile });
    assert.equal(none.getManagementKey(), null);
    assert.equal(none.hasManagementKey(), false);
  } finally {
    if (originalEnv !== undefined) process.env.CLIPROXY_MGMT_KEY = originalEnv;
    else delete process.env.CLIPROXY_MGMT_KEY;
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test("CliProxyClient calls management API with authorization header", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-token-123");
    if (req.url === "/v0/management/auth-files") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ files: [{ name: "acc1.json", email: "user1@example.com" }] }));
      return;
    }
    if (req.url?.startsWith("/v0/management/auth-files/download")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ prefix: "ac01" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;

  try {
    const client = new CliProxyClient({
      baseUrl: `http://127.0.0.1:${port}`,
      managementKey: "test-token-123",
    });

    const authFiles = await client.getAuthFiles();
    assert.equal(authFiles.files?.length, 1);
    assert.equal(authFiles.files?.[0].name, "acc1.json");

    const emails = await client.fetchPrefixEmails();
    assert.equal(emails.get("ac01"), "user1@example.com");
  } finally {
    server.close();
  }
});
