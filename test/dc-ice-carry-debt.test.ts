/**
 * test/dc-ice-carry-debt.test.ts — Test suite para el Auditor de Carry Debt (Inventario No Solicitado).
 * Directiva: Kapil Viren Ahuja (IDSD / Anti-Inventory Bloat) & KISS/YAGNI de DC Studio.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  auditCarryDebt,
  type CarryDebtReport,
} from "../src/features/dc-ice/core/dc-ice-carry-debt.ts";

test("dc-ice carry-debt: detecta código limpio sin advertencias de inventario especulativo", () => {
  const cleanDiff = `
diff --git a/src/cart.ts b/src/cart.ts
index 1111111..2222222 100644
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -1,5 +1,8 @@
 export function calculateTotal(items: CartItem[]): number {
-  return 0;
+  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
 }
`;

  const report: CarryDebtReport = auditCarryDebt(cleanDiff, {
    constraints: ["Support line items price calculation."],
  });

  assert.equal(report.hasCarryDebt, false);
  assert.equal(report.findings.length, 0);
  assert.equal(report.score, 100);
});

test("dc-ice carry-debt: detecta abstracciones prematuras y sobreingeniería en el diff (Factory, Generic Wrapper)", () => {
  const overengineeredDiff = `
diff --git a/src/services/user-factory.ts b/src/services/user-factory.ts
new file mode 100644
--- /dev/null
+++ b/src/services/user-factory.ts
@@ -0,0 +1,15 @@
+export class AbstractGenericUserFactoryProvider<T> {
+  private handlers: Map<string, T> = new Map();
+  public createInstance(kind: string): T {
+    return this.handlers.get(kind)!;
+  }
+}
+export class UserFactorySingletonManager {
+  static getInstance() {}
+}
`;

  const report = auditCarryDebt(overengineeredDiff, {
    constraints: ["Fetch active user profile."],
  });

  assert.equal(report.hasCarryDebt, true);
  assert.ok(report.findings.length >= 2, `Se esperaban al menos 2 hallazgos, encontrados: ${report.findings.length}`);
  assert.ok(
    report.findings.some((f) => f.rule === "premature-abstraction" && f.snippet.includes("Factory")),
    "Debe detectar el patrón de Factory prematura",
  );
  assert.ok(
    report.findings.some((f) => f.rule === "premature-abstraction" && f.snippet.includes("Manager")),
    "Debe detectar el patrón de Manager redundante",
  );
});

test("dc-ice carry-debt: detecta mutación o creación no autorizada de archivos de configuración bloqueados", () => {
  const configDiff = `
diff --git a/tsconfig.json b/tsconfig.json
--- a/tsconfig.json
+++ b/tsconfig.json
@@ -5,2 +5,3 @@
+    "skipLibCheck": true,
diff --git a/docker-compose.override.yml b/docker-compose.override.yml
new file mode 100644
--- /dev/null
+++ b/docker-compose.override.yml
@@ -0,0 +1,3 @@
+version: '3'
`;

  const report = auditCarryDebt(configDiff, {
    constraints: ["Format date string to ISO."],
    allowConfigChanges: false,
  });

  assert.equal(report.hasCarryDebt, true);
  assert.ok(
    report.findings.some((f) => f.rule === "locked-config-mutation" && f.file.includes("tsconfig.json")),
    "Debe alertar sobre modificación de tsconfig.json bloqueado",
  );
  assert.ok(
    report.findings.some((f) => f.rule === "locked-config-mutation" && f.file.includes("docker-compose")),
    "Debe alertar sobre creación de docker-compose no solicitada",
  );
});

test("dc-ice carry-debt: detecta stubs incompletos o comentarios elisivos ('// TODO', 'rest unchanged')", () => {
  const elisionDiff = `
diff --git a/src/service.ts b/src/service.ts
--- a/src/service.ts
+++ b/src/service.ts
@@ -10,3 +10,5 @@
+  // TODO: implement this when API is ready
+  /* rest of implementation unchanged */
`;

  const report = auditCarryDebt(elisionDiff);

  assert.equal(report.hasCarryDebt, true);
  assert.ok(
    report.findings.some((f) => f.rule === "zero-omission-violation" && f.snippet.includes("TODO")),
    "Debe advertir sobre comentarios TODO elisivos",
  );
});
