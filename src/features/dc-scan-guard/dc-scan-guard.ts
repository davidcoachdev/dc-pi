/**
 * dc-scan-guard — Filesystem-wide scan guard for DC Studio.
 *
 * Blocks dangerous, unbounded recursive scans (find, grep -r, rg) rooted at
 * filesystem roots (/, ~, C:\, etc.) that can wedge processes indefinitely
 * (e.g. cloud storage hydration like OneDrive in WSL/Windows, or scanning
 * pseudo-filesystems in Linux).
 */

import * as os from "node:os";
import * as path from "node:path";

export interface ScanGuardDecision {
  block: boolean;
  reason?: string;
}

export const GUARDED_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "shell",
  "sh",
  "grep",
  "find",
  "read",
  "edit",
  "write",
  "dc_ptc_run",
]);

function normalizeCandidatePathToken(raw: string): string {
  let t = raw.trim().replace(/^['"]|['"]$/g, "").trim();
  if (t === "" || t === "." || t === ".." || t.startsWith("./") || t.startsWith("../") || t.startsWith(".\\") || t.startsWith("..\\")) {
    return t;
  }

  // Strip trailing /. or /.. or /./ segments on home variables and ~
  for (const prefix of ["~", "$HOME", "${HOME}"]) {
    if (t === prefix || t.startsWith(prefix + "/") || t.startsWith(prefix + "\\")) {
      const rest = t.slice(prefix.length).replace(/\\/g, "/");
      const normRest = path.posix.normalize("/" + rest);
      if (normRest === "/") return prefix;
      return prefix + normRest.replace(/\/+$/, "");
    }
  }

  // Windows drive paths e.g. C:\. or C:/.
  if (/^[a-zA-Z]:[\\/]/.test(t)) {
    const drive = t.slice(0, 2);
    const rest = t.slice(2).replace(/\\/g, "/");
    const normRest = path.posix.normalize("/" + rest);
    if (normRest === "/") return drive + "/";
    return drive + normRest.replace(/\/+$/, "");
  }

  // POSIX absolute paths
  if (t.startsWith("/")) {
    const norm = path.posix.normalize(t.replace(/\/+\.+(\/|$)/g, "/"));
    if (norm === "/") return "/";
    return norm.replace(/\/+$/, "");
  }

  if (t.length > 1) {
    t = t.replace(/[/\\]+$/, "");
  }
  return t;
}

/**
 * Checks if a token represents a filesystem root.
 */
export function isRootPath(token: string): boolean {
  if (typeof token !== "string") return false;
  const t = normalizeCandidatePathToken(token);

  if (t === "/" || t === "\\") return true;
  if (t === "~") return true;

  // Single-letter drive mount e.g. /c or /d
  if (/^\/[a-zA-Z]$/.test(t)) return true;

  // Windows drive root: C:, C:\, c:/
  if (/^[a-zA-Z]:[\\/]?$/.test(t)) return true;

  // Home env vars
  const home = t.replace(/[/\\]$/, "");
  if (home === "$HOME" || home === "${HOME}") return true;
  if (/^%(USERPROFILE|HOMEPATH|HOMEDRIVE|HOME)%$/i.test(home)) return true;

  // Real user home directory (ej: /home/dc-studio o C:\Users\dc-studio)
  try {
    const userHome = os.homedir().replace(/[/\\]$/, "");
    if (userHome && home === userHome) return true;
  } catch {
    /* ignore */
  }

  return false;
}

export function splitSegments(command: string): string[] {
  return command
    .split(/\n|;|&&|\|\||\|/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tokenize(segment: string): string[] {
  return segment.split(/\s+/).filter((t) => t.length > 0);
}

function isRootedFind(tokens: string[]): boolean {
  const idx = tokens.findIndex((t) => t === "find" || /[/\\]find$/.test(t));
  if (idx === -1) return false;

  // find acepta flags iniciales de enlace simbólico (-H, -L, -P, -D, -O) antes de los directorios
  for (let i = idx + 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === "-H" || tok === "-L" || tok === "-P" || /^-[DO]\d*$/.test(tok) || /^--exec/.test(tok)) {
      continue;
    }
    if (tok.startsWith("-") || tok === "(" || tok === "!" || tok === ")") break;
    if (isRootPath(tok)) return true;
  }
  return false;
}

function isRecursiveGrep(tokens: string[]): boolean {
  const idx = tokens.findIndex((t) => t === "grep" || /[/\\]grep$/.test(t));
  if (idx === -1) return false;
  return tokens.slice(idx + 1).some((t, i, arr) => {
    if (t === "--recursive" || t === "--dereference-recursive") return true;
    if (t === "--directories=recurse") return true;
    if (t === "--directories" && arr[i + 1] === "recurse") return true;
    if (/^-[a-zA-Z]*[rR]/.test(t)) return true;
    return false;
  });
}

function isRootedRecursiveSearch(tokens: string[]): boolean {
  const isRg = tokens.some((t) => t === "rg" || /[/\\]rg$/.test(t));
  const isGrep = tokens.some((t) => t === "grep" || /[/\\]grep$/.test(t));
  if (!isRg && !isGrep) return false;
  if (isGrep && !isRg && !isRecursiveGrep(tokens)) return false;

  return tokens.some((t) => !t.startsWith("-") && isRootPath(t));
}

/**
 * Rutas y patrones estrictamente prohibidos para proteger credenciales y claves privadas del host
 * contra lecturas no autorizadas o filtraciones (mitigación de la brecha crítica de DeepSeek Harness).
 */
export const FORBIDDEN_SENSITIVE_PATTERNS: readonly RegExp[] = [
  /[/\\]\.ssh([/\\]|$)/i,               // Claves SSH (~/.ssh/id_rsa, id_ed25519)
  /[/\\]\.gnupg([/\\]|$)/i,             // Claves GPG
  /[/\\]\.aws([/\\]|$)/i,               // Credenciales AWS (~/.aws/credentials)
  /[/\\]\.config[/\\]gcloud([/\\]|$)/i, // Credenciales Google Cloud
  /[/\\]\.config[/\\]gh([/\\]|$)/i,     // Tokens GitHub CLI
  /[/\\]\.azure([/\\]|$)/i,             // Tokens Azure
  /[/\\]\.netrc$/i,                     // Credenciales en texto claro
  /[/\\]\.bash_history$/i,              // Historial de comandos con posibles passwords
  /[/\\]\.zsh_history$/i,
];

/**
 * Determina si una ruta o comando intenta acceder a claves o credenciales privadas del host.
 */
export function isSensitiveCredentialPath(targetPath: string): boolean {
  if (typeof targetPath !== "string") return false;
  const clean = targetPath.trim().replace(/^['"]|['"]$/g, "");
  return FORBIDDEN_SENSITIVE_PATTERNS.some((pattern) => pattern.test(clean));
}

export function sensitiveCredentialReason(pathOrCommand: string): string {
  return (
    `dc-scan-guard (credential-protection): se bloqueó el acceso a una ruta de credenciales críticas (\`${pathOrCommand}\`). ` +
    `El acceso a claves SSH, tokens de nube (~/.aws, ~/.ssh, ~/.config/gh) e historiales del host está estrictamente restringido por política de seguridad.`
  );
}

/**
 * Regla de Doble Codificación: bloquea mecánicamente comandos destructivos masivos
 * (rm -rf sobre raíz, home, variables de entorno globales o wildcards raíz).
 */
function isDestructiveRm(tokens: string[]): boolean {
  const rmIdx = tokens.findIndex((t) => {
    const clean = t.replace(/^['"]|['"]$/g, "");
    return clean === "rm" || /[/\\]rm$/.test(clean);
  });
  if (rmIdx === -1) return false;

  // Verificar si tiene flag recursivo (-r, -rf, -fr, -R, --recursive, etc.)
  const hasRecursive = tokens.some((t, i) => {
    if (i <= rmIdx) return false;
    const clean = t.replace(/^['"]|['"]$/g, "");
    return /^-[a-zA-Z]*[rR]/.test(clean) || clean === "--recursive" || clean === "-r" || clean === "-R";
  });
  if (!hasRecursive) return false;

  // Verificar si alguno de los argumentos objetivo es una raíz, wildcard de raíz o home
  for (let i = rmIdx + 1; i < tokens.length; i++) {
    const rawTok = tokens[i]!;
    const tok = rawTok.replace(/^['"]|['"]$/g, "");
    if (tok.startsWith("-")) continue;
    if (isRootPath(tok)) return true;
    if (tok === "/*" || tok === "~/*" || tok === ".*" || tok === "$HOME/*" || tok === "${HOME}/*") return true;
    if (/^[/\\]\*+$/.test(tok) || /^\~[/\\]\*+$/.test(tok)) return true;
    if (/[/\\]\*+$/.test(tok)) {
      const base = tok.replace(/[/\\]\*+$/, "") || "/";
      if (isRootPath(base)) return true;
    }
  }
  return false;
}

export function destructiveRmReason(command: string): string {
  return (
    `dc-scan-guard (dual-encoding): se bloqueó un comando destructivo masivo (\`${command}\`). ` +
    `Ejecutar \`rm -rf\` sobre \`/\`, \`~\`, \`$HOME\` o wildcards globales está mecánicamente prohibido ` +
    `para proteger el sistema operativo y el entorno del desarrollador. Acotá la eliminación a rutas relativas específicas.`
  );
}

export function blockReason(command: string): string {
  const offending = splitSegments(command).find((seg) => {
    const tokens = tokenize(seg);
    return isRootedFind(tokens) || isRootedRecursiveSearch(tokens);
  });
  return (
    `dc-scan-guard: se bloqueó un escaneo recursivo en la raíz del sistema de archivos` +
    (offending ? ` (\`${offending}\`)` : "") +
    `. Un comando \`find\`/\`grep -r\`/\`rg\` en \`/\`, raíz de disco o \`~\` puede colgar el proceso indefinidamente ` +
    `(hidratación de archivos cloud/OneDrive o pseudo-filesystems). ` +
    `Acotá la búsqueda a la ruta relativa del proyecto o a un subdirectorio concreto (ej: \`find src -name ...\`).`
  );
}

function unquoteLiteral(quoted: string): string {
  const q = quoted[0];
  if ((q === '"' || q === "'" || q === "`") && quoted.endsWith(q) && quoted.length >= 2) {
    return quoted
      .slice(1, -1)
      .replace(/\\(["'`\\])/g, "$1")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t");
  }
  return quoted;
}

function extractInlineSubshellPayloads(command: string): { kind: "shell" | "code"; payload: string }[] {
  const results: { kind: "shell" | "code"; payload: string }[] = [];

  // sh -c "...", bash -lc '...', zsh -c "..."
  const shellRe = /(?:^|[\s;|&()])(?:\/usr\/bin\/env\s+)?(?:\/bin\/|\/usr\/bin\/)?(?:sh|bash|zsh|dash|ksh)\s+(?:-[a-zA-Z]+\s+)*-[a-zA-Z]*c\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
  let m: RegExpExecArray | null;
  while ((m = shellRe.exec(command)) !== null) {
    results.push({ kind: "shell", payload: unquoteLiteral(m[1]!) });
  }

  // python -c "...", python3 -c '...', node -e "...", node --eval '...'
  const codeRe = /(?:^|[\s;|&()])(?:\/usr\/bin\/env\s+)?(?:\/bin\/|\/usr\/bin\/|\/usr\/local\/bin\/)?(?:python\d*(?:\.\d+)?|node|nodejs|bun|deno)\s+(?:-[^\s]+\s+)*(?:-c|-e|--eval|-p|--print)\s+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g;
  while ((m = codeRe.exec(command)) !== null) {
    results.push({ kind: "code", payload: unquoteLiteral(m[1]!) });
  }

  return results;
}

function isPathConfinedToWorkspace(candidatePath: string, cwd: string = process.cwd()): boolean {
  const clean = candidatePath.trim().replace(/^['"]|['"]$/g, "");
  if (!clean) return true;
  if (clean.startsWith("~") || clean.startsWith("$HOME") || clean.startsWith("${HOME}")) {
    return false;
  }
  if (/(?:^|[/\\])\.\.(?:[/\\]|$)/.test(clean)) {
    return false;
  }
  const baseCwd = path.resolve(cwd);
  const baseTmp = path.resolve(os.tmpdir());
  const isAbs = path.isAbsolute(clean);
  const resolved = isAbs ? path.resolve(clean) : path.resolve(baseCwd, clean);

  const isInside = (target: string, root: string) => {
    const rel = path.relative(root, target);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };

  if (isInside(resolved, baseCwd)) return true;
  if (isAbs && isInside(resolved, baseTmp)) return true;
  return false;
}

export function classifyPtcCode(code: unknown, cwd: string = process.cwd()): ScanGuardDecision {
  if (typeof code !== "string" || code.trim() === "") {
    return { block: false };
  }

  // 1. Verificar llamadas destructivas directas de filesystem en Python/Node (rmtree, rmSync, rmdirSync)
  const nativeRmRe = /\b(?:shutil\.rmtree|os\.(?:remove|unlink|rmdir)|(?:fs(?:\.promises)?\.)?(?:rmSync|rmdirSync|rm|rmdir))\s*\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|os\.homedir\(\)|os\.path\.expanduser\(\s*['"]~['"]\s*\))/g;
  let match: RegExpExecArray | null;
  while ((match = nativeRmRe.exec(code)) !== null) {
    const rawArg = match[1]!;
    if (rawArg.includes("homedir") || rawArg.includes("expanduser")) {
      return { block: true, reason: destructiveRmReason(match[0]) };
    }
    const target = unquoteLiteral(rawArg);
    if (isRootPath(target) || /^[/\\]\*+$/.test(target)) {
      return { block: true, reason: destructiveRmReason(match[0]) };
    }
  }

  // 2. Verificar accesos de pi.fs / fs a rutas fuera del workspace o raíces
  const fsCallRe = /\b(?:pi\.fs\.(?:read|write|list|exists)|fs\.(?:readFileSync|writeFileSync|readdirSync|openSync|statSync))\s*\(\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
  while ((match = fsCallRe.exec(code)) !== null) {
    const targetPath = unquoteLiteral(match[1]!);
    if (targetPath.includes("${")) continue;
    if (isSensitiveCredentialPath(targetPath)) {
      return { block: true, reason: sensitiveCredentialReason(targetPath) };
    }
    if (isRootPath(targetPath)) {
      return {
        block: true,
        reason: `dc-scan-guard: se bloqueó acceso en raíz (\`${targetPath}\`) dentro de \`dc_ptc_run\`.`,
      };
    }
    if (!isPathConfinedToWorkspace(targetPath, cwd)) {
      return {
        block: true,
        reason: `dc-scan-guard: se bloqueó acceso fuera del workspace autorizado (\`${targetPath}\`) en \`dc_ptc_run\`.`,
      };
    }
  }

  // 3. Inspeccionar literales de cadena por comandos shell destructivos o credenciales
  const literalRe = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
  while ((match = literalRe.exec(code)) !== null) {
    const literal = unquoteLiteral(match[1]!);
    if (isSensitiveCredentialPath(literal)) {
      return { block: true, reason: sensitiveCredentialReason(literal) };
    }
    const shellDecision = classifyShellCommand(literal, 1);
    if (shellDecision.block) {
      return shellDecision;
    }
  }

  return { block: false };
}

// Layer 0: Destructive Git Commands
export function isDestructiveGit(tokens: string[], rawSegment: string): { block: boolean; reason?: string } {
  const gitIdx = tokens.findIndex((t) => {
    const clean = t.replace(/^['"]|['"]$/g, "");
    return clean === "git" || clean.endsWith("/git") || clean === "git.exe";
  });
  if (gitIdx === -1 || gitIdx === tokens.length - 1) return { block: false };

  const sub = tokens[gitIdx + 1]?.replace(/^['"]|['"]$/g, "").toLowerCase();
  const args = tokens.slice(gitIdx + 2).map((t) => t.replace(/^['"]|['"]$/g, ""));

  // 1. git reset --hard
  if (sub === "reset" && args.some((a) => a === "--hard" || /^-.*hard/.test(a))) {
    return {
      block: true,
      reason: `dc-scan-guard (Layer 0): se bloqueó \`${rawSegment.trim()}\`. \`git reset --hard\` descarta irreversiblemente el árbol de trabajo y modificaciones sin confirmación.`,
    };
  }

  // 2. git clean -f / -fd / -fx / --force
  if (sub === "clean" && args.some((a) => a === "--force" || /^-[a-zA-Z]*f/.test(a))) {
    return {
      block: true,
      reason: `dc-scan-guard (Layer 0): se bloqueó \`${rawSegment.trim()}\`. \`git clean\` con forzado borra permanentemente archivos sin seguimiento en el repositorio.`,
    };
  }

  // 3. git checkout/restore wiping whole workspace (targeting . or *)
  if (
    (sub === "checkout" && (args.includes(".") || args.includes(".*") || args.includes("*")) && (args.includes("--") || args.includes("-f") || args.includes("--force"))) ||
    (sub === "restore" && (args.includes(".") || args.includes(".*") || args.includes("*")))
  ) {
    return {
      block: true,
      reason: `dc-scan-guard (Layer 0): se bloqueó \`${rawSegment.trim()}\`. Descartar todo el workspace con git checkout/restore elimina cambios de código sin respaldo.`,
    };
  }

  // 4. git stash drop
  if (sub === "stash" && args.includes("drop")) {
    return {
      block: true,
      reason: `dc-scan-guard (Layer 0): se bloqueó \`${rawSegment.trim()}\`. \`git stash drop\` destruye snapshots guardados de trabajo local.`,
    };
  }

  // 5. git branch -D master / main
  if (sub === "branch" && args.includes("-D") && args.some((a) => a === "master" || a === "main")) {
    return {
      block: true,
      reason: `dc-scan-guard (Layer 0): se bloqueó \`${rawSegment.trim()}\`. Eliminación forzada de la rama principal de Git prohibida.`,
    };
  }

  return { block: false };
}

// Layer 0: Destructive IaC & DB Commands
export function isDestructiveIacOrDb(tokens: string[], rawSegment: string): { block: boolean; reason?: string } {
  const norm = rawSegment.toLowerCase();

  // terraform/pulumi/cdk destroy
  if (/\b(?:terraform|pulumi|cdk)\s+destroy\b/.test(norm)) {
    return {
      block: true,
      reason: `dc-scan-guard (Layer 0): se bloqueó \`${rawSegment.trim()}\`. La destrucción de infraestructura vía IaC requiere autorización humana explícita.`,
    };
  }

  // prisma migrate reset
  if (norm.includes("prisma") && norm.includes("migrate") && norm.includes("reset")) {
    return {
      block: true,
      reason: `dc-scan-guard (Layer 0): se bloqueó \`${rawSegment.trim()}\`. El reseteo destructivo de base de datos (\`prisma migrate reset\`) está bloqueado.`,
    };
  }

  return { block: false };
}

// Layer 0: OS Keyring Purge (antigravity-fixer antipattern)
export function isDestructiveCredentialPurge(tokens: string[], rawSegment: string): { block: boolean; reason?: string } {
  const norm = rawSegment.toLowerCase();

  // cmdkey /delete
  if (norm.includes("cmdkey") && norm.includes("/delete")) {
    return {
      block: true,
      reason: `dc-scan-guard (Layer 0): se bloqueó \`${rawSegment.trim()}\`. El borrado masivo de credenciales del sistema operativo (\`cmdkey /delete\`) está prohibido.`,
    };
  }

  // macOS Keychain delete
  if (norm.includes("security") && norm.includes("delete-generic-password")) {
    return {
      block: true,
      reason: `dc-scan-guard (Layer 0): se bloqueó \`${rawSegment.trim()}\`. La manipulación destructiva del llavero de macOS está bloqueada.`,
    };
  }

  // Linux secret-tool clear
  if (norm.includes("secret-tool") && norm.includes("clear")) {
    return {
      block: true,
      reason: `dc-scan-guard (Layer 0): se bloqueó \`${rawSegment.trim()}\`. El borrado de credenciales de Linux (\`secret-tool clear\`) está bloqueado.`,
    };
  }

  return { block: false };
}

// Layer 0: Indiscriminate pkill
export function isDangerousPkill(tokens: string[], rawSegment: string): { block: boolean; reason?: string } {
  const pkillIdx = tokens.findIndex((t) => {
    const clean = t.replace(/^['"]|['"]$/g, "");
    return clean === "pkill" || clean.endsWith("/pkill");
  });
  if (pkillIdx === -1) return { block: false };

  const hasF = tokens.some((t, i) => i > pkillIdx && (t === "-f" || /^-.*f/.test(t)));
  if (hasF) {
    const patternToken = tokens.slice(pkillIdx + 1).find((t) => !t.startsWith("-"));
    if (patternToken) {
      const cleanPat = patternToken.replace(/^['"]|['"]$/g, "").trim();
      if (cleanPat.length <= 4) {
        return {
          block: true,
          reason: `dc-scan-guard (Layer 0): se bloqueó \`${rawSegment.trim()}\`. \`pkill -f\` con patrones cortos (<= 4 caracteres) es indiscriminado y matará procesos críticos del usuario o del sistema.`,
        };
      }
    }
  }

  return { block: false };
}

// Layer 0: Deletion of .git or user critical directories
export function isDestructiveMetadataRm(tokens: string[], rawSegment: string): { block: boolean; reason?: string } {
  const rmIdx = tokens.findIndex((t) => {
    const clean = t.replace(/^['"]|['"]$/g, "");
    return clean === "rm" || clean.endsWith("/rm") || clean === "del" || clean === "rmdir";
  });
  if (rmIdx === -1) return { block: false };

  for (let i = rmIdx + 1; i < tokens.length; i++) {
    const tok = tokens[i]!.replace(/^['"]|['"]$/g, "").trim();
    if (tok.startsWith("-")) continue;
    // .git metadata
    if (tok === ".git" || tok === ".git/" || tok === "./.git" || tok === "./.git/") {
      return {
        block: true,
        reason: `dc-scan-guard (Layer 0): se bloqueó \`${rawSegment.trim()}\`. La eliminación del directorio \`.git\` destruye la integridad del repositorio y su historial.`,
      };
    }
    // critical user config
    if (
      tok === "~/.config" || tok === "~/.config/" ||
      tok === "~/.pi" || tok === "~/.pi/" ||
      tok === "~/.gemini" || tok === "~/.gemini/" ||
      tok === "$HOME/.config" || tok === "$HOME/.pi" || tok === "$HOME/.gemini"
    ) {
      return {
        block: true,
        reason: `dc-scan-guard (Layer 0): se bloqueó \`${rawSegment.trim()}\`. La eliminación de directorios de configuración del usuario (\`${tok}\`) está mecánicamente prohibida.`,
      };
    }
  }

  return { block: false };
}

export function classifyShellCommand(command: unknown, depth = 0): ScanGuardDecision {
  if (typeof command !== "string" || command.trim() === "" || depth > 3) {
    return { block: false };
  }

  // 0. Inspeccionar payloads de subshells inline (sh -c, bash -c, python3 -c, node -e)
  for (const sub of extractInlineSubshellPayloads(command)) {
    if (sub.kind === "shell") {
      const subDecision = classifyShellCommand(sub.payload, depth + 1);
      if (subDecision.block) return subDecision;
    } else {
      const codeDecision = classifyPtcCode(sub.payload);
      if (codeDecision.block) return codeDecision;
    }
  }

  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment);

    // Layer 0.1: Destructive Git Commands
    const gitDecision = isDestructiveGit(tokens, segment);
    if (gitDecision.block) {
      return gitDecision;
    }

    // Layer 0.2: Destructive IaC & DB Commands
    const iacDecision = isDestructiveIacOrDb(tokens, segment);
    if (iacDecision.block) {
      return iacDecision;
    }

    // Layer 0.3: Destructive Keyring Purge
    const keyringDecision = isDestructiveCredentialPurge(tokens, segment);
    if (keyringDecision.block) {
      return keyringDecision;
    }

    // Layer 0.4: Indiscriminate pkill
    const pkillDecision = isDangerousPkill(tokens, segment);
    if (pkillDecision.block) {
      return pkillDecision;
    }

    // Layer 0.5: Deletion of .git or critical user config
    const metadataDecision = isDestructiveMetadataRm(tokens, segment);
    if (metadataDecision.block) {
      return metadataDecision;
    }

    if (isDestructiveRm(tokens)) {
      return { block: true, reason: destructiveRmReason(segment) };
    }
    // Chequeo de acceso a credenciales en shell (ej: cat ~/.ssh/id_rsa, cp ~/.aws/credentials .)
    for (const token of tokens) {
      if (isSensitiveCredentialPath(token)) {
        return { block: true, reason: sensitiveCredentialReason(token) };
      }
    }
    if (isRootedFind(tokens) || isRootedRecursiveSearch(tokens)) {
      return { block: true, reason: blockReason(command) };
    }
  }
  return { block: false };
}

/**
 * Valida si los parámetros de herramientas nativas como `grep`, `find`, `read` o `dc_ptc_run` apuntan a raíces o patrones peligrosos.
 */
export function classifyNativeToolScan(toolName: string, input: Record<string, unknown> | undefined): ScanGuardDecision {
  if (!input || typeof input !== "object") return { block: false };

  if (toolName === "dc_ptc_run" || typeof input.code === "string") {
    const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
    const ptcDecision = classifyPtcCode(input.code, cwd);
    if (ptcDecision.block) return ptcDecision;
  }

  const targetPath = (input.path || input.directory || input.dir || input.filePath) as string | undefined;
  if (typeof targetPath === "string") {
    if (isSensitiveCredentialPath(targetPath)) {
      return {
        block: true,
        reason: sensitiveCredentialReason(targetPath),
      };
    }
    if (isRootPath(targetPath)) {
      return {
        block: true,
        reason: `dc-scan-guard: se bloqueó la invocación de \`${toolName}\` en la raíz \`${targetPath}\`. ` +
          `Buscar en \`/\`, \`~\` o el home del usuario colgará el proceso indefinidamente con miles de gigabytes. ` +
          `Acotá la búsqueda a una subcarpeta concreta o relativa (ej: \`src/\`, \`lib/\`).`,
      };
    }
  }

  return { block: false };
}
