import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isSafeWebUrl, redactSecrets, isPrivateIp, validatePublicUrlResolved } from "../src/features/dc-websearch/core/dc-websearch-security.ts";
import { executeWebFetch, fetchWithDnsPinning } from "../src/features/dc-websearch/providers/web/dc-web-provider.ts";
import dcWebsearchExtension from "../src/features/dc-websearch/dc-websearch.ts";
import http from "node:http";

test("dc-websearch security: isSafeWebUrl blocks SSRF and private addresses", () => {
  // Unsafe URLs
  assert.equal(isSafeWebUrl("http://localhost:3000").safe, false);
  assert.equal(isSafeWebUrl("http://127.0.0.1:8080").safe, false);
  assert.equal(isSafeWebUrl("http://127.0.0.99:8080").safe, false);
  assert.equal(isSafeWebUrl("http://192.168.1.1/admin").safe, false);
  assert.equal(isSafeWebUrl("http://10.0.0.5").safe, false);
  assert.equal(isSafeWebUrl("http://169.254.169.254/latest/meta-data").safe, false);
  assert.equal(isSafeWebUrl("ftp://example.com/file").safe, false);
  assert.equal(isSafeWebUrl("http://[::1]/status").safe, false);

  // Safe URLs
  assert.equal(isSafeWebUrl("https://example.com").safe, true);
  assert.equal(isSafeWebUrl("https://docs.github.com/en").safe, true);
  assert.equal(isSafeWebUrl("http://public-server.org/api").safe, true);
});

test("dc-websearch security: isPrivateIp detects IPv4, IPv6 and mapped addresses", () => {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("127.12.34.56"), true);
  assert.equal(isPrivateIp("10.100.1.2"), true);
  assert.equal(isPrivateIp("172.16.0.1"), true);
  assert.equal(isPrivateIp("172.31.255.255"), true);
  assert.equal(isPrivateIp("172.32.0.1"), false);
  assert.equal(isPrivateIp("192.168.0.1"), true);
  assert.equal(isPrivateIp("169.254.1.1"), true);
  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(isPrivateIp("1.1.1.1"), false);
  assert.equal(isPrivateIp("::1"), true);
  // IPv4 mapeada en IPv6 tanto en formato decimal como en hexadecimal
  assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateIp("::ffff:7f00:1"), true);
  assert.equal(isPrivateIp("::ffff:0a00:1"), true);
  assert.equal(isPrivateIp("::ffff:c0a8:0101"), true);
  assert.equal(isPrivateIp("::ffff:8.8.8.8"), false);
  assert.equal(isPrivateIp("::ffff:0808:0808"), false);
  // Forma expandida de IPv4-mapped
  assert.equal(isPrivateIp("0:0:0:0:0:ffff:127.0.0.1"), true);
  assert.equal(isPrivateIp("0000:0000:0000:0000:0000:ffff:7f00:1"), true);
  assert.equal(isPrivateIp("0:0:0:0:0:ffff:8.8.8.8"), false);
  assert.equal(isPrivateIp("fc00::1"), true);
  assert.equal(isPrivateIp("fe80::1"), true);
});

test("dc-websearch security: isSafeWebUrl blocks IPv4-mapped hex loopbacks", () => {
  assert.equal(isSafeWebUrl("http://[::ffff:7f00:1]:8080/test").safe, false);
  assert.equal(isSafeWebUrl("http://[::ffff:0a00:1]/secret").safe, false);
});

test("dc-websearch security: validatePublicUrlResolved blocks rebinding", async () => {
  const localhostCheck = await validatePublicUrlResolved("http://127.0.0.1:3000");
  assert.equal(localhostCheck.safe, false);

  const privateCheck = await validatePublicUrlResolved("http://192.168.1.100");
  assert.equal(privateCheck.safe, false);
});

test("dc-websearch security: executeWebFetch blocks loopback and private connection via DNS lookup guard", async () => {
  // Intentar conectar a un servidor loopback debe ser interceptado en el socket connect
  const server = http.createServer((_req, res) => res.end("internal-data"));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  try {
    await assert.rejects(
      async () => {
        await executeWebFetch(`http://127.0.0.1:${port}/admin`);
      },
      (err: Error) => {
        return /bloqueado|denegado|Rebinding/i.test(err.message);
      },
      "executeWebFetch debe rechazar peticiones a localhost/loopback",
    );
  } finally {
    server.close();
  }
});

test("dc-websearch security: fetchWithDnsPinning intercepts dynamic DNS Rebinding on socket connect", async () => {
  // Simular un dominio público (ej. public-legit-site.com) que en tiempo de conexión resuelve a 127.0.0.1
  const mockDnsLookup = ((_host: string, _opts: any, cb: (err: Error | null, addresses: any, family?: number) => void) => {
    // Simula que el DNS resuelve a loopback en el momento del connect
    cb(null, [{ address: "127.0.0.1", family: 4 }]);
  }) as any;

  await assert.rejects(
    async () => {
      await fetchWithDnsPinning("http://public-legit-site.com:8080/secret", {
        dnsLookupOverride: mockDnsLookup,
        timeoutMs: 2000,
      });
    },
    (err: Error) => {
      return /DNS Rebinding detectado en socket connect/i.test(err.message);
    },
    "fetchWithDnsPinning debe bloquear socket connect si la IP devuelta por DNS es privada o loopback",
  );
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
