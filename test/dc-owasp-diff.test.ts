import { describe, it } from "node:test";
import * as assert from "node:assert";
import { auditDiff, OWASP_DIFF_RULES } from "../src/features/dc-owasp/core/dc-owasp-diff-engine.ts";

describe("auditDiff — Motor de Auditoría OWASP para Diffs", () => {
  it("contiene reglas de seguridad prioritarias definidas", () => {
    assert.ok(OWASP_DIFF_RULES.length >= 8);
    assert.ok(OWASP_DIFF_RULES.some((r) => r.id === "OWASP-SQLI-01"));
    assert.ok(OWASP_DIFF_RULES.some((r) => r.id === "OWASP-XSS-01"));
    assert.ok(OWASP_DIFF_RULES.some((r) => r.id === "OWASP-CRYPTO-01"));
    assert.ok(OWASP_DIFF_RULES.some((r) => r.id === "OWASP-TLS-01"));
  });

  it("detecta inyección SQL en líneas agregadas de un git diff", () => {
    const diff = `
diff --git a/src/users.ts b/src/users.ts
--- a/src/users.ts
+++ b/src/users.ts
@@ -10,3 +10,3 @@
-const query = 'SELECT * FROM users';
+const query = \`SELECT * FROM users WHERE id = \${userId}\`;
+const result = await db.query(query);
`;

    const report = auditDiff(diff);
    assert.ok(report.totalFindings > 0);
    const sqli = report.findings.find((f) => f.ruleId === "OWASP-SQLI-01");
    assert.ok(sqli);
    assert.strictEqual(sqli.severity, "high");
    assert.strictEqual(sqli.file, "src/users.ts");
    assert.ok(sqli.cheatsheetUrl.includes("SQL_Injection_Prevention_Cheat_Sheet.html"));
  });

  it("detecta XSS (dangerouslySetInnerHTML) y TLS inseguro", () => {
    const diff = `
diff --git a/src/Component.tsx b/src/Component.tsx
+++ b/src/Component.tsx
+<div dangerouslySetInnerHTML={{ __html: userBio }} />
diff --git a/src/fetcher.ts b/src/fetcher.ts
+++ b/src/fetcher.ts
+const agent = new https.Agent({ rejectUnauthorized: false });
`;

    const report = auditDiff(diff);
    assert.strictEqual(report.high, 2);
    assert.ok(report.findings.some((f) => f.ruleId === "OWASP-XSS-01"));
    assert.ok(report.findings.some((f) => f.ruleId === "OWASP-TLS-01"));
  });

  it("no genera falsos positivos en código seguro sin patrones vulnerables", () => {
    const safeDiff = `
diff --git a/src/auth.ts b/src/auth.ts
+++ b/src/auth.ts
+const passwordHash = await argon2.hash(password);
+const query = 'SELECT * FROM users WHERE id = $1';
+const user = await db.query(query, [userId]);
`;

    const report = auditDiff(safeDiff);
    assert.strictEqual(report.totalFindings, 0);
  });
});
