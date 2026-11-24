import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  runPtcProgram,
  clampPtcTimeoutMs,
  PTC_MIN_TIMEOUT_MS,
  PTC_MAX_TIMEOUT_MS,
  PTC_DEFAULT_TIMEOUT_MS,
  PTC_MAX_OUTPUT_BYTES,
} from "../src/features/dc-ptc/core/dc-ptc-runner.ts";
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
        const res = pi.bash('printf "%s|%s|%s|%s" "$ANTHROPIC_API_KEY" "$GITHUB_TOKEN" "$MY_SUPER_SECRET_KEY" "\${PATH:+YES}"');
        const [anthropic, github, customSecret, hasPath] = res.stdout.split('|');
        return {
          anthropic: anthropic || null,
          github: github || null,
          customSecret: customSecret || null,
          hasPath: hasPath === 'YES',
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

  // Reglas canónicas de dc-scan-guard compartidas en runtime (Layer 0 git destructivo)
  const destructiveGit = await runPtcProgram({
    code: "const sub = 'reset ' + '--hard'; return pi.bash('git ' + sub);",
  });
  assert.equal(destructiveGit.success, false);
  assert.match(destructiveGit.stderr + (destructiveGit.error || ""), /dc-scan-guard/);
});

test("dc-ptc-runner: bloquea intentos de escape del sandbox (fs, process, execSync, require, import, constructor.constructor)", async () => {
  const prevSentinel = process.env.PTC_SANDBOX_SENTINEL;
  process.env.PTC_SANDBOX_SENTINEL = "SHOULD_NEVER_LEAK_12345";

  try {
    const directEscapes = [
      "return fs.readFileSync('/etc/hosts', 'utf8');",
      "return process.env;",
      "return execSync('echo PWNED').toString();",
      "return require('node:fs').readFileSync('/etc/hosts', 'utf8');",
      "const m = await import('node:fs'); return m.readFileSync('/etc/hosts', 'utf8');",
      "return ({}).constructor.constructor('return process.env')();",
    ];

    for (const code of directEscapes) {
      const res = await runPtcProgram({ code });
      assert.equal(res.success, false, `Direct escape must fail: ${code}`);
      const combined = `${res.stdout}\n${res.stderr}\n${JSON.stringify(res.value ?? "")}`;
      assert.ok(!combined.includes("SHOULD_NEVER_LEAK_12345"), `Must never leak env for: ${code}`);
    }

    // Obfuscated runtime escapes that bypass static pattern matching must STILL fail in VM sandbox
    const obfuscatedGlobalProcess = await runPtcProgram({
      code: "const k = 'pro' + 'cess'; return { hasProcess: globalThis[k] !== undefined, val: globalThis[k] ?? null };",
    });
    assert.equal(obfuscatedGlobalProcess.success, true);
    assert.deepEqual(obfuscatedGlobalProcess.value, { hasProcess: false, val: null });

    const obfuscatedVmEscapes = [
      "const c = 'const' + 'ructor'; return ({})[c][c]('return process')();",
      "const c = 'const' + 'ructor'; return pi[c][c]('return process')();",
      "const c = 'const' + 'ructor'; return pi.fs.read[c]('return process')();",
      "const c = 'const' + 'ructor'; return pi.bash('echo ok')[c][c]('return process')();",
      "try { pi.fs.read('nonexistent-file-ptc-test.txt'); } catch (e) { const c = 'const' + 'ructor'; return e[c][c]('return process')(); }",
      "const ev = globalThis['ev' + 'al']; return ev('1 + 1');",
      "const fn = globalThis['Func' + 'tion']; return fn('return 1')();",
      "const mod = 'node:' + 'fs'; return await (new Function('m', 'return import(m)'))(mod);",
      "pi.fs = {}; return pi.fs;",
      "})(); return globalThis['pro' + 'cess'].env; (async () => {",
    ];

    for (const code of obfuscatedVmEscapes) {
      const res = await runPtcProgram({ code });
      assert.equal(res.success, false, `Obfuscated VM escape must fail: ${code}`);
      const combined = `${res.stdout}\n${res.stderr}\n${JSON.stringify(res.value ?? "")}`;
      assert.ok(!combined.includes("SHOULD_NEVER_LEAK_12345"), `Must never leak env for obfuscated escape: ${code}`);
    }
  } finally {
    if (prevSentinel === undefined) delete process.env.PTC_SANDBOX_SENTINEL;
    else process.env.PTC_SANDBOX_SENTINEL = prevSentinel;
  }
});

