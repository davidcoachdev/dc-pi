import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  redactOwaspSnippet,
  registerDcOwaspTools,
  resolveAuditFilePath,
} from "../src/features/dc-owasp/tools/dc-owasp-tools.ts";

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

  it("dc_owasp_audit confina params.path al workspace y bloquea rutas externas, ~/ y symlinks", async () => {
    const registeredTools: any[] = [];
    const mockPi: any = {
      registerTool(tool: any) {
        registeredTools.push(tool);
      },
    };
    registerDcOwaspTools(mockPi);
    const auditTool = registeredTools.find((t) => t.name === "dc_owasp_audit");

    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-owasp-ws-"));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-owasp-out-"));
    const outsideFile = path.join(outsideDir, "secret.ts");
    const symlinkInside = path.join(workspaceDir, "escape.ts");
    const danglingLink = path.join(workspaceDir, "dangling.ts");
    const validFile = path.join(workspaceDir, "app.ts");

    fs.writeFileSync(outsideFile, `const api_key = "ghp_1234567890abcdef1234567890abcdef1234";\n`);
    fs.symlinkSync(outsideFile, symlinkInside);
    fs.symlinkSync(path.join(outsideDir, "missing.ts"), danglingLink);
    fs.writeFileSync(validFile, `const query = \`SELECT * FROM users WHERE id = \${id}\`;\n`);

    try {
      const ctx = { cwd: workspaceDir };

      // 1. Ruta absoluta fuera del workspace (/etc/passwd)
      const resEtc = await auditTool.execute("call-etc", { path: "/etc/passwd" }, undefined, undefined, ctx);
      assert.strictEqual(resEtc.isError, true);
      assert.match(resEtc.content[0].text, /Acceso denegado|fuera de los directorios permitidos/i);

      // 2. Ruta con ~ (~/.ssh/id_rsa)
      const resHome = await auditTool.execute("call-home", { path: "~/.ssh/id_rsa" }, undefined, undefined, ctx);
      assert.strictEqual(resHome.isError, true);
      assert.match(resHome.content[0].text, /Acceso denegado|fuera de los directorios permitidos/i);

      // 3. Traversal relativo (../)
      const relOutside = path.relative(workspaceDir, outsideFile);
      const resTraversal = await auditTool.execute("call-trav", { path: relOutside }, undefined, undefined, ctx);
      assert.strictEqual(resTraversal.isError, true);
      assert.match(resTraversal.content[0].text, /Acceso denegado|fuera de los directorios permitidos/i);

      // 4. Symlink dentro del workspace apuntando afuera
      const resSymlink = await auditTool.execute("call-sym", { path: "escape.ts" }, undefined, undefined, ctx);
      assert.strictEqual(resSymlink.isError, true);
      assert.match(resSymlink.content[0].text, /Acceso denegado|symlink|fuera de los directorios permitidos/i);

      // 5. Symlink colgante apuntando afuera
      assert.throws(
        () => resolveAuditFilePath("dangling.ts", workspaceDir),
        /Acceso denegado|symlink|fuera de los directorios permitidos/i,
      );

      // 6. Archivo válido dentro del workspace sí se audita
      const resOk = await auditTool.execute("call-ok", { path: "app.ts" }, undefined, undefined, ctx);
      assert.strictEqual(resOk.isError, undefined);
      assert.strictEqual(resOk.details.high, 1);
      assert.ok(resOk.content[0].text.includes("SQL Injection"));
    } finally {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("dc_owasp_audit redacta secretos literales en f.snippet y details conservando contexto", async () => {
    const registeredTools: any[] = [];
    const mockPi: any = {
      registerTool(tool: any) {
        registeredTools.push(tool);
      },
    };
    registerDcOwaspTools(mockPi);
    const auditTool = registeredTools.find((t) => t.name === "dc_owasp_audit");

    const ghToken = "ghp_AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRr";
    const openAiKey = "sk-proj-VerySecretOpenAiKey1234567890abcd";
    const rawPassword = "MySuperSecretPassword123456789";

    const secretsDiff = [
      "diff --git a/src/config.ts b/src/config.ts",
      "+++ b/src/config.ts",
      `+const githubToken = "${ghToken}";`,
      `+const llmKey = "${openAiKey}";`,
      `+const password = '${rawPassword}';`,
      `+const query = \`SELECT * FROM users WHERE id = \${id}\`;`,
    ].join("\n");

    const res = await auditTool.execute("call-secrets", { diff: secretsDiff });
    const rendered: string = res.content[0].text;
    const serializedDetails = JSON.stringify(res.details);

    // Ningún secreto literal debe fugarse al texto ni a details
    assert.ok(!rendered.includes(ghToken), "GitHub token must not leak in content");
    assert.ok(!rendered.includes(openAiKey), "OpenAI key must not leak in content");
    assert.ok(!rendered.includes(rawPassword), "Password must not leak in content");
    assert.ok(!serializedDetails.includes(ghToken), "GitHub token must not leak in details");
    assert.ok(!serializedDetails.includes(openAiKey), "OpenAI key must not leak in details");
    assert.ok(!serializedDetails.includes(rawPassword), "Password must not leak in details");

    // Debe conservar diagnóstico y contexto
    assert.ok(rendered.includes("OWASP-SECRETS-01"));
    assert.ok(rendered.includes("[REDACTED]"));
    assert.ok(rendered.includes("const password = '[REDACTED]'"));
    assert.ok(rendered.includes("SELECT * FROM users WHERE id = ${id}"));
  });

  it("redactOwaspSnippet enmascara múltiples formatos de credenciales preservando contexto", () => {
    assert.strictEqual(
      redactOwaspSnippet(`const api_key = "super_secret_key_1234567890";`),
      `const api_key = "[REDACTED]";`,
    );
    assert.strictEqual(
      redactOwaspSnippet(`Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb`),
      `Authorization: Bearer [REDACTED]`,
    );
    assert.strictEqual(
      redactOwaspSnippet(`localStorage.setItem('token', 'raw-jwt-secret-value-9999')`),
      `localStorage.setItem('token', '[REDACTED]')`,
    );
    assert.strictEqual(
      redactOwaspSnippet(`https://admin:TopSecretPass@db.internal:5432/app`),
      `https://admin:[REDACTED]@db.internal:5432/app`,
    );
    assert.strictEqual(
      redactOwaspSnippet(`const query = \`SELECT * FROM items WHERE id = \${id}\`;`),
      `const query = \`SELECT * FROM items WHERE id = \${id}\`;`,
    );
  });

  it("redactOwaspSnippet redacta claves JSON/JS entre comillas y múltiples secretos en una misma línea incluso bajo reglas no-SECRETS", async () => {
    // 1. Claves entre comillas dobles y simples
    assert.strictEqual(
      redactOwaspSnippet(`"password": "MyProdPassword123!"`, "OWASP-SQLI-01"),
      `"password": "[REDACTED]"`,
    );
    assert.strictEqual(
      redactOwaspSnippet(`'api_key': 'secret_value_12345'`, "OWASP-SQLI-01"),
      `'api_key': '[REDACTED]'`,
    );
    assert.strictEqual(
      redactOwaspSnippet(`"access_token": "tok_abc123456789"`, "OWASP-SQLI-01"),
      `"access_token": "[REDACTED]"`,
    );
    assert.strictEqual(
      redactOwaspSnippet(`"password": UnquotedSecret999`, "OWASP-SQLI-01"),
      `"password": [REDACTED]`,
    );

    // 2. Múltiples secretos JSON en la misma línea bajo regla OWASP-SQLI-01
    const multiSecretSqlLine =
      `const q = \`SELECT * FROM creds WHERE payload = '{"password": "MyProdPassword123!", "api_key": "secret_value_12345", "access_token": "tok_abc987654321"}' AND id = \${id}\`;`;
    const redactedLine = redactOwaspSnippet(multiSecretSqlLine, "OWASP-SQLI-01");
    assert.ok(!redactedLine.includes("MyProdPassword123!"));
    assert.ok(!redactedLine.includes("secret_value_12345"));
    assert.ok(!redactedLine.includes("tok_abc987654321"));
    assert.strictEqual(
      redactedLine,
      `const q = \`SELECT * FROM creds WHERE payload = '{"password": "[REDACTED]", "api_key": "[REDACTED]", "access_token": "[REDACTED]"}' AND id = \${id}\`;`,
    );

    // 3. End-to-end mediante dc_owasp_audit con hallazgo OWASP-SQLI-01
    const registeredTools: any[] = [];
    const mockPi: any = {
      registerTool(tool: any) {
        registeredTools.push(tool);
      },
    };
    registerDcOwaspTools(mockPi);
    const auditTool = registeredTools.find((t) => t.name === "dc_owasp_audit");

    const sqliWithJsonSecretsDiff = [
      "diff --git a/src/query.ts b/src/query.ts",
      "+++ b/src/query.ts",
      `+${multiSecretSqlLine}`,
    ].join("\n");

    const res = await auditTool.execute("call-sqli-json-secrets", { diff: sqliWithJsonSecretsDiff });
    const rendered: string = res.content[0].text;
    const serializedDetails = JSON.stringify(res.details);

    assert.ok(rendered.includes("OWASP-SQLI-01"));
    assert.ok(!rendered.includes("MyProdPassword123!"));
    assert.ok(!rendered.includes("secret_value_12345"));
    assert.ok(!rendered.includes("tok_abc987654321"));
    assert.ok(!serializedDetails.includes("MyProdPassword123!"));
    assert.ok(!serializedDetails.includes("secret_value_12345"));
    assert.ok(!serializedDetails.includes("tok_abc987654321"));
    assert.ok(rendered.includes(`"password": "[REDACTED]"`));
    assert.ok(rendered.includes(`"api_key": "[REDACTED]"`));
    assert.ok(rendered.includes(`"access_token": "[REDACTED]"`));
  });
});
