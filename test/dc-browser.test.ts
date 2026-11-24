import test from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  normalizeCdpUrl,
  validateCdpUrl,
  validateCdpWebSocketUrl,
  getCdpStatus,
  listPageTargets,
  navigatePage,
  capturePageScreenshot,
} from "../src/features/dc-browser/core/dc-browser-cdp.ts";
import dcBrowserExtension from "../src/features/dc-browser/dc-browser.ts";

test("dc-browser: normalizeCdpUrl handles loopback defaults and custom ports cleanly", () => {
  assert.equal(normalizeCdpUrl(), "http://127.0.0.1:9222");
  assert.equal(normalizeCdpUrl("http://localhost:9222/"), "http://localhost:9222");
  assert.equal(normalizeCdpUrl("https://localhost:9222/"), "https://localhost:9222");
  assert.equal(normalizeCdpUrl("http://[::1]:9333/"), "http://[::1]:9333");
});

test("dc-browser: CDP HTTP and WebSocket URLs reject non-loopback hosts and SSRF vectors", async () => {
  const forbiddenHttpUrls = [
    "http://192.168.1.50:9333",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5:9222",
    "http://0.0.0.0:9222",
    "http://evil.com:9222",
    "http://localhost.evil.com:9222",
    "http://[::ffff:169.254.169.254]:9222",
    "http://[::ffff:192.168.1.50]:9222",
    "http://user:pass@127.0.0.1:9222",
    "http://127.0.0.1@evil.com:9222",
    "ws://127.0.0.1:9222/devtools/page/1",
    "file:///etc/passwd",
  ];

  for (const badUrl of forbiddenHttpUrls) {
    assert.throws(
      () => normalizeCdpUrl(badUrl),
      /bloquead|SSRF|loopback|Credenciales|Protocolo|inválida/i,
      `normalizeCdpUrl should reject ${badUrl}`,
    );
  }

  // getCdpStatus y listPageTargets deben rechazar SSRF antes de hacer fetch
  await assert.rejects(
    () => getCdpStatus("http://169.254.169.254"),
    /SSRF|loopback|bloquead/i,
  );
  await assert.rejects(
    () => listPageTargets("http://192.168.1.50:9222"),
    /SSRF|loopback|bloquead/i,
  );

  // WebSocket URLs permitidas (solo loopback ws:/wss:)
  assert.equal(
    validateCdpWebSocketUrl("ws://127.0.0.1:9222/devtools/page/1"),
    "ws://127.0.0.1:9222/devtools/page/1",
  );
  assert.equal(
    validateCdpWebSocketUrl("wss://localhost:9222/devtools/page/1"),
    "wss://localhost:9222/devtools/page/1",
  );
  assert.equal(
    validateCdpWebSocketUrl("ws://[::1]:9222/devtools/page/1"),
    "ws://[::1]:9222/devtools/page/1",
  );
  assert.equal(
    validateCdpUrl("ws://127.0.0.1:9222/devtools/browser/abc", "any"),
    "ws://127.0.0.1:9222/devtools/browser/abc",
  );

  // WebSocket URLs bloqueadas
  const forbiddenWsUrls = [
    "ws://169.254.169.254/devtools/page/1",
    "ws://192.168.1.50:9222/devtools/page/1",
    "ws://evil.com/devtools/page/1",
    "ws://[::ffff:169.254.169.254]:9222/devtools/page/1",
    "wss://user:pass@127.0.0.1:9222/devtools/page/1",
    "http://127.0.0.1:9222/devtools/page/1",
    "file:///etc/passwd",
  ];

  for (const badWs of forbiddenWsUrls) {
    assert.throws(
      () => validateCdpWebSocketUrl(badWs),
      /bloquead|SSRF|loopback|Credenciales|Protocolo|inválida/i,
      `validateCdpWebSocketUrl should reject ${badWs}`,
    );
  }
});

test("dc-browser: listPageTargets rejects spoofed non-loopback webSocketDebuggerUrl from CDP response", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/json/list") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify([
          {
            id: "tab-evil",
            type: "page",
            title: "Spoofed",
            url: "https://example.com",
            webSocketDebuggerUrl: "ws://169.254.169.254:9222/devtools/page/tab-evil",
          },
        ]),
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await assert.rejects(
      () => listPageTargets(`http://127.0.0.1:${address.port}`),
      /SSRF|loopback|bloquead/i,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("dc-browser: getCdpStatus fails gracefully when Chrome is not running", async () => {
  // Con un puerto cerrado debe retornar connected: false sin crashear el proceso
  const status = await getCdpStatus("http://127.0.0.1:59999");
  assert.equal(status.connected, false);
  assert.equal(status.pageTargetCount, 0);
  assert.ok(status.warnings.length > 0);
});

test("dcBrowserExtension registers 4 browser tools and command /dc-browser", () => {
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

  dcBrowserExtension(mockPi);

  const expectedTools = [
    "dc_browser_status",
    "dc_browser_tabs",
    "dc_browser_navigate",
    "dc_browser_screenshot",
  ];

  for (const tool of expectedTools) {
    assert.ok(registeredTools.includes(tool), `Tool ${tool} should be registered`);
  }

  assert.ok(registeredCommands.includes("dc-browser"));
});

test("dc-browser: navigatePage blocks dangerous schemes and private/metadata IPs", async () => {
  await assert.rejects(
    async () => {
      await navigatePage({ url: "file:///etc/passwd" });
    },
    (err: Error) => /protocolo|esquema|bloquead|denegad|SSRF/i.test(err.message),
  );

  await assert.rejects(
    async () => {
      await navigatePage({ url: "javascript:alert(1)" });
    },
    (err: Error) => /protocolo|esquema|bloquead|denegad|SSRF/i.test(err.message),
  );

  await assert.rejects(
    async () => {
      await navigatePage({ url: "http://169.254.169.254/latest/meta-data" });
    },
    (err: Error) => /SSRF|privad|bloquead|denegad/i.test(err.message),
  );
});

test("dc-browser: capturePageScreenshot confines outputPath inside cwd or os.tmpdir()", async () => {
  await assert.rejects(
    async () => {
      await capturePageScreenshot({
        cwd: process.cwd(),
        outputPath: "../../../etc/malicious.png",
      });
    },
    (err: Error) => /fuera|permitid|traversal|cwd|tmpdir/i.test(err.message),
  );

  await assert.rejects(
    async () => {
      await capturePageScreenshot({
        cwd: process.cwd(),
        outputPath: "/etc/malicious.png",
      });
    },
    (err: Error) => /fuera|permitid|traversal|cwd|tmpdir/i.test(err.message),
  );
});