test("dc-ptc-runner: clampPtcTimeoutMs acota timeoutMs a rango seguro", () => {
  assert.equal(clampPtcTimeoutMs(undefined), PTC_DEFAULT_TIMEOUT_MS);
  assert.equal(clampPtcTimeoutMs(Number.NaN), PTC_DEFAULT_TIMEOUT_MS);
  assert.equal(clampPtcTimeoutMs(0), PTC_MIN_TIMEOUT_MS);
  assert.equal(clampPtcTimeoutMs(-500), PTC_MIN_TIMEOUT_MS);
  assert.equal(clampPtcTimeoutMs(50), PTC_MIN_TIMEOUT_MS);
  assert.equal(clampPtcTimeoutMs(500), 500);
  assert.equal(clampPtcTimeoutMs(999_999_999), PTC_MAX_TIMEOUT_MS);
  assert.equal(clampPtcTimeoutMs(Number.POSITIVE_INFINITY), PTC_MAX_TIMEOUT_MS);
});

test("dc-ptc-runner y dc_ptc_run: respetan AbortSignal (pre-abortado y en vuelo)", async () => {
  // 1. Pre-aborted signal
  const preAborted = new AbortController();
  preAborted.abort();
  const preRes = await runPtcProgram({
    code: "return 42;",
    signal: preAborted.signal,
  });
  assert.equal(preRes.success, false);
  assert.match(`${preRes.error ?? ""} ${preRes.stderr}`, /abort/i);

  // 2. In-flight abort through registered dc_ptc_run tool execute(..., signal)
  let registeredTool: any = null;
  const mockPi = {
    registerTool(def: any) {
      registeredTool = def;
    },
  } as unknown as ExtensionAPI;
  registerDcPtcTools(mockPi);
  assert.ok(registeredTool, "dc_ptc_run tool should be registered");

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 150);
  abortTimer.unref?.();

  const startedAt = Date.now();
  const toolRes = await registeredTool.execute(
    "call-1",
    { code: "await new Promise((r) => setTimeout(r, 15000)); return 'late';", timeoutMs: 999_999 },
    controller.signal,
    undefined,
    { cwd: process.cwd() },
  );
  clearTimeout(abortTimer);

  const elapsed = Date.now() - startedAt;
  assert.equal(toolRes.isError, true);
  assert.equal(toolRes.details.success, false);
  assert.match(`${toolRes.details.error ?? ""} ${toolRes.details.stderr ?? ""}`, /abort/i);
  assert.ok(elapsed < 5000, `Expected AbortSignal to terminate child quickly, took ${elapsed}ms`);
});

test("dc-ptc-runner: acota stdout y stderr masivos con marcador de truncamiento", async () => {
  const bigOut = await runPtcProgram({
    code: `
      const chunk = 'A'.repeat(4096);
      for (let i = 0; i < 120; i++) console.log(chunk);
      for (let i = 0; i < 120; i++) console.error(chunk);
    `,
    timeoutMs: 10000,
  });

  assert.equal(bigOut.success, true);
  assert.ok(bigOut.stdout.length <= PTC_MAX_OUTPUT_BYTES + 256, `stdout exceeded cap: ${bigOut.stdout.length}`);
  assert.ok(bigOut.stderr.length <= PTC_MAX_OUTPUT_BYTES + 256, `stderr exceeded cap: ${bigOut.stderr.length}`);
  assert.match(bigOut.stdout, /truncated/i);
  assert.match(bigOut.stderr, /truncated/i);
});

