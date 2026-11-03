/**
 * dc-ptc-runner.ts — Motor de ejecución programática en subproceso Node.js aislado.
 *
 * Implementa el patrón PTC de DeepSeek Harness con garantías estrictas:
 * - Aislamiento en proceso Node hijo efímero.
 * - Inyección de bindings asíncronos nativos para sistema de archivos y comandos shell sin overhead de LLM.
 * - Captura estructurada de stdout, stderr, tiempo de ejecución y valor de retorno serializado.
 * - Timeout determinista y prevención de loops infinitos.
 *
 * Directiva 1 de DC Studio: Cero dependencias de Pi en este módulo de core.
 */

import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { PtcRunOptions, PtcRunResult } from "./dc-ptc-types.ts";

/**
 * Plantilla del script que se ejecuta en el proceso hijo de Node.js.
 * Expone un objeto global `pi` con utilidades convenientes:
 * - `pi.fs.read(path, maxBytes?)`
 * - `pi.fs.write(path, content)`
 * - `pi.fs.list(dir?)`
 * - `pi.bash(command, timeoutMs?)`
 * - `pi.glob(pattern, cwd?)`
 */
function buildHarnessWrapperCode(userCode: string, cwd: string): string {
  return `
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const CWD = ${JSON.stringify(cwd)};

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.resolve(CWD, p);
}

const pi = {
  cwd: CWD,
  fs: {
    read(filePath, maxBytes = 500000) {
      const fullPath = resolvePath(filePath);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) throw new Error('Path is not a regular file: ' + filePath);
      const fd = fs.openSync(fullPath, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
        fs.readSync(fd, buffer, 0, buffer.length, 0);
        return buffer.toString('utf-8');
      } finally {
        fs.closeSync(fd);
      }
    },
    write(filePath, content) {
      const fullPath = resolvePath(filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
      return true;
    },
    exists(filePath) {
      return fs.existsSync(resolvePath(filePath));
    },
    list(dirPath = '.') {
      const fullPath = resolvePath(dirPath);
      return fs.readdirSync(fullPath, { withFileTypes: true }).map(dirent => ({
        name: dirent.name,
        isDirectory: dirent.isDirectory(),
        isFile: dirent.isFile(),
        path: path.relative(CWD, path.join(fullPath, dirent.name)),
      }));
    },
  },
  bash(command, timeout = 30000) {
    try {
      const stdout = execSync(command, {
        cwd: CWD,
        timeout,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout: stdout.trimEnd(), stderr: '', exitCode: 0, success: true };
    } catch (err) {
      return {
        stdout: (err.stdout || '').toString().trimEnd(),
        stderr: (err.stderr || '').toString().trimEnd(),
        exitCode: typeof err.status === 'number' ? err.status : 1,
        success: false,
      };
    }
  },
};

globalThis.pi = pi;

async function __runUserProgram__() {
  ${userCode.trim()}
}

__runUserProgram__()
  .then(val => {
    if (val !== undefined) {
      process.stdout.write('\\n[__PTC_VALUE_START__]\\n' + JSON.stringify(val) + '\\n[__PTC_VALUE_END__]\\n');
    }
    process.exit(0);
  })
  .catch(err => {
    process.stderr.write('\\n[__PTC_ERROR__]: ' + (err?.stack || err?.message || String(err)));
    process.exit(1);
  });
`;
}

/**
 * Ejecuta un programa de usuario en un subproceso aislado de Node.
 */
export async function runPtcProgram(options: PtcRunOptions): Promise<PtcRunResult> {
  const startTime = Date.now();
  const cwd = options.cwd || process.cwd();
  const timeoutMs = options.timeoutMs ?? 30000;

  const tempFileName = `dc-ptc-${randomBytes(6).toString("hex")}.mjs`;
  const tempFilePath = join(tmpdir(), tempFileName);

  const wrappedScript = buildHarnessWrapperCode(options.code, cwd);

  try {
    writeFileSync(tempFilePath, wrappedScript, "utf-8");
  } catch (err: any) {
    return {
      success: false,
      stdout: "",
      stderr: "",
      executionTimeMs: Date.now() - startTime,
      error: `Error al escribir archivo temporal de PTC: ${err.message}`,
    };
  }

  return new Promise<PtcRunResult>((resolve) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let finished = false;

    const child = spawn(process.execPath, [tempFilePath], {
      cwd,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill("SIGKILL");
        try {
          unlinkSync(tempFilePath);
        } catch {}
        resolve({
          success: false,
          stdout: stdoutBuffer,
          stderr: stderrBuffer + "\n[Timeout]: La ejecución excedió el límite de tiempo asignado.",
          executionTimeMs: Date.now() - startTime,
          error: `Execution timed out after ${timeoutMs}ms`,
        });
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf-8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf-8");
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      try {
        unlinkSync(tempFilePath);
      } catch {}

      const executionTimeMs = Date.now() - startTime;

      let extractedValue: unknown = undefined;
      const valStartIdx = stdoutBuffer.indexOf("\n[__PTC_VALUE_START__]\n");
      const valEndIdx = stdoutBuffer.indexOf("\n[__PTC_VALUE_END__]\n");

      let cleanStdout = stdoutBuffer;

      if (valStartIdx !== -1 && valEndIdx !== -1 && valEndIdx > valStartIdx) {
        const rawJson = stdoutBuffer.slice(
          valStartIdx + "\n[__PTC_VALUE_START__]\n".length,
          valEndIdx,
        );
        try {
          extractedValue = JSON.parse(rawJson);
        } catch {
          extractedValue = rawJson;
        }
        cleanStdout =
          stdoutBuffer.slice(0, valStartIdx) +
          stdoutBuffer.slice(valEndIdx + "\n[__PTC_VALUE_END__]\n".length);
      }

      const isSuccess = code === 0;

      resolve({
        success: isSuccess,
        value: extractedValue,
        stdout: cleanStdout.trim(),
        stderr: stderrBuffer.trim(),
        executionTimeMs,
        error: isSuccess ? undefined : `Proceso terminó con código de salida ${code}`,
      });
    });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        unlinkSync(tempFilePath);
      } catch {}

      resolve({
        success: false,
        stdout: stdoutBuffer,
        stderr: stderrBuffer + `\n${err.message}`,
        executionTimeMs: Date.now() - startTime,
        error: err.message,
      });
    });
  });
}
