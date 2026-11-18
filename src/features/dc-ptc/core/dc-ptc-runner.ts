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
import { classifyNativeToolScan } from "../../dc-scan-guard/dc-scan-guard.ts";

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
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const CWD = path.resolve(${JSON.stringify(cwd)});
const TMP_ROOT = path.resolve(os.tmpdir());
const REAL_CWD = fs.existsSync(CWD) ? fs.realpathSync(CWD) : CWD;
const REAL_TMP = fs.existsSync(TMP_ROOT) ? fs.realpathSync(TMP_ROOT) : TMP_ROOT;

const FORBIDDEN_SENSITIVE_PATTERNS = [
  /[/\\\\]\\.ssh([/\\\\]|$)/i,
  /[/\\\\]\\.gnupg([/\\\\]|$)/i,
  /[/\\\\]\\.aws([/\\\\]|$)/i,
  /[/\\\\]\\.config[/\\\\]gcloud([/\\\\]|$)/i,
  /[/\\\\]\\.config[/\\\\]gh([/\\\\]|$)/i,
  /[/\\\\]\\.azure([/\\\\]|$)/i,
  /[/\\\\]\\.netrc$/i,
  /[/\\\\]\\.bash_history$/i,
  /[/\\\\]\\.zsh_history$/i,
];