test("dc-ptc-runner (security regression): setTimeout/clearTimeout con Symbol y Object.create(null) no filtran TypeError ni Function del host", async () => {
  const prevSentinel = process.env.PTC_TIMER_SENTINEL;
  process.env.PTC_TIMER_SENTINEL = "TIMER_ESCAPE_SENTINEL_999";

  try {
    // 1. Symbol() and Object.create(null) delays must not throw host TypeError or leak host Function
    const timerProbe = await runPtcProgram({
      code: `
        const c = 'const' + 'ructor';
        const p = 'pro' + 'cess';
        const attempts = [];

        for (const badDelay of [Symbol('bad'), Object.create(null), { [Symbol.toPrimitive]() { throw new Error('getter'); } }]) {
          try {
            const id = setTimeout(() => {}, badDelay);
            clearTimeout(id);
            attempts.push({ threw: false, idType: typeof id });
          } catch (e) {
            let escaped = false;
            try {
              const fn = e[c][c]('return ' + p);
              escaped = Boolean(fn());
            } catch {}
            attempts.push({ threw: true, sameRealm: e instanceof TypeError, escaped });
          }
        }

        // Invalid clearTimeout args must also never throw host errors
        clearTimeout(Symbol('clear'));
        clearTimeout(Object.create(null));

        // Invalid callback must throw a VM-realm TypeError, never a host TypeError
        let invalidCbEscaped = false;
        let invalidCbVmRealm = false;
        try {
          setTimeout(123, 0);
        } catch (e) {
          invalidCbVmRealm = e instanceof TypeError;
          try {
            const fn = e[c][c]('return ' + p);
            invalidCbEscaped = Boolean(fn());
          } catch {}
        }

        return { attempts, invalidCbVmRealm, invalidCbEscaped };
      `,
    });

    assert.equal(timerProbe.success, true, `Expected safe completion, stderr: ${timerProbe.stderr}`);
    const val = timerProbe.value as any;
    assert.equal(val.invalidCbVmRealm, true);
    assert.equal(val.invalidCbEscaped, false);
    for (const attempt of val.attempts) {
      assert.equal(attempt.threw, false, "Coercion of non-number delay inside VM should not throw");
      assert.equal(attempt.idType, "number");
    }
    const combined = `${timerProbe.stdout}\n${timerProbe.stderr}\n${JSON.stringify(timerProbe.value ?? "")}`;
    assert.ok(!combined.includes("TIMER_ESCAPE_SENTINEL_999"));
  } finally {
    if (prevSentinel === undefined) delete process.env.PTC_TIMER_SENTINEL;
    else process.env.PTC_TIMER_SENTINEL = prevSentinel;
  }
});

