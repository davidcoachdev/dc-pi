import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSafeWebUrl, redactSecrets } from "../src/features/dc-websearch/core/dc-websearch-security.ts";
import dcWebsearchExtension from "../src/features/dc-websearch/dc-websearch.ts";

test("dc-websearch security: isSafeWebUrl blocks SSRF and private addresses", () => {
  // Unsafe URLs
  assert.equal(isSafeWebUrl("http://localhost:3000").safe, false);
  assert.equal(isSafeWebUrl("http://127.0.0.1:8080").safe, false);
  assert.equal(isSafeWebUrl("http://192.168.1.1/admin").safe, false);
  assert.equal(isSafeWebUrl("http://10.0.0.5").safe, false);
  assert.equal(isSafeWebUrl("http://169.254.169.254/latest/meta-data").safe, false);
  assert.equal(isSafeWebUrl("ftp://example.com/file").safe, false);

  // Safe URLs
  assert.equal(isSafeWebUrl("https://example.com").safe, true);
  assert.equal(isSafeWebUrl("https://docs.github.com/en").safe, true);
  assert.equal(isSafeWebUrl("http://public-server.org/api").safe, true);
});

test("dc-websearch security: redactSecrets masks sensitive credentials", () => {
  const secretText = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and ghp_1234567890abcdef1234567890abcdef1234";
  const sanitized = redactSecrets(secretText);
  assert.ok(!sanitized.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
  assert.ok(!sanitized.includes("ghp_1234567890abcdef"));
  assert.ok(sanitized.includes("[REDACTED_SECRET]"));
});

test("dcWebsearchExtension registers all 6 technical research tools", () => {
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

  dcWebsearchExtension(mockPi);

  const expectedTools = [
    "dc_web_search",
    "dc_web_fetch",
    "dc_discussion_search",
    "dc_discussion_answers_get",
    "dc_github_code_search",
    "dc_github_get",
    "dc_research_search",
  ];

  for (const tool of expectedTools) {
    assert.ok(registeredTools.includes(tool), `Tool ${tool} should be registered`);
  }

  assert.ok(registeredCommands.includes("dc-websearch"));
});
