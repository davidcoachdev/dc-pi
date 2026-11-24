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
import {
  classifyNativeToolScan,
  serializeScanGuardRuntimeSource,
} from "../../dc-scan-guard/dc-scan-guard.ts";

export const PTC_MIN_TIMEOUT_MS = 100;
export const PTC_MAX_TIMEOUT_MS = 60_000;
export const PTC_DEFAULT_TIMEOUT_MS = 30_000;
export const PTC_MAX_OUTPUT_BYTES = 256 * 1024;

export type PtcRunWithSignalOptions = PtcRunOptions & {
  signal?: AbortSignal;
  maxOutputBytes?: number;
};

export function clampPtcTimeoutMs(rawTimeoutMs: unknown): number {
  if (typeof rawTimeoutMs !== "number" || Number.isNaN(rawTimeoutMs)) {
    return PTC_DEFAULT_TIMEOUT_MS;
  }
  if (rawTimeoutMs >= PTC_MAX_TIMEOUT_MS) return PTC_MAX_TIMEOUT_MS;
  if (rawTimeoutMs <= PTC_MIN_TIMEOUT_MS) return PTC_MIN_TIMEOUT_MS;
  return Math.floor(rawTimeoutMs);
}

interface BoundedStreamBuffer {
  chunks: Buffer[];
  bytes: number;
  truncated: boolean;
  droppedBytes: number;
  maxBytes: number;
  streamName: "stdout" | "stderr";
}

function createBoundedBuffer(streamName: "stdout" | "stderr", maxBytes: number): BoundedStreamBuffer {
  return {
    chunks: [],
    bytes: 0,
    truncated: false,
    droppedBytes: 0,
    maxBytes,
    streamName,
  };
}

function appendBoundedBuffer(buf: BoundedStreamBuffer, chunk: Buffer): void {
  if (buf.bytes >= buf.maxBytes) {
    buf.truncated = true;
    buf.droppedBytes += chunk.length;
    return;
  }
  const remaining = buf.maxBytes - buf.bytes;
  if (chunk.length <= remaining) {
    buf.chunks.push(chunk);
    buf.bytes += chunk.length;
  } else {
    buf.chunks.push(chunk.subarray(0, remaining));
    buf.bytes += remaining;
    buf.truncated = true;
    buf.droppedBytes += chunk.length - remaining;
  }
}

function readBoundedBuffer(buf: BoundedStreamBuffer): string {
  const text = Buffer.concat(buf.chunks, buf.bytes).toString("utf-8");
  if (!buf.truncated) return text;
  return `${text}\n[dc-ptc: ${buf.streamName} truncated at ${buf.maxBytes} bytes (${buf.droppedBytes} bytes omitted)]`;
}

const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "NODE_ENV",
  "TZ",
  "SYSTEMROOT",
  "COMSPEC",
  "WINDIR",
  "PATHEXT",
  "USERPROFILE",
] as const;

const SENSITIVE_ENV_KEY_RE =
  /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS|AUTH|PRIVATE|COOKIE|SESSION)(?:$|_)|^(?:DATABASE_URL|REDIS_URL|OPENAI_|ANTHROPIC_|GITHUB_|GH_|AWS_|AZURE_|GCP_|GOOGLE_|DEEPSEEK_|GEMINI_)/i;

export function buildSafePtcEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  extraEnv?: Record<string, string | undefined>,
): Record<string, string> {
  const safeEnv: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const val = baseEnv[key];
    if (typeof val === "string") {
      safeEnv[key] = val;
    }
  }
  if (extraEnv) {
    for (const [key, val] of Object.entries(extraEnv)) {
      if (typeof val === "string" && !SENSITIVE_ENV_KEY_RE.test(key)) {
        safeEnv[key] = val;
      }
    }
  }
  return safeEnv;
}

/**
 * Plantilla del script que se ejecuta en el proceso hijo de Node.js.
 * Ejecuta `userCode` dentro de un contexto VM aislado (`node:vm`) sin acceso
 * léxico ni de prototipo a `fs`, `os`, `path`, `execSync`, `process` o `require`.
 * Las reglas de seguridad provienen directamente de `dc-scan-guard.ts` (fuente única).
 */