test("dc-ptc-runner (security regression): Promise.prototype.then, thenables, dynamic import catch y syntax breakout no escapan del sandbox", async () => {
  const prevSentinel = process.env.PTC_PROMISE_SENTINEL;
  process.env.PTC_PROMISE_SENTINEL = "PROMISE_ESCAPE_SENTINEL_777";

  try {
    // 1. Overriding Promise.prototype.then to steal host resolve.constructor
    const thenOverride = await runPtcProgram({
      code: `
        const c = 'const' + 'ructor';
        const p = 'pro' + 'cess';
        let stolen = null;
        Promise.prototype.then = function(resolve) {
          try {
            const HostFn = resolve && resolve[c];
            const proc = HostFn ? HostFn('return ' + p)() : null;
            stolen = proc ? proc.env : null;
          } catch (e) {
            stolen = 'blocked';
          }
          return resolve(stolen || 'hijacked');
        };
        return { safe: true, stolen };
      `,
    });

    assert.equal(thenOverride.success, true, `stderr: ${thenOverride.stderr}`);
    assert.deepEqual(thenOverride.value, { safe: true, stolen: null });
    const thenCombined = `${thenOverride.stdout}\n${thenOverride.stderr}\n${JSON.stringify(thenOverride.value ?? "")}`;
    assert.ok(!thenCombined.includes("PROMISE_ESCAPE_SENTINEL_777"));
    assert.ok(!thenCombined.includes("localhost"));

    // 2. Returning a custom thenable that attempts resolve.constructor('return process')()
    const customThenable = await runPtcProgram({
      code: `
        const c = 'const' + 'ructor';
        const p = 'pro' + 'cess';
        return {
          then(resolve) {
            const Fn = resolve[c];
            const proc = Fn('return ' + p)();
            const fsMod = proc.getBuiltinModule ? proc.getBuiltinModule('node:fs') : null;
            resolve(fsMod ? fsMod.readFileSync('/etc/hosts', 'utf8') : proc.env);
          }
        };
      `,
    });
    assert.equal(customThenable.success, false, "Custom thenable escape must fail");
    const thenableCombined = `${customThenable.stdout}\n${customThenable.stderr}\n${JSON.stringify(customThenable.value ?? "")}`;
    assert.ok(!thenableCombined.includes("PROMISE_ESCAPE_SENTINEL_777"));

    // 3. Poisoning Object.prototype.then to intercept return value resolution
    const objProtoThen = await runPtcProgram({
      code: `
        const c = 'const' + 'ructor';
        const p = 'pro' + 'cess';
        Object.defineProperty(Object.prototype, 'then', {
          value(resolve) {
            resolve(resolve[c]('return ' + p)().env);
          }
        });
        return { ok: true };
      `,
    });
    assert.equal(objProtoThen.success, false, "Object.prototype.then escape must fail");
    const objProtoCombined = `${objProtoThen.stdout}\n${objProtoThen.stderr}\n${JSON.stringify(objProtoThen.value ?? "")}`;
    assert.ok(!objProtoCombined.includes("PROMISE_ESCAPE_SENTINEL_777"));

    // 4. Catching dynamic import() error must yield a VM-realm Error, never a host Error
    const importCatch = await runPtcProgram({
      code: `
        const c = 'const' + 'ructor';
        const p = 'pro' + 'cess';
        const mod = 'node:' + 'fs';
        try {
          await import(mod);
          return 'unexpected-import-success';
        } catch (e) {
          return e[c][c]('return ' + p)().env;
        }
      `,
    });
    assert.equal(importCatch.success, false, "Dynamic import catch escape must fail");
    const importCombined = `${importCatch.stdout}\n${importCatch.stderr}\n${JSON.stringify(importCatch.value ?? "")}`;
    assert.ok(!importCombined.includes("PROMISE_ESCAPE_SENTINEL_777"));

    // 5. IIFE syntax breakout must fail at syntax validation before execution
    const syntaxBreakout = await runPtcProgram({
      code: "})(); pi.fs.write('should-not-run.txt', 'bad'); (async () => {",
    });
    assert.equal(syntaxBreakout.success, false, "IIFE syntax breakout must fail");
    assert.match(syntaxBreakout.stderr, /SyntaxError/i);
  } finally {
    if (prevSentinel === undefined) delete process.env.PTC_PROMISE_SENTINEL;
    else process.env.PTC_PROMISE_SENTINEL = prevSentinel;
  }
});

