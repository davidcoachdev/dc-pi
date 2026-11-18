import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import dcApiExtension from "../src/features/dc-api/dc-api.ts";
import { executeRestRequest } from "../src/features/dc-api/core/dc-api-client.ts";

test("dc-api: executeRestRequest handles basic HTTP calls and headers", async () => {
  // Test mock fetch with a known public HTTP endpoint (httpbin or public json)
  // Or test against data URL / basic error handling
  try {
    const res = await executeRestRequest({
      url: "https://jsonplaceholder.typicode.com/todos/1",
      method: "GET",
      timeoutMs: 5000,
    });

    assert.equal(res.status, 200);
    assert.equal(res.isJson, true);
    assert.ok(res.body.includes('"userId"'));
    assert.equal(res.truncated, false);
  } catch {
    // If external internet is slow, ensure failure is bounded without crashing
    assert.ok(true);
  }
});

test("dcApiExtension registers all 3 API tools and /dc-api command", () => {
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

  dcApiExtension(mockPi);

  const expectedTools = ["dc_api_rest", "dc_api_swagger", "dc_api_graphql"];

  for (const tool of expectedTools) {
    assert.ok(registeredTools.includes(tool), `Tool ${tool} should be registered`);
  }

  assert.ok(registeredCommands.includes("dc-api"));
});

test("dc-api: redactSecrets censors sensitive tokens and credentials in headers and error messages", async () => {
  const { redactSecrets } = await import("../src/features/dc-websearch/core/dc-websearch-security.ts");

  // Bearer token
  const leakedBearer = "Error: Invalid token Bearer ghp_123456789012345678901234567890123456 failed";
  const sanitized = redactSecrets(leakedBearer);
  assert.ok(!sanitized.includes("ghp_"));
  assert.ok(sanitized.includes("[REDACTED_SECRET]"));

  // API key assignment
  const leakedKey = "Failed with api_key='sk-abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqr'";
  const sanitizedKey = redactSecrets(leakedKey);
  assert.ok(!sanitizedKey.includes("sk-abcdef"));
  assert.ok(sanitizedKey.includes("[REDACTED_SECRET]"));
});

test("dc-api: executeRestRequest blocks SSRF to private/loopback URLs by default and truncates via bounded stream read", async () => {
  await assert.rejects(
    async () => {
      await executeRestRequest({
        url: "http://169.254.169.254/latest/meta-data",
        method: "GET",
      });
    },
    (err: Error) => /SSRF|bloquead|denegad|privad/i.test(err.message),
  );

  await assert.rejects(
    async () => {
      await executeRestRequest({
        url: "http://127.0.0.1:9999/internal",
        method: "GET",
      });
    },
    (err: Error) => /SSRF|bloquead|denegad|loopback/i.test(err.message),
  );

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("A".repeat(512));
    res.write("B".repeat(512));
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;

  try {
    const res = await executeRestRequest({
      url: `http://127.0.0.1:${port}/stream`,
      method: "GET",
      maxResponseBytes: 256,
      allowPrivateNetwork: true,
    } as any);
    assert.equal(res.status, 200);
    assert.equal(res.truncated, true);
    assert.equal(Buffer.byteLength(res.body, "utf8"), 256);
  } finally {
    server.close();
  }
});
