/**
 * dc-scan-guard — Filesystem-wide scan guard for DC Studio.
 *
 * Blocks dangerous, unbounded recursive scans (find, grep -r, rg) rooted at
 * filesystem roots (/, ~, C:\, etc.) that can wedge processes indefinitely
 * (e.g. cloud storage hydration like OneDrive in WSL/Windows, or scanning
 * pseudo-filesystems in Linux).
 */

import * as os from "node:os";

export interface ScanGuardDecision {
  block: boolean;
  reason?: string;
}

export const GUARDED_TOOLS: ReadonlySet<string> = new Set(["bash", "shell", "sh", "grep", "find"]);

/**
 * Checks if a token represents a filesystem root.
 */
export function isRootPath(token: string): boolean {
  let t = token.trim().replace(/^['"]|['"]$/g, "");
  if (t.length > 1) t = t.replace(/[/\\]$/, "");

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

  for (let i = idx + 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.startsWith("-") || tok === "(" || tok === "!" || tok === ")") break;
    if (isRootPath(tok)) return true;
  }
  return false;
}

function isRecursiveGrep(tokens: string[]): boolean {
  const idx = tokens.findIndex((t) => t === "grep" || /[/\\]grep$/.test(t));
  if (idx === -1) return false;
  return tokens
    .slice(idx + 1)
    .some((t) => t === "--recursive" || /^-[a-zA-Z]*[rR]/.test(t));
}

function isRootedRecursiveSearch(tokens: string[]): boolean {
  const isRg = tokens.some((t) => t === "rg" || /[/\\]rg$/.test(t));
  const isGrep = tokens.some((t) => t === "grep" || /[/\\]grep$/.test(t));
  if (!isRg && !isGrep) return false;
  if (isGrep && !isRg && !isRecursiveGrep(tokens)) return false;

  return tokens.some((t) => !t.startsWith("-") && isRootPath(t));
}

/**
 * Regla de Doble Codificación: bloquea mecánicamente comandos destructivos masivos
 * (rm -rf sobre raíz, home, variables de entorno globales o wildcards raíz).
 */
function isDestructiveRm(tokens: string[]): boolean {
  const rmIdx = tokens.findIndex((t) => t === "rm" || /[/\\]rm$/.test(t));
  if (rmIdx === -1) return false;

  // Verificar si tiene flag recursivo (-r, -rf, -fr, -R, etc.)
  const hasRecursive = tokens.some((t, i) => i > rmIdx && /^-[a-zA-Z]*[rR]/.test(t));
  if (!hasRecursive) return false;

  // Verificar si alguno de los argumentos objetivo es una raíz, wildcard de raíz o home
  for (let i = rmIdx + 1; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.startsWith("-")) continue;
    if (isRootPath(tok)) return true;
    if (tok === "/*" || tok === "~/*" || tok === ".*" || tok === "$HOME/*" || tok === "${HOME}/*") return true;
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

export function classifyShellCommand(command: unknown): ScanGuardDecision {
  if (typeof command !== "string" || command.trim() === "") {
    return { block: false };
  }

  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment);
    if (isDestructiveRm(tokens)) {
      return { block: true, reason: destructiveRmReason(segment) };
    }
    if (isRootedFind(tokens) || isRootedRecursiveSearch(tokens)) {
      return { block: true, reason: blockReason(command) };
    }
  }
  return { block: false };
}

/**
 * Valida si los parámetros de herramientas nativas como `grep` o `find` apuntan a raíces peligrosas.
 */
export function classifyNativeToolScan(toolName: string, input: Record<string, unknown> | undefined): ScanGuardDecision {
  if (!input || typeof input !== "object") return { block: false };

  const targetPath = (input.path || input.directory || input.dir) as string | undefined;
  if (typeof targetPath === "string" && isRootPath(targetPath)) {
    return {
      block: true,
      reason: `dc-scan-guard: se bloqueó la invocación de \`${toolName}\` en la raíz \`${targetPath}\`. ` +
        `Buscar en \`/\`, \`~\` o el home del usuario colgará el proceso indefinidamente con miles de gigabytes. ` +
        `Acotá la búsqueda a una subcarpeta concreta o relativa (ej: \`src/\`, \`lib/\`).`,
    };
  }

  return { block: false };
}
