#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

const args = process.argv.slice(2);
const filter = args.find((a) => !a.startsWith("--"))?.toLowerCase();
const timeoutArg = args.find((a) => a.startsWith("--timeout="));
const DEFAULT_TIMEOUT_MS = timeoutArg ? Number.parseInt(timeoutArg.split("=")[1], 10) : 15000;
const ROOT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const TEST_DIR = join(ROOT_DIR, ".test-build", "test");

async function getTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getTestFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function runSingleTest(filePath, timeoutMs) {
  return new Promise((resolve) => {
    const start = performance.now();
    let timedOut = false;
    let output = "";

    const child = spawn(
      process.execPath,
      ["--experimental-test-module-mocks", "--test", "--test-force-exit", filePath],
      {
        cwd: ROOT_DIR,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NODE_ENV: "test" },
      }
    );

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) {
          process.kill(-child.pid, "SIGKILL");
        }
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      output += d.toString();
    });
    child.stderr.on("data", (d) => {
      output += d.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Math.round(performance.now() - start);
      if (timedOut) {
        resolve({
          path: filePath,
          name: basename(filePath),
          status: "TIMEOUT",
          durationMs,
          output,
        });
      } else if (code === 0) {
        resolve({
          path: filePath,
          name: basename(filePath),
          status: "PASS",
          durationMs,
        });
      } else {
        resolve({
          path: filePath,
          name: basename(filePath),
          status: "FAIL",
          code,
          durationMs,
          output,
        });
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const durationMs = Math.round(performance.now() - start);
      resolve({
        path: filePath,
        name: basename(filePath),
        status: "ERROR",
        durationMs,
        output: err.message,
      });
    });
  });
}

async function main() {
  console.log(`\x1b[36m[DC Test Runner]\x1b[0m Escaneando tests en .test-build/test...`);
  let allFiles = [];
  try {
    allFiles = await getTestFiles(TEST_DIR);
  } catch (err) {
    console.error(`\x1b[31m[ERROR]\x1b[0m No se pudo leer ${TEST_DIR}. Asegúrate de compilar con tsc primero.`, err.message);
    process.exit(1);
  }

  const targetFiles = filter ? allFiles.filter((f) => basename(f).toLowerCase().includes(filter)) : allFiles;

  if (targetFiles.length === 0) {
    console.log(`\x1b[33m[AVISO]\x1b[0m No se encontraron archivos de prueba que coincidan con '${filter || ""}'.`);
    process.exit(0);
  }

  console.log(
    `\x1b[32m[INFO]\x1b[0m Ejecutando ${targetFiles.length} archivo(s) de prueba (Watchdog: ${DEFAULT_TIMEOUT_MS / 1000}s/test)...`
  );

  const results = [];
  let passedCount = 0;
  let failedCount = 0;
  let timeoutCount = 0;

  for (let i = 0; i < targetFiles.length; i++) {
    const file = targetFiles[i];
    const name = basename(file);
    const progress = `[${i + 1}/${targetFiles.length}]`;

    process.stdout.write(`\x1b[90m${progress}\x1b[0m Ejecutando ${name}... \r`);

    const res = await runSingleTest(file, DEFAULT_TIMEOUT_MS);
    results.push(res);

    if (res.status === "PASS") {
      passedCount++;
      console.log(`\x1b[90m${progress}\x1b[0m \x1b[32m✔ PASS\x1b[0m ${name} \x1b[90m(${res.durationMs}ms)\x1b[0m`);
    } else if (res.status === "TIMEOUT") {
      timeoutCount++;
      console.log(`\x1b[90m${progress}\x1b[0m \x1b[31m✖ TIMEOUT (${DEFAULT_TIMEOUT_MS / 1000}s)\x1b[0m ${name}`);
      if (res.output) {
        console.log(`\x1b[33m--- Salida de timeout (${name}) ---\x1b[0m\n${res.output.trim()}\n\x1b[33m-----------------------------\x1b[0m`);
      }
    } else {
      failedCount++;
      console.log(`\x1b[90m${progress}\x1b[0m \x1b[31m✖ ${res.status}\x1b[0m ${name} \x1b[90m(${res.durationMs}ms)\x1b[0m`);
      if (res.output) {
        console.log(`\x1b[33m--- Salida de fallo (${name}) ---\x1b[0m\n${res.output.trim()}\n\x1b[33m-----------------------------\x1b[0m`);
      }
    }
  }

  console.log(`\n\x1b[36m================ RESUMEN DE PRUEBAS ================\x1b[0m`);
  console.log(`Total: ${targetFiles.length} | \x1b[32mPasaron: ${passedCount}\x1b[0m | \x1b[31mFallaron: ${failedCount}\x1b[0m | \x1b[33mTimeouts: ${timeoutCount}\x1b[0m`);
  console.log(`====================================================\n`);

  if (failedCount > 0 || timeoutCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
