import { describe, it } from "node:test";
import * as assert from "node:assert";
import { registerDcOwaspTools } from "../src/features/dc-owasp/tools/dc-owasp-tools.ts";

describe("dc-owasp-tools — Registro y Ejecución de Tools", () => {
  it("registra dc_owasp_query y dc_owasp_audit en ExtensionAPI", () => {
    const registeredTools: any[] = [];
    const mockPi: any = {
      registerTool(tool: any) {
        registeredTools.push(tool);
      },
    };

    registerDcOwaspTools(mockPi);
    assert.strictEqual(registeredTools.length, 2);

    const queryTool = registeredTools.find((t) => t.name === "dc_owasp_query");
    assert.ok(queryTool);
    assert.strictEqual(queryTool.label, "DC OWASP Query");

    const auditTool = registeredTools.find((t) => t.name === "dc_owasp_audit");
    assert.ok(auditTool);
    assert.strictEqual(auditTool.label, "DC OWASP Security Audit");
  });

  it("dc_owasp_audit ejecuta análisis de diff con hallazgos", async () => {
    const registeredTools: any[] = [];
    const mockPi: any = {
      registerTool(tool: any) {
        registeredTools.push(tool);
      },
    };

    registerDcOwaspTools(mockPi);
    const auditTool = registeredTools.find((t) => t.name === "dc_owasp_audit");

    const vulnDiff = `
diff --git a/src/db.ts b/src/db.ts
+++ b/src/db.ts
+const query = \`SELECT * FROM users WHERE id = \${id}\`;
`;

    const res = await auditTool.execute("call-1", { diff: vulnDiff });
    assert.ok(res.content[0].text.includes("Auditoría de Seguridad OWASP"));
    assert.ok(res.content[0].text.includes("SQL Injection"));
    assert.strictEqual(res.details.high, 1);
  });
});
