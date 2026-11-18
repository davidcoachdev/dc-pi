import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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

test("dc-ptc-runner: confina pi.fs dentro de cwd (y os.tmpdir) bloqueando path traversal y rutas externas", async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "dc-ptc-ws-"));
  const outsideFile = path.join(os.tmpdir(), `dc-ptc-outside-${Date.now()}.txt`);
  fs.writeFileSync(path.join(workspace, "inside.txt"), "INSIDE_OK", "utf8");
  fs.writeFileSync(outsideFile, "OUTSIDE_SECRET", "utf8");
  t.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outsideFile, { force: true });
  });

  // Lectura dentro de cwd permitida
  const insideRead = await runPtcProgram({
    code: "return pi.fs.read('inside.txt');",
    cwd: workspace,
  });
  assert.equal(insideRead.success, true);
  assert.equal(insideRead.value, "INSIDE_OK");

  // Traversal con .. fuera de cwd bloqueado
  const traversalRead = await runPtcProgram({
    code: "return pi.fs.read('../../etc/passwd');",
    cwd: workspace,
  });
  assert.equal(traversalRead.success, false);

  // Ruta absoluta fuera de cwd y fuera de tmpdir bloqueada
  const absOutsideRead = await runPtcProgram({
    code: "return pi.fs.read('/etc/hosts');",
    cwd: workspace,
  });
  assert.equal(absOutsideRead.success, false);

  // Escritura con .. fuera de cwd bloqueada
  const traversalWrite = await runPtcProgram({
    code: "return pi.fs.write('../escaped-ptc-file.txt', 'pwned');",
    cwd: workspace,
  });
  assert.equal(traversalWrite.success, false);

  // Listado fuera de cwd bloqueado
  const rootList = await runPtcProgram({
    code: "return pi.fs.list('/');",
    cwd: workspace,
  });
  assert.equal(rootList.success, false);
});

test("dc-ptc-runner: filtra variables de entorno sensibles y protege pi.bash con classifyShellCommand", async () => {
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevGh = process.env.GITHUB_TOKEN;
  const prevSecret = process.env.MY_SUPER_SECRET_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-secret-leak-test";
  process.env.GITHUB_TOKEN = "ghp_secret_leak_test";
  process.env.MY_SUPER_SECRET_KEY = "top-secret-value";

  try {
    const envResult = await runPtcProgram({
      code: `
        return {
          anthropic: process.env.ANTHROPIC_API_KEY ?? null,
          github: process.env.GITHUB_TOKEN ?? null,
          customSecret: process.env.MY_SUPER_SECRET_KEY ?? null,
          hasPath: Boolean(process.env.PATH),
        };
      `,
    });
    assert.equal(envResult.success, true);
    assert.deepEqual(envResult.value, {
      anthropic: null,
      github: null,
      customSecret: null,
      hasPath: true,
    });
  } finally {
    if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropic;
    if (prevGh === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = prevGh;
    if (prevSecret === undefined) delete process.env.MY_SUPER_SECRET_KEY;
    else process.env.MY_SUPER_SECRET_KEY = prevSecret;
  }

  // Guardia en pi.bash contra comandos destructivos (incluso construidos dinámicamente en runtime)
  const destructiveBash = await runPtcProgram({
    code: "const target = '/.' + '/'; return pi.bash('rm -rf ' + target);",
  });
  assert.equal(destructiveBash.success, false);
  assert.match(destructiveBash.stderr + (destructiveBash.error || ""), /dc-scan-guard/);
});

