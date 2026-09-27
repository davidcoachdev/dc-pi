import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type {
  CodeGraphExploreResult,
  CodeGraphImpactResult,
  CodeGraphNodeResult,
  CodeGraphStatusResult,
  CodeGraphSyncResult,
} from "./dc-codegraph-types.ts";
import { redactSecrets } from "../../dc-websearch/core/dc-websearch-security.ts";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 25000;
const MAX_OUTPUT_CHARS = 45000; // ~45 KB para proteger context window

function resolveCodegraphBin(): string {
  return process.env.CODEGRAPH_BIN || "/home/linuxbrew/.linuxbrew/bin/codegraph";
}

async function runCodegraphCli(
  args: string[],
  cwd: string = process.cwd(),
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string }> {
  const bin = resolveCodegraphBin();
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf8",
    });
    return { stdout, stderr };
  } catch (err: any) {
    const message = err?.stderr?.trim() || err?.stdout?.trim() || err?.message || String(err);
    throw new Error(`CodeGraph CLI error [${args.join(" ")}]: ${message}`);
  }
}

/**
 * Consulta el estado del índice de CodeGraph en el proyecto.
 */
export async function getCodeGraphStatus(cwd: string = process.cwd()): Promise<CodeGraphStatusResult> {
  const isGitRepo = fs.existsSync(path.join(cwd, ".git"));
  const codegraphDir = path.join(cwd, ".codegraph");
  const indexed = fs.existsSync(codegraphDir);

  try {
    const { stdout } = await runCodegraphCli(["status"], cwd, 10000);
    const cleanOut = redactSecrets(stdout.trim());

    // Intentar extraer conteos si el CLI los reporta
    let filesCount: number | undefined;
    let symbolsCount: number | undefined;

    const filesMatch = cleanOut.match(/files?:?\s*(\d+)/i);
    if (filesMatch?.[1]) filesCount = parseInt(filesMatch[1], 10);

    const symbolsMatch = cleanOut.match(/symbols?:?\s*(\d+)/i);
    if (symbolsMatch?.[1]) symbolsCount = parseInt(symbolsMatch[1], 10);

    return {
      indexed,
      projectRoot: cwd,
      filesCount,
      symbolsCount,
      isGitRepo,
      rawText: cleanOut,
    };
  } catch (err: any) {
    return {
      indexed,
      projectRoot: cwd,
      isGitRepo,
      rawText: `Estado no disponible: ${err.message}`,
    };
  }
}

/**
 * Explora un área conceptual o flujo de llamadas contra el índice.
 */
export async function exploreCodeGraph(
  query: string,
  cwd: string = process.cwd(),
): Promise<CodeGraphExploreResult> {
  const { stdout } = await runCodegraphCli(["explore", query], cwd);
  const clean = redactSecrets(stdout.trim());
  const byteSize = Buffer.byteLength(clean, "utf8");
  const truncated = clean.length > MAX_OUTPUT_CHARS;
  const safeText = truncated
    ? clean.slice(0, MAX_OUTPUT_CHARS) + "\n\n... [Output truncado para proteger la ventana de contexto]"
    : clean;

  return {
    query,
    output: safeText,
    byteSize,
    truncated,
  };
}

/**
 * Inspecciona un símbolo (código + llamadas entrantes/salientes) o un archivo (dependientes).
 */
export async function inspectCodeGraphNode(
  target: string,
  cwd: string = process.cwd(),
): Promise<CodeGraphNodeResult> {
  const { stdout } = await runCodegraphCli(["node", target], cwd);
  const clean = redactSecrets(stdout.trim());

  // Parsear secciones estándar de node
  const callers: string[] = [];
  const callees: string[] = [];
  const dependents: string[] = [];

  const lines = clean.split("\n");
  let mode: "none" | "callers" | "callees" | "dependents" = "none";

  for (const line of lines) {
    const l = line.trim();
    if (l.toLowerCase().includes("callers:") || l.toLowerCase().includes("called by:")) {
      mode = "callers";
      continue;
    }
    if (l.toLowerCase().includes("callees:") || l.toLowerCase().includes("calls:")) {
      mode = "callees";
      continue;
    }
    if (l.toLowerCase().includes("dependents:") || l.toLowerCase().includes("imported by:")) {
      mode = "dependents";
      continue;
    }

    if (mode === "callers" && l.startsWith("-")) callers.push(l.slice(1).trim());
    if (mode === "callees" && l.startsWith("-")) callees.push(l.slice(1).trim());
    if (mode === "dependents" && l.startsWith("-")) dependents.push(l.slice(1).trim());
  }

  const isFile = target.includes(".") || target.includes("/");

  return {
    target,
    kind: isFile ? "file" : "symbol",
    callers: callers.length > 0 ? callers : undefined,
    callees: callees.length > 0 ? callees : undefined,
    dependents: dependents.length > 0 ? dependents : undefined,
    rawText: clean,
  };
}

/**
 * Analiza el radio de impacto / blast radius de modificar un símbolo o archivo.
 */
export async function analyzeCodeGraphImpact(
  target: string,
  cwd: string = process.cwd(),
): Promise<CodeGraphImpactResult> {
  // El comando impact corre con 'node' o 'explore' según la versión de codegraph
  // pero ejecutamos context / explore orientado a impacto
  let rawText = "";
  try {
    const { stdout } = await runCodegraphCli(["context", `impact of changing ${target}`], cwd);
    rawText = stdout;
  } catch {
    const { stdout } = await runCodegraphCli(["explore", `dependents and callers of ${target}`], cwd);
    rawText = stdout;
  }

  const clean = redactSecrets(rawText.trim());
  const directAffected: string[] = [];
  const transitiveAffected: string[] = [];

  const lines = clean.split("\n");
  for (const line of lines) {
    const l = line.trim();
    if (l.startsWith("- ") && (l.includes("/") || l.includes("."))) {
      const candidate = l.slice(2).trim();
      if (!directAffected.includes(candidate)) {
        directAffected.push(candidate);
      }
    }
  }

  return {
    target,
    directAffected,
    transitiveAffected,
    totalAffectedCount: directAffected.length,
    rawText: clean,
  };
}

/**
 * Sincroniza incrementalmente el índice de CodeGraph en el proyecto.
 */
export async function syncCodeGraph(cwd: string = process.cwd()): Promise<CodeGraphSyncResult> {
  try {
    const { stdout } = await runCodegraphCli(["sync"], cwd);
    return {
      synced: true,
      output: redactSecrets(stdout.trim()),
    };
  } catch (err: any) {
    return {
      synced: false,
      output: err.message,
    };
  }
}
