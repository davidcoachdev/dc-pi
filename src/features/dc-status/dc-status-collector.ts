import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VERSION } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface EnvStatus {
  gitBranch: string;
  gitStatus: string;
  cwd: string;
  modelId?: string;
  modelProvider?: string;
  thinkingLevel?: string;
  mcpServers: Array<{ name: string; toolsCount?: number }>;
  packages: string[];
  extensionsCount: number;
  skillsCount: number;
  customToolsCount: number;
  sddPhasesCount: number;
  alerts: string[];
  version: string;
  gentlePiVersion?: string;
}

export function getGentlePiVersion(): string | undefined {
  const candidatePaths = [
    path.join(os.homedir(), ".pi", "agent", "git", "github.com", "Gentleman-Programming", "gentle-pi", "package.json"),
    path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", "gentle-pi", "package.json"),
  ];

  for (const pkgPath of candidatePaths) {
    try {
      if (fs.existsSync(pkgPath)) {
        const raw = fs.readFileSync(pkgPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.version === "string") {
          return parsed.version;
        }
      }
    } catch {
      /* ignore */
    }
  }

  return undefined;
}

export function parseGitBranchOutput(stdout: string): { branch: string; status: string } {
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  const branchLine = lines[0] ?? "";
  let branch = "desconocida";
  const m = branchLine.match(/^##\s+([^.\s]+)/);
  if (m && m[1]) branch = m[1];
  else if (branchLine.includes("No commits yet on ")) {
    branch = branchLine.replace("## No commits yet on ", "").trim();
  }

  const changes = lines.slice(1).length;
  const status = changes === 0 ? "limpio" : `${changes} cambio(s) pendiente(s)`;
  return { branch, status };
}

export function getGitInfo(cwd: string): Promise<{ branch: string; status: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, "status", "--porcelain", "-b"],
      { encoding: "utf8", windowsHide: true, timeout: 2000 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve({ branch: "No es un repositorio git", status: "n/a" });
          return;
        }
        resolve(parseGitBranchOutput(stdout));
      },
    );
  });
}

export async function collectEnvStatus(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): Promise<EnvStatus> {
  const cwd = ctx.cwd ?? process.cwd();
  const git = await getGitInfo(cwd);

  const modelId = ctx.model?.id;
  const modelProvider = ctx.model?.provider ? String(ctx.model.provider) : undefined;
  const thinkingLevel = (pi as any).getThinkingLevel?.() ?? undefined;

  // Retrieve registered tools and commands
  let customToolsCount = 0;
  try {
    const allTools = (pi as any).getAllTools?.() ?? [];
    customToolsCount = Array.isArray(allTools) ? allTools.length : 0;
  } catch {
    /* noop */
  }

  // Retrieve commands for skills/agents counting
  let skillsCount = 0;
  let sddPhasesCount = 0;
  try {
    const commands = (pi as any).getCommands?.() ?? [];
    if (Array.isArray(commands)) {
      skillsCount = commands.filter((c: any) => c.name?.startsWith("skill:") || c.name?.startsWith("skill-")).length;
      sddPhasesCount = commands.filter((c: any) => c.name?.startsWith("sdd-")).length;
    }
  } catch {
    /* noop */
  }

  const alerts: string[] = [];
  if (git.branch === "No es un repositorio git") {
    alerts.push("El directorio actual no tiene un repositorio Git inicializado.");
  }
  if (!modelId) {
    alerts.push("No hay ningún modelo activo configurado en la sesión de Pi.");
  }

  // Diagnósticos capturados de extensiones, issues o conflictos de Pi Core
  try {
    const G_DIAGNOSTICS = Symbol.for("dc.env.diagnostics");
    const captured = (globalThis as unknown as Record<symbol, string[]>)[G_DIAGNOSTICS];
    if (Array.isArray(captured) && captured.length > 0) {
      for (const diag of captured) {
        const trimmed = diag.trim();
        if (trimmed) {
          alerts.push(trimmed);
        }
      }
    }
  } catch {
    /* noop */
  }

  return {
    gitBranch: git.branch,
    gitStatus: git.status,
    cwd,
    modelId,
    modelProvider,
    thinkingLevel,
    mcpServers: [],
    packages: ["dc-pi"],
    extensionsCount: 7,
    skillsCount,
    customToolsCount,
    sddPhasesCount,
    alerts,
    version: VERSION ?? "0.85.1",
    gentlePiVersion: getGentlePiVersion(),
  };
}
