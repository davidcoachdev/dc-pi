import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

export type ProcessRole = "orchestrator" | "super_agent_86" | "super_agent_99" | "worker";

export interface RunningPiProcess {
  pid: number;
  cwd: string;
  projectName: string;
  isCurrent: boolean;
  role: ProcessRole;
  displayLabel: string;
  osState?: "running" | "sleeping" | "stopped" | "zombie";
}

function parseLinuxProcessState(stateChar: string): RunningPiProcess["osState"] {
  switch (stateChar) {
    case "R": return "running";
    case "S":
    case "D": return "sleeping";
    case "T":
    case "t": return "stopped";
    case "Z": return "zombie";
    default: return "running";
  }
}

function classifyProcessRole(cwd: string, cmdline: string, isCurrent: boolean): { role: ProcessRole; displayLabel: string } {
  const normCwd = cwd.toLowerCase();
  const normCmd = cmdline.toLowerCase();

  // 1. Detectar Super-Agente #86
  if (normCmd.includes("dc-super-agente-86") || normCmd.includes("super_agent_86") || normCwd.includes("issue-16") || normCwd.includes("issue-86")) {
    const issueMatch = cwd.match(/issue-(\d+)/i);
    const label = issueMatch ? `🤖 Agente #86 (#${issueMatch[1]})` : "🤖 Agente #86";
    return { role: "super_agent_86", displayLabel: label };
  }

  // 2. Detectar Super-Agente #99 (Auditor)
  if (normCmd.includes("dc-super-agente-99") || normCmd.includes("super_agent_99") || normCwd.includes("issue-99")) {
    return { role: "super_agent_99", displayLabel: "🤖 Agente #99 (Auditor)" };
  }

  // 3. Detectar si corre dentro de un worktree aislado de un Issue
  if (normCwd.includes("worktrees") || normCwd.includes("ghissue") || normCwd.includes("/issue-")) {
    const issueMatch = cwd.match(/issue-(\d+)/i);
    const label = issueMatch ? `🤖 Worker Issue #${issueMatch[1]}` : "🤖 Worker Worktree";
    return { role: "worker", displayLabel: label };
  }

  // 4. Orquestador interactivo (sesión de usuario en un lab)
  const baseName = cwd ? path.basename(cwd) : "lab";
  const label = isCurrent ? `${baseName} (este)` : baseName;
  return { role: "orchestrator", displayLabel: label };
}

/**
 * Escanea y clasifica todos los procesos vivos de Pi en el sistema operativo (Debian/WSL Linux)
 * leyendo directamente desde /proc/<pid>.
 * Distingue de forma inteligente entre:
 * - Orquestadores interactivos (ej. dc-pi, lab-cli-proxy-api).
 * - Super-Agente #86 / #99.
 * - Workers en worktrees de issues.
 * - Procesos suspendidos (Ctrl+Z) vs activos.
 */
export function scanRunningPiProcesses(): RunningPiProcess[] {
  const results: RunningPiProcess[] = [];
  const currentPid = process.pid;

  // Estrategia 1: Leer /proc directamente (Linux nativo en <2ms)
  if (fs.existsSync("/proc")) {
    try {
      const pids = fs.readdirSync("/proc");
      for (const entry of pids) {
        if (!/^\d+$/.test(entry)) continue;
        const pid = parseInt(entry, 10);
        const commPath = path.join("/proc", entry, "comm");
        const cmdlinePath = path.join("/proc", entry, "cmdline");
        const statPath = path.join("/proc", entry, "stat");
        const cwdLink = path.join("/proc", entry, "cwd");

        try {
          let isPi = false;
          let cmdline = "";

          if (fs.existsSync(commPath)) {
            const comm = fs.readFileSync(commPath, "utf-8").trim();
            if (comm === "pi" || comm.includes("pi-coding-agent")) {
              isPi = true;
            }
          }

          if (fs.existsSync(cmdlinePath)) {
            cmdline = fs.readFileSync(cmdlinePath, "utf-8");
            if (!isPi && (cmdline.includes("pi-coding-agent") || cmdline.split("\0")[0]?.endsWith("/pi"))) {
              isPi = true;
            }
          }

          if (isPi) {
            let cwd = "";
            try {
              cwd = fs.readlinkSync(cwdLink);
            } catch {
              cwd = process.cwd();
            }

            let osState: RunningPiProcess["osState"] = "running";
            if (fs.existsSync(statPath)) {
              try {
                const statRaw = fs.readFileSync(statPath, "utf-8");
                const parts = statRaw.split(" ");
                // El estado de Linux es el 3er campo en /proc/[pid]/stat
                const stateChar = parts[2] || "R";
                osState = parseLinuxProcessState(stateChar);
              } catch {}
            }

            const isCurrent = pid === currentPid;
            const projectName = cwd ? path.basename(cwd) : `PID ${pid}`;
            const { role, displayLabel } = classifyProcessRole(cwd, cmdline, isCurrent);

            results.push({
              pid,
              cwd,
              projectName,
              isCurrent,
              role,
              displayLabel,
              osState,
            });
          }
        } catch {
          // El proceso pudo terminar mientras se escaneaba
        }
      }

      if (results.length > 0) {
        // Ordenar: primero orquestadores activos, luego workers/super-agentes, y suspendidos al final
        return results.sort((a, b) => {
          if (a.isCurrent) return -1;
          if (b.isCurrent) return 1;
          if (a.osState === "stopped" && b.osState !== "stopped") return 1;
          if (b.osState === "stopped" && a.osState !== "stopped") return -1;
          return a.pid - b.pid;
        });
      }
    } catch {
      // Fallback a pgrep si /proc no permite readdir
    }
  }

  // Estrategia 2: Fallback mediante pgrep -x pi
  try {
    const stdout = execSync("pgrep -x pi 2>/dev/null", { encoding: "utf-8" }).trim();
    if (stdout) {
      const lines = stdout.split("\n");
      for (const line of lines) {
        const pid = parseInt(line.trim(), 10);
        if (isNaN(pid)) continue;

        let cwd = "";
        try {
          cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
        } catch {
          cwd = process.cwd();
        }

        const isCurrent = pid === currentPid;
        const projectName = cwd ? path.basename(cwd) : `PID ${pid}`;
        const { role, displayLabel } = classifyProcessRole(cwd, "", isCurrent);

        results.push({
          pid,
          cwd,
          projectName,
          isCurrent,
          role,
          displayLabel,
          osState: "running",
        });
      }
    }
  } catch {}

  return results;
}