function buildHarnessWrapperCode(userCode: string, cwd: string, timeoutMs: number): string {
  const canonicalGuardSource = serializeScanGuardRuntimeSource();
  return `
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { execSync } from 'node:child_process';

const CWD = path.resolve(${JSON.stringify(cwd)});
const TMP_ROOT = path.resolve(os.tmpdir());
const REAL_CWD = fs.existsSync(CWD) ? fs.realpathSync(CWD) : CWD;
const REAL_TMP = fs.existsSync(TMP_ROOT) ? fs.realpathSync(TMP_ROOT) : TMP_ROOT;
const EFFECTIVE_TIMEOUT_MS = ${JSON.stringify(timeoutMs)};
const MIN_BASH_TIMEOUT_MS = ${JSON.stringify(PTC_MIN_TIMEOUT_MS)};
const MAX_BASH_TIMEOUT_MS = Math.min(${JSON.stringify(PTC_MAX_TIMEOUT_MS)}, EFFECTIVE_TIMEOUT_MS);
const USER_CODE = ${JSON.stringify(userCode)};
const MAX_SYMLINK_DEPTH = 32;

// Reglas canónicas derivadas de src/features/dc-scan-guard/dc-scan-guard.ts (fuente única de verdad)
${canonicalGuardSource}

function isInsideRoot(target, root) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveRealWithExistingAncestor(targetPath, visited = new Set()) {
  if (visited.size >= MAX_SYMLINK_DEPTH) {
    throw new Error('dc-scan-guard: Symlink loop or excessive symlink depth denied for: ' + targetPath);
  }
  let curr = path.resolve(targetPath);
  const tail = [];
  while (!fs.existsSync(curr)) {
    let stat = null;
    try {
      stat = fs.lstatSync(curr);
    } catch {
      stat = null;
    }
    if (stat && stat.isSymbolicLink()) {
      if (visited.has(curr)) {
        throw new Error('dc-scan-guard: Symlink loop detected for: ' + targetPath);
      }
      const nextVisited = new Set(visited);
      nextVisited.add(curr);
      const linkTarget = fs.readlinkSync(curr);
      const parentDir = path.dirname(curr);
      const parentReal =
        parentDir === curr
          ? curr
          : resolveRealWithExistingAncestor(parentDir, new Set(nextVisited));
      const resolvedTarget = path.resolve(parentReal, linkTarget);
      const nextTarget = tail.length > 0 ? path.join(resolvedTarget, ...tail) : resolvedTarget;
      return resolveRealWithExistingAncestor(nextTarget, nextVisited);
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    tail.unshift(path.basename(curr));
    curr = parent;
  }
  const realBase = fs.existsSync(curr) ? fs.realpathSync(curr) : curr;
  return tail.length > 0 ? path.join(realBase, ...tail) : realBase;
}

function resolvePath(p) {
  if (typeof p !== 'string' || p.trim() === '') {
    throw new Error('dc-scan-guard: Invalid path argument in pi.fs');
  }
  const clean = p.trim();
  if (isSensitiveCredentialPath(clean)) {
    throw new Error(sensitiveCredentialReason(clean));
  }
  if (/(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$)/.test(clean)) {
    throw new Error('dc-scan-guard: Path traversal (..) is not allowed in pi.fs: ' + p);
  }
  const isAbs = path.isAbsolute(clean);
  const resolved = isAbs ? path.resolve(clean) : path.resolve(CWD, clean);
  const lexicalInCwd = isInsideRoot(resolved, CWD);
  const lexicalInTmp = isAbs && isInsideRoot(resolved, TMP_ROOT);
  if (!lexicalInCwd && !lexicalInTmp) {
    throw new Error('dc-scan-guard: Path traversal or outside-workspace access denied for: ' + p);
  }
  const realResolved = resolveRealWithExistingAncestor(resolved);
  if (isSensitiveCredentialPath(realResolved)) {
    throw new Error(sensitiveCredentialReason(realResolved));
  }
  const allowedReal = lexicalInCwd
    ? isInsideRoot(realResolved, REAL_CWD)
    : isInsideRoot(realResolved, REAL_TMP);
  if (!allowedReal) {
    throw new Error('dc-scan-guard: Symlink or realpath escape outside workspace denied for: ' + p);
  }
  return resolved;
}

function clampBashTimeout(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MAX_BASH_TIMEOUT_MS;
  return Math.min(MAX_BASH_TIMEOUT_MS, Math.max(MIN_BASH_TIMEOUT_MS, Math.floor(raw)));
}

const activeTimers = new Map();
let fireVmTimer = null;
let outcomeDelivered = false;

function hostBridge(op, argsJson) {
  try {
    if (outcomeDelivered) {
      return '{"ok":false,"error":"PTC execution already completed"}';
    }
    if (typeof op !== 'string' || typeof argsJson !== 'string') {
      return JSON.stringify({ ok: false, error: 'Invalid PTC bridge arguments' });
    }
    const args = JSON.parse(argsJson);
    if (!Array.isArray(args)) {
      return JSON.stringify({ ok: false, error: 'Invalid PTC bridge args payload' });
    }
    let value;
    switch (op) {
      case 'cwd':
        value = CWD;
        break;
      case 'fs.read': {
        const filePath = args[0];
        const rawMaxBytes = args[1];
        const maxBytes =
          typeof rawMaxBytes === 'number' && Number.isFinite(rawMaxBytes) && rawMaxBytes > 0
            ? Math.min(Math.floor(rawMaxBytes), 5_000_000)
            : 500_000;
        const fullPath = resolvePath(filePath);
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) throw new Error('Path is not a regular file: ' + filePath);
        const fd = fs.openSync(fullPath, 'r');
        try {
          const buffer = Buffer.alloc(Math.min(stat.size, maxBytes));
          fs.readSync(fd, buffer, 0, buffer.length, 0);
          value = buffer.toString('utf-8');
        } finally {
          fs.closeSync(fd);
        }
        break;
      }
      case 'fs.write': {
        const filePath = args[0];
        const content = args[1];
        if (typeof content !== 'string') {
          throw new Error('pi.fs.write requires string content');
        }
        const fullPath = resolvePath(filePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content, 'utf-8');
        value = true;
        break;
      }
      case 'fs.exists': {
        value = fs.existsSync(resolvePath(args[0]));
        break;
      }
      case 'fs.list': {
        const dirPath = typeof args[0] === 'string' && args[0].length > 0 ? args[0] : '.';
        const fullPath = resolvePath(dirPath);
        value = fs.readdirSync(fullPath, { withFileTypes: true }).map((dirent) => ({
          name: dirent.name,
          isDirectory: dirent.isDirectory(),
          isFile: dirent.isFile(),
          path: path.relative(CWD, path.join(fullPath, dirent.name)),
        }));
        break;
      }
      case 'bash': {
        const command = args[0];
        const timeout = clampBashTimeout(args[1]);
        const guard = classifyShellCommand(command);
        if (guard.block) {
          throw new Error(guard.reason || 'dc-scan-guard: destructive shell command blocked');
        }
        try {
          const stdout = execSync(command, {
            cwd: CWD,
            timeout,
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
          });
          value = { stdout: stdout.trimEnd(), stderr: '', exitCode: 0, success: true };
        } catch (err) {
          value = {
            stdout: (err.stdout || '').toString().trimEnd(),
            stderr: (err.stderr || '').toString().trimEnd(),
            exitCode: typeof err.status === 'number' ? err.status : 1,
            success: false,
          };
        }
        break;
      }
      case 'console.out': {
        process.stdout.write(String(args[0] ?? '') + '\\n');
        value = null;
        break;
      }
      case 'console.err': {
        process.stderr.write(String(args[0] ?? '') + '\\n');
        value = null;
        break;
      }
      default:
        throw new Error('Unknown PTC bridge operation: ' + op);
    }
    return JSON.stringify({ ok: true, value });
  } catch (err) {
    try {
      const msg = err && typeof err.message === 'string' ? err.message : String(err);
      return JSON.stringify({ ok: false, error: msg });
    } catch {
      return '{"ok":false,"error":"PTC bridge error"}';
    }
  }
}

function clearAllActiveTimers() {
  try {
    for (const handle of activeTimers.values()) {
      clearTimeout(handle);
    }
    activeTimers.clear();
  } catch {
    // swallow
  }
}

function scheduleTimer(cbId, delayMs) {
  try {
    if (outcomeDelivered) {
      return 0;
    }
    if (typeof cbId !== 'number' || !Number.isInteger(cbId) || cbId <= 0) {
      return 0;
    }
    const safeDelay =
      typeof delayMs === 'number' && Number.isFinite(delayMs)
        ? Math.max(0, Math.min(Math.floor(delayMs), EFFECTIVE_TIMEOUT_MS))
        : 0;
    const handle = setTimeout(() => {
      activeTimers.delete(cbId);
      try {
        if (typeof fireVmTimer === 'function') {
          fireVmTimer(cbId);
        }
      } catch {
        // Never allow VM timer error to crash host unhandled
      }
    }, safeDelay);
    activeTimers.set(cbId, handle);
    return cbId;
  } catch {
    return 0;
  }
}

function cancelTimer(id) {
  try {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      return;
    }
    const handle = activeTimers.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      activeTimers.delete(id);
    }
  } catch {
    // swallow
  }
}

function finishProcess(code) {
  process.exitCode = code;
  let remaining = 2;
  const done = () => {
    remaining -= 1;
    if (remaining <= 0) {
      process.exit(code);
    }
  };
  try {
    process.stdout.write('', done);
  } catch {
    done();
  }
  try {
    process.stderr.write('', done);
  } catch {
    done();
  }
}

function deliverOutcome(kind, payload) {
  try {
    if (outcomeDelivered) return;
    if (typeof kind !== 'string') return;
    const text = typeof payload === 'string' ? payload : '';
    outcomeDelivered = true;
    clearAllActiveTimers();
    if (kind === 'ok_undefined') {
      finishProcess(0);
    } else if (kind === 'ok_value') {
      if (text.length > 0) {
        process.stdout.write('\\n[__PTC_VALUE_START__]\\n' + text + '\\n[__PTC_VALUE_END__]\\n');
      }
      finishProcess(0);
    } else {
      process.stderr.write('\\n[__PTC_ERROR__]: ' + (text || 'Unknown PTC error'));
      finishProcess(1);
    }
  } catch {
    try {
      clearAllActiveTimers();
      process.stderr.write('\\n[__PTC_ERROR__]: Failed to deliver PTC outcome');
    } catch {}
    finishProcess(1);
  }
}

const sandboxContext = vm.createContext(Object.create(null), {
  name: 'dc-ptc-sandbox',
  codeGeneration: { strings: false, wasm: false },
});

const bootstrapFn = vm.compileFunction(
  \`'use strict';
    const vmJsonParse = JSON.parse;
    const vmJsonStringify = JSON.stringify;
    const vmError = Error;
    const vmTypeError = TypeError;
    const vmString = String;
    const vmNumber = Number;
    const vmNumberIsFinite = Number.isFinite;
    const vmNumberIsInteger = Number.isInteger;
    const vmMathFloor = Math.floor;
    const vmObjectCreate = Object.create;
    const vmObjectFreeze = Object.freeze;
    const vmObjectDefineProperty = Object.defineProperty;
    const vmObjectHasOwn = Object.hasOwn;
    const vmPromiseThen = Promise.prototype.then;
    const vmReflectApply = Reflect.apply;

    function invoke(op, args) {
      const payload = vmJsonStringify(args);
      const raw = bridge(op, typeof payload === 'string' ? payload : '[]');
      if (typeof raw !== 'string') return undefined;
      const parsed = vmJsonParse(raw);
      if (parsed && vmObjectHasOwn(parsed, 'ok') && parsed.ok === true) {
        return vmObjectHasOwn(parsed, 'value') ? parsed.value : undefined;
      }
      throw new vmError(vmString((parsed && parsed.error) || 'PTC bridge error'));
    }

    function formatArg(arg) {
      if (typeof arg === 'string') return arg;
      if (
        arg === null ||
        arg === undefined ||
        typeof arg === 'number' ||
        typeof arg === 'boolean' ||
        typeof arg === 'bigint' ||
        typeof arg === 'symbol'
      ) {
        return vmString(arg);
      }
      if (arg instanceof vmError) {
        return arg.stack || arg.message || vmString(arg);
      }
      try {
        return vmJsonStringify(arg);
      } catch {
        try {
          return vmString(arg);
        } catch {
          return '[Unprintable value]';
        }
      }
    }

    function formatConsoleArgs(argList) {
      let out = '';
      for (let i = 0; i < argList.length; i++) {
        if (i > 0) out += ' ';
        out += formatArg(argList[i]);
      }
      return out;
    }

    function serializeValueSafe(val) {
      if (val === undefined) return '';
      try {
        const json = vmJsonStringify(val);
        return typeof json === 'string' ? json : '';
      } catch {
        try {
          const str = vmString(val);
          const json = vmJsonStringify(str);
          return typeof json === 'string' ? json : '';
        } catch {
          return '"[Unserializable value]"';
        }
      }
    }

    function formatErrorSafe(err) {
      try {
        if (err && typeof err === 'object') {
          if (typeof err.stack === 'string' && err.stack.length > 0) return err.stack;
          if (typeof err.message === 'string' && err.message.length > 0) return err.message;
        }
        return vmString(err);
      } catch {
        return 'Unknown PTC VM error';
      }
    }

    const piObj = vmObjectFreeze({
      cwd: invoke('cwd', []),
      fs: vmObjectFreeze({
        read(filePath, maxBytes) { return invoke('fs.read', [filePath, maxBytes]); },
        write(filePath, content) { return invoke('fs.write', [filePath, content]); },
        exists(filePath) { return invoke('fs.exists', [filePath]); },
        list(dirPath) { return invoke('fs.list', [dirPath]); },
      }),
      bash(command, timeout) { return invoke('bash', [command, timeout]); },
    });

    const consoleObj = vmObjectFreeze({
      log() { invoke('console.out', [formatConsoleArgs(arguments)]); },
      info() { invoke('console.out', [formatConsoleArgs(arguments)]); },
      debug() { invoke('console.out', [formatConsoleArgs(arguments)]); },
      warn() { invoke('console.err', [formatConsoleArgs(arguments)]); },
      error() { invoke('console.err', [formatConsoleArgs(arguments)]); },
    });

    let nextCbId = 1;
    const pendingTimers = vmObjectCreate(null);

    function safeSetTimeout(fn, delay) {
      if (typeof fn !== 'function') {
        throw new vmTypeError('dc-ptc: setTimeout requires a function callback');
      }
      let safeDelay = 0;
      if (typeof delay === 'number' && vmNumberIsFinite(delay) && delay > 0) {
        safeDelay = vmMathFloor(delay);
      } else if (typeof delay === 'string') {
        const parsed = vmNumber(delay);
        if (vmNumberIsFinite(parsed) && parsed > 0) {
          safeDelay = vmMathFloor(parsed);
        }
      }
      const cbArgs = vmObjectCreate(null);
      const argCount = arguments.length > 2 ? arguments.length - 2 : 0;
      cbArgs.length = argCount;
      for (let i = 0; i < argCount; i++) {
        cbArgs[i] = arguments[i + 2];
      }
      const cbId = nextCbId++;
      pendingTimers[cbId] = { fn, args: cbArgs };
      const scheduled = addTimer(cbId, safeDelay);
      if (scheduled !== cbId) {
        delete pendingTimers[cbId];
        return 0;
      }
      return cbId;
    }

    function safeClearTimeout(id) {
      if (typeof id !== 'number' || !vmNumberIsFinite(id) || !vmNumberIsInteger(id) || id <= 0) {
        return;
      }
      delete pendingTimers[id];
      delTimer(id);
    }

    function fireTimer(cbId) {
      const entry = pendingTimers[cbId];
      if (!entry) return;
      delete pendingTimers[cbId];
      try {
        vmReflectApply(entry.fn, undefined, entry.args);
      } catch (err) {
        try {
          invoke('console.err', ['[__PTC_ERROR__]: ' + formatErrorSafe(err)]);
        } catch {}
      }
    }

    function createVmError(message) {
      return new vmError(typeof message === 'string' ? message : 'PTC error');
    }

    function runUserFunction(userFn) {
      let settled = false;
      function finishOk(val) {
        if (settled) return;
        settled = true;
        if (val === undefined) {
          deliverOutcome('ok_undefined', '');
        } else {
          deliverOutcome('ok_value', serializeValueSafe(val));
        }
      }
      function finishErr(err) {
        if (settled) return;
        settled = true;
        deliverOutcome('error', formatErrorSafe(err));
      }
      try {
        const emptyArgs = vmObjectCreate(null);
        emptyArgs.length = 0;
        const promise = vmReflectApply(userFn, undefined, emptyArgs);
        const thenArgs = vmObjectCreate(null);
        thenArgs[0] = finishOk;
        thenArgs[1] = finishErr;
        thenArgs.length = 2;
        vmReflectApply(vmPromiseThen, promise, thenArgs);
      } catch (err) {
        finishErr(err);
      }
    }

    vmObjectDefineProperty(globalThis, 'pi', {
      value: piObj,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    vmObjectDefineProperty(globalThis, 'console', {
      value: consoleObj,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    vmObjectDefineProperty(globalThis, 'setTimeout', {
      value: safeSetTimeout,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    vmObjectDefineProperty(globalThis, 'clearTimeout', {
      value: safeClearTimeout,
      writable: false,
      enumerable: true,
      configurable: false,
    });

    return { runUserFunction, fireTimer, createVmError };
  \`,
  ['bridge', 'addTimer', 'delTimer', 'deliverOutcome'],
  {
    filename: 'dc-ptc-bootstrap.js',
    parsingContext: sandboxContext,
  },
);

const vmControls = bootstrapFn(hostBridge, scheduleTimer, cancelTimer, deliverOutcome);
fireVmTimer = vmControls.fireTimer;
const runUserFunction = vmControls.runUserFunction;
const createVmError = vmControls.createVmError;

try {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  // Validate USER_CODE strictly as a single AsyncFunctionBody to prevent IIFE syntax breakout
  new AsyncFunction('"use strict";\\n' + USER_CODE + '\\n');
} catch (err) {
  clearAllActiveTimers();
  process.stderr.write('\\n[__PTC_ERROR__]: ' + (err?.stack || err?.message || String(err)));
  process.exit(1);
}

let userFn;
try {
  const userScript = new vm.Script(
    '(async function __runUserProgram__() {\\n"use strict";\\n' + USER_CODE + '\\n})',
    {
      filename: 'dc-ptc-user.js',
      importModuleDynamically() {
        throw createVmError('dc-scan-guard: dynamic import() is disabled in PTC sandbox');
      },
    },
  );
  userFn = userScript.runInContext(sandboxContext);
} catch (err) {
  clearAllActiveTimers();
  process.stderr.write('\\n[__PTC_ERROR__]: ' + (err?.stack || err?.message || String(err)));
  process.exit(1);
}

try {
  runUserFunction(userFn);
} catch {
  deliverOutcome('error', 'Failed to execute PTC user program');
}
`;
}

