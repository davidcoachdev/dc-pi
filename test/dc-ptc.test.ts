import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runPtcProgram } from "../src/features/dc-ptc/core/dc-ptc-runner.ts";
import dcPtcExtension, { registerDcPtcTools } from "../src/features/dc-ptc/index.ts";

test("dc-ptc-runner: ejecuta código JavaScript simple y extrae el valor retornado", async () => {
  const result = await runPtcProgram({
    code: "const a = 10; const b = 25; return { sum: a + b, product: a * b };",
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.value, { sum: 35, product: 250 });
  assert.ok(result.executionTimeMs >= 0);
  assert.equal(result.stderr, "");
});

test("dc-ptc-runner: permite uso de pi.fs para leer archivos del workspace", async () => {
  const result = await runPtcProgram({
    code: `
      const pkg = JSON.parse(pi.fs.read('package.json'));
      return { name: pkg.name, hasScripts: Boolean(pkg.scripts) };
    `,
    cwd: process.cwd(),
  });

  assert.equal(result.success, true);
  assert.ok(result.value && typeof result.value === "object");
  assert.equal((result.value as any).name, "dc-pi");
  assert.equal((result.value as any).hasScripts, true);
});

test("dc-ptc-runner: permite uso de pi.bash para comandos locales sincrónicos", async () => {
  const result = await runPtcProgram({
    code: `
      const res = pi.bash('echo "HOLA PTC"');
      return { output: res.stdout, code: res.exitCode };
    `,
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.value, { output: "HOLA PTC", code: 0 });
});

test("dc-ptc-runner: captura errores de sintaxis o runtime limpiamente sin lanzar excepciones no controladas", async () => {
  const result = await runPtcProgram({
    code: "throw new Error('Fallo provocado intencionalmente para test');",
  });

  assert.equal(result.success, false);
  assert.ok(result.stderr.includes("Fallo provocado intencionalmente para test"));
});

test("dc-ptc-runner: timeout interrumpe bucles infinitos deterministamente", async () => {
  const result = await runPtcProgram({
    code: "while(true) {}",
    timeoutMs: 500, // 500ms
  });

  assert.equal(result.success, false);
  assert.ok(result.stderr.includes("Timeout") || (result.error && result.error.includes("timed out")));
});

test("dc-ptc: registra la herramienta dc_ptc_run en ExtensionAPI", () => {
  let registeredToolName = "";
  let registeredToolDesc = "";

  const mockPi = {
    registerTool(def: any) {
      registeredToolName = def.name;
      registeredToolDesc = def.description;
    },
  } as unknown as ExtensionAPI;

  dcPtcExtension(mockPi);

  assert.equal(registeredToolName, "dc_ptc_run");
  assert.ok(registeredToolDesc.includes("Programmatic Tool Calling"));
});