function isSensitiveCredentialPath(targetPath) {
  if (typeof targetPath !== 'string') return false;
  const clean = targetPath.trim().replace(/^['"]|['"]$/g, '');
  return FORBIDDEN_SENSITIVE_PATTERNS.some((pattern) => pattern.test(clean));
}

function isInsideRoot(target, root) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function resolveRealWithExistingAncestor(targetPath) {
  let curr = targetPath;
  const tail = [];
  while (!fs.existsSync(curr)) {
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
    throw new Error('dc-scan-guard (credential-protection): Access to sensitive credential path denied: ' + p);
  }
  if (/(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$)/.test(clean)) {
    throw new Error('dc-scan-guard: Path traversal (..) is not allowed in pi.fs: ' + p);
  }
  const isAbs = path.isAbsolute(clean);
  const resolved = isAbs ? path.resolve(clean) : path.resolve(CWD, clean);
  const allowedLexical = isInsideRoot(resolved, CWD) || (isAbs && isInsideRoot(resolved, TMP_ROOT));
  if (!allowedLexical) {
    throw new Error('dc-scan-guard: Path traversal or outside-workspace access denied for: ' + p);
  }
  const realResolved = resolveRealWithExistingAncestor(resolved);
  const allowedReal = isInsideRoot(realResolved, REAL_CWD) || (isAbs && isInsideRoot(realResolved, REAL_TMP));
  if (!allowedReal) {
    throw new Error('dc-scan-guard: Symlink or realpath escape outside workspace denied for: ' + p);
  }
  return resolved;
}

function normalizeCandidatePathToken(raw) {
  let t = String(raw ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
  if (t === '' || t === '.' || t === '..' || t.startsWith('./') || t.startsWith('../') || t.startsWith('.\\\\') || t.startsWith('..\\\\')) {
    return t;
  }
  for (const prefix of ['~', '$HOME', '\${HOME}']) {
    if (t === prefix || t.startsWith(prefix + '/') || t.startsWith(prefix + '\\\\')) {
      const rest = t.slice(prefix.length).replace(/\\\\/g, '/');
      const normRest = path.posix.normalize('/' + rest);
      if (normRest === '/') return prefix;
      return prefix + normRest.replace(/\\/+$/, '');
    }
  }
  if (/^[a-zA-Z]:[\\\\/]/.test(t)) {
    const drive = t.slice(0, 2);
    const rest = t.slice(2).replace(/\\\\/g, '/');
    const normRest = path.posix.normalize('/' + rest);
    if (normRest === '/') return drive + '/';
    return drive + normRest.replace(/\\/+$/, '');
  }
  if (t.startsWith('/')) {
    const norm = path.posix.normalize(t.replace(/\\/+\\.+(\\/|$)/g, '/'));
    if (norm === '/') return '/';
    return norm.replace(/\\/+$/, '');
  }
  if (t.length > 1) t = t.replace(/[/\\\\]+$/, '');
  return t;
}

function isRootPath(token) {
  const t = normalizeCandidatePathToken(token);
  if (t === '/' || t === '\\\\' || t === '~') return true;
  if (/^\\/[a-zA-Z]$/.test(t)) return true;
  if (/^[a-zA-Z]:[\\\\/]?$/.test(t)) return true;
  const home = t.replace(/[/\\\\]$/, '');
  if (home === '$HOME' || home === '\${HOME}') return true;
  if (/^%(USERPROFILE|HOMEPATH|HOMEDRIVE|HOME)%$/i.test(home)) return true;
  try {
    const userHome = os.homedir().replace(/[/\\\\]$/, '');
    if (userHome && home === userHome) return true;
  } catch {}
  return false;
}

function classifyRuntimeShellCommand(command, depth = 0) {
  if (typeof command !== 'string' || command.trim() === '' || depth > 3) {
    return { block: false };
  }
  const shellRe = /(?:^|[\\s;|&()])(?:\\/usr\\/bin\\/env\\s+)?(?:\\/bin\\/|\\/usr\\/bin\\/)?(?:sh|bash|zsh|dash|ksh)\\s+(?:-[a-zA-Z]+\\s+)*-[a-zA-Z]*c\\s+("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')/g;
  let m;
  while ((m = shellRe.exec(command)) !== null) {
    const inner = m[1].slice(1, -1).replace(/\\\\(["'\\\\])/g, '$1');
    const sub = classifyRuntimeShellCommand(inner, depth + 1);
    if (sub.block) return sub;
  }
  const segments = command.split(/\\n|;|&&|\\|\\||\\|/).map(s => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const tokens = seg.split(/\\s+/).filter(Boolean);
    const rmIdx = tokens.findIndex(t => {
      const c = t.replace(/^['"]|['"]$/g, '');
      return c === 'rm' || /[/\\\\]rm$/.test(c);
    });
    if (rmIdx !== -1) {
      const hasRec = tokens.some((t, i) => {
        if (i <= rmIdx) return false;
        const c = t.replace(/^['"]|['"]$/g, '');
        return /^-[a-zA-Z]*[rR]/.test(c) || c === '--recursive' || c === '-r' || c === '-R';
      });
      if (hasRec) {
        for (let i = rmIdx + 1; i < tokens.length; i++) {
          const tok = tokens[i].replace(/^['"]|['"]$/g, '');
          if (tok.startsWith('-')) continue;
          if (isRootPath(tok) || tok === '/*' || tok === '~/*' || tok === '.*' || tok === '$HOME/*' || tok === '\${HOME}/*' || /^[/\\\\]\\*+$/.test(tok) || /^\\~[/\\\\]\\*+$/.test(tok)) {
            return { block: true, reason: 'dc-scan-guard (dual-encoding): se bloqueó un comando destructivo masivo en pi.bash: ' + seg };
          }
          if (/[/\\\\]\\*+$/.test(tok)) {
            const base = tok.replace(/[/\\\\]\\*+$/, '') || '/';
            if (isRootPath(base)) {
              return { block: true, reason: 'dc-scan-guard (dual-encoding): se bloqueó un comando destructivo masivo en pi.bash: ' + seg };
            }
          }
        }
      }
    }
    for (const token of tokens) {
      if (isSensitiveCredentialPath(token)) {
        return { block: true, reason: 'dc-scan-guard (credential-protection): se bloqueó acceso a credenciales en pi.bash: ' + token };
      }
    }
    const findIdx = tokens.findIndex(t => t === 'find' || /[/\\\\]find$/.test(t));
    if (findIdx !== -1) {
      for (let i = findIdx + 1; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok === '-H' || tok === '-L' || tok === '-P' || /^-[DO]\\d*$/.test(tok) || /^--exec/.test(tok)) continue;
        if (tok.startsWith('-') || tok === '(' || tok === '!' || tok === ')') break;
        if (isRootPath(tok)) {
          return { block: true, reason: 'dc-scan-guard: se bloqueó un escaneo recursivo en la raíz en pi.bash: ' + seg };
        }
      }
    }
  }
  return { block: false };
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
    const guard = classifyRuntimeShellCommand(command);
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
      env: buildSafePtcEnv(process.env, options.env),
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