/**
 * Ejecuta un programa de usuario en un subproceso aislado de Node.
 */
export async function runPtcProgram(options: PtcRunWithSignalOptions): Promise<PtcRunResult> {
  const startTime = Date.now();
  const cwd = options.cwd || process.cwd();
  const timeoutMs = clampPtcTimeoutMs(options.timeoutMs);
  const maxOutputBytes =
    typeof options.maxOutputBytes === "number" && Number.isFinite(options.maxOutputBytes) && options.maxOutputBytes > 0
      ? Math.floor(options.maxOutputBytes)
      : PTC_MAX_OUTPUT_BYTES;

  if (options.signal?.aborted) {
    return {
      success: false,
      stdout: "",
      stderr: "[Aborted]: La ejecución PTC fue cancelada por AbortSignal.",
      executionTimeMs: Date.now() - startTime,
      error: "Execution aborted by AbortSignal",
    };
  }

  const scanDecision = classifyNativeToolScan("dc_ptc_run", {
    code: options.code,
    cwd,
  });
  if (scanDecision.block) {
    return {
      success: false,
      stdout: "",
      stderr: scanDecision.reason || "dc-scan-guard: ejecución PTC bloqueada",
      executionTimeMs: Date.now() - startTime,
      error: scanDecision.reason || "dc-scan-guard: ejecución PTC bloqueada",
    };
  }

  const tempFileName = `dc-ptc-${randomBytes(6).toString("hex")}.mjs`;
  const tempFilePath = join(tmpdir(), tempFileName);

  const wrappedScript = buildHarnessWrapperCode(options.code, cwd, timeoutMs);

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
    const stdoutState = createBoundedBuffer("stdout", maxOutputBytes);
    const stderrState = createBoundedBuffer("stderr", maxOutputBytes);
    let finished = false;

    const child = spawn(process.execPath, [tempFilePath], {
      cwd,
      env: buildSafePtcEnv(process.env, options.env),
      stdio: ["ignore", "pipe", "pipe"],
    });

    const cleanup = () => {
      clearTimeout(timer);
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      try {
        unlinkSync(tempFilePath);
      } catch {}
    };

    const onAbort = () => {
      if (finished) return;
      finished = true;
      try {
        child.kill("SIGKILL");
      } catch {}
      cleanup();
      resolve({
        success: false,
        stdout: readBoundedBuffer(stdoutState).trim(),
        stderr: (readBoundedBuffer(stderrState) + "\n[Aborted]: La ejecución PTC fue cancelada por AbortSignal.").trim(),
        executionTimeMs: Date.now() - startTime,
        error: "Execution aborted by AbortSignal",
      });
    };

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try {
          child.kill("SIGKILL");
        } catch {}
        cleanup();
        resolve({
          success: false,
          stdout: readBoundedBuffer(stdoutState).trim(),
          stderr: (readBoundedBuffer(stderrState) + "\n[Timeout]: La ejecución excedió el límite de tiempo asignado.").trim(),
          executionTimeMs: Date.now() - startTime,
          error: `Execution timed out after ${timeoutMs}ms`,
        });
      }
    }, timeoutMs);
    timer.unref?.();

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk: Buffer) => {
      appendBoundedBuffer(stdoutState, chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      appendBoundedBuffer(stderrState, chunk);
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      cleanup();

      const executionTimeMs = Date.now() - startTime;
      const rawStdout = Buffer.concat(stdoutState.chunks, stdoutState.bytes).toString("utf-8");

      let extractedValue: unknown = undefined;
      let cleanStdout = rawStdout;

      if (!stdoutState.truncated) {
        const valStartIdx = rawStdout.indexOf("\n[__PTC_VALUE_START__]\n");
        const valEndIdx = rawStdout.indexOf("\n[__PTC_VALUE_END__]\n");

        if (valStartIdx !== -1 && valEndIdx !== -1 && valEndIdx > valStartIdx) {
          const rawJson = rawStdout.slice(
            valStartIdx + "\n[__PTC_VALUE_START__]\n".length,
            valEndIdx,
          );
          try {
            extractedValue = JSON.parse(rawJson);
          } catch {
            extractedValue = rawJson;
          }
          cleanStdout =
            rawStdout.slice(0, valStartIdx) +
            rawStdout.slice(valEndIdx + "\n[__PTC_VALUE_END__]\n".length);
        }
      } else {
        cleanStdout = readBoundedBuffer(stdoutState);
      }

      const isSuccess = code === 0;

      resolve({
        success: isSuccess,
        value: extractedValue,
        stdout: cleanStdout.trim(),
        stderr: readBoundedBuffer(stderrState).trim(),
        executionTimeMs,
        error: isSuccess ? undefined : `Proceso terminó con código de salida ${code}`,
      });
    });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      cleanup();

      resolve({
        success: false,
        stdout: readBoundedBuffer(stdoutState).trim(),
        stderr: (readBoundedBuffer(stderrState) + `\n${err.message}`).trim(),
        executionTimeMs: Date.now() - startTime,
        error: err.message,
      });
    });
  });
}