test("dc-ptc-runner (security regression): bloquea escritura via symlinks colgantes (absolutos, relativos bajo dir symlinkeado, dir colgante y loops)", async (t) => {
  const baseTemp = fs.mkdtempSync(path.join(os.tmpdir(), "dc-ptc-dangling-"));
  const workspace = path.join(baseTemp, "workspace");
  const outsideDir = path.join(baseTemp, "outside");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });
  t.after(() => {
    fs.rmSync(baseTemp, { recursive: true, force: true });
  });

  // 1. Absolute dangling symlink inside workspace -> non-existent file outside workspace
  const outsideAbsTarget = path.join(outsideDir, "pwned-abs.txt");
  fs.symlinkSync(outsideAbsTarget, path.join(workspace, "dangling-abs.txt"));

  const absRes = await runPtcProgram({
    code: "return pi.fs.write('dangling-abs.txt', 'pwned-abs');",
    cwd: workspace,
  });
  assert.equal(absRes.success, false, "Absolute dangling symlink write must be blocked");
  assert.equal(fs.existsSync(outsideAbsTarget), false, "Outside target must NOT be created via absolute dangling symlink");

  // Also block when invoked with absolute path inside workspace
  const absFullPathRes = await runPtcProgram({
    code: `return pi.fs.write(${JSON.stringify(path.join(workspace, "dangling-abs.txt"))}, 'pwned-abs-full');`,
    cwd: workspace,
  });
  assert.equal(absFullPathRes.success, false, "Absolute path to workspace dangling symlink must be blocked");
  assert.equal(fs.existsSync(outsideAbsTarget), false, "Outside target must NOT be created via full path dangling symlink");

  // 2. Relative dangling symlink accessed through a symlinked parent directory inside workspace
  // workspace/a/b/link-to-root -> workspace; workspace/rel-dangling.txt -> ../outside/pwned-rel.txt
  // Lexically workspace/a/b/link-to-root/rel-dangling.txt looks deep inside workspace,
  // but OS resolves ../outside/pwned-rel.txt relative to realpath(link-to-root) === workspace!
  const outsideRelTarget = path.join(outsideDir, "pwned-rel.txt");
  fs.mkdirSync(path.join(workspace, "a", "b"), { recursive: true });
  fs.symlinkSync(workspace, path.join(workspace, "a", "b", "link-to-root"));
  fs.symlinkSync("../outside/pwned-rel.txt", path.join(workspace, "rel-dangling.txt"));

  const relViaParentRes = await runPtcProgram({
    code: "return pi.fs.write('a/b/link-to-root/rel-dangling.txt', 'pwned-rel');",
    cwd: workspace,
  });
  assert.equal(relViaParentRes.success, false, "Relative dangling symlink through symlinked parent dir must be blocked");
  assert.equal(fs.existsSync(outsideRelTarget), false, "Outside target must NOT be created via relative dangling symlink");

  // 3. Dangling directory symlink inside workspace -> non-existent directory outside workspace
  const outsideDirTarget = path.join(outsideDir, "nonexistent-sub");
  const outsideNestedFile = path.join(outsideDirTarget, "pwned-nested.txt");
  fs.symlinkSync(outsideDirTarget, path.join(workspace, "dangling-dir"));

  const dirRes = await runPtcProgram({
    code: "return pi.fs.write('dangling-dir/pwned-nested.txt', 'pwned-dir');",
    cwd: workspace,
  });
  assert.equal(dirRes.success, false, "Write through dangling directory symlink must be blocked");
  assert.equal(fs.existsSync(outsideNestedFile), false, "Outside nested file must NOT be created");

  // 4. Symlink loop inside workspace must fail cleanly
  fs.symlinkSync("loop-b", path.join(workspace, "loop-a"));
  fs.symlinkSync("loop-a", path.join(workspace, "loop-b"));

  const loopRes = await runPtcProgram({
    code: "return pi.fs.write('loop-a', 'pwned-loop');",
    cwd: workspace,
  });
  assert.equal(loopRes.success, false, "Symlink loop write must be blocked");
  assert.match(loopRes.stderr, /Symlink loop/i);

  // 5. Legitimate write inside workspace still succeeds
  const legitRes = await runPtcProgram({
    code: "pi.fs.write('nested/legit.txt', 'LEGIT_OK'); return pi.fs.read('nested/legit.txt');",
    cwd: workspace,
  });
  assert.equal(legitRes.success, true, `Legitimate write failed: ${legitRes.stderr}`);
  assert.equal(legitRes.value, "LEGIT_OK");
});

