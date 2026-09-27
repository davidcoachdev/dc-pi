/**
 * dc-scan-guard — Filesystem-wide scan guard for DC Studio.
 *
 * Blocks dangerous, unbounded recursive scans (find, grep -r, rg) rooted at
 * filesystem roots (/, ~, C:\, etc.) that can wedge processes indefinitely
 * (e.g. cloud storage hydration like OneDrive in WSL/Windows, or scanning
 * pseudo-filesystems in Linux).
 */

export interface ScanGuardDecision {
  block: boolean;
  reason?: string;
}

export const GUARDED_TOOLS: ReadonlySet<string> = new Set(["bash", "shell", "sh"]);

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
    if (isRootedFind(tokens) || isRootedRecursiveSearch(tokens)) {
      return { block: true, reason: blockReason(command) };
    }
  }
  return { block: false };
}
