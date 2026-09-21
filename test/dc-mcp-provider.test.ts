import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getMcpServersInfo } from "../src/features/dc-sidebar/providers/dc-mcp-provider.ts";

test("getMcpServersInfo reads real or default MCP configuration", () => {
  const info = getMcpServersInfo();
  assert.ok(typeof info.totalCount === "number");
  assert.ok(typeof info.enabledCount === "number");
  assert.ok(typeof info.disabledCount === "number");
  assert.ok(Array.isArray(info.servers));

  if (info.servers.length > 0) {
    const first = info.servers[0];
    assert.ok(typeof first.name === "string");
    assert.ok(typeof first.disabled === "boolean");
  }
});

test("getMcpServersInfo parses project overrides and disabled servers", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-mcp-test-"));
  const prjMcp = path.join(tmpDir, "mcp.json");

  fs.writeFileSync(
    prjMcp,
    JSON.stringify({
      mcpServers: {
        testServer: {
          command: "node",
          args: ["test.js"],
        },
        disabledServer: {
          disabled: true,
        },
      },
    }),
    "utf8"
  );

  const info = getMcpServersInfo(tmpDir);
  assert.ok(info.totalCount >= 2);

  const testServer = info.servers.find((s) => s.name === "testServer");
  assert.ok(testServer);
  assert.equal(testServer.disabled, false);

  const disabledServer = info.servers.find((s) => s.name === "disabledServer");
  assert.ok(disabledServer);
  assert.equal(disabledServer.disabled, true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
