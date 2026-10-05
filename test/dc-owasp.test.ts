import { describe, it } from "node:test";
import * as assert from "node:assert";
import dcOwaspExtension from "../src/features/dc-owasp/dc-owasp.ts";

describe("dcOwaspExtension — Integración con Pi", () => {
  it("registra comandos /dc-owasp y /owasp en Pi", () => {
    const commands: any[] = [];
    const tools: any[] = [];

    const mockPi: any = {
      registerTool(tool: any) {
        tools.push(tool);
      },
      registerCommand(name: string, def: any) {
        commands.push({ name, ...def });
      },
    };

    dcOwaspExtension(mockPi);

    // Comandos TUI
    assert.strictEqual(commands.length, 2);
    assert.ok(commands.some((c) => c.name === "dc-owasp"));
    assert.ok(commands.some((c) => c.name === "owasp"));

    // Herramientas LLM
    assert.strictEqual(tools.length, 2);
    assert.ok(tools.some((t) => t.name === "dc_owasp_query"));
    assert.ok(tools.some((t) => t.name === "dc_owasp_audit"));
  });
});
