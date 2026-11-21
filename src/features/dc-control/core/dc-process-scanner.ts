import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

export interface RunningPiProcess {
  pid: number;
  cwd: string;
  projectName: string;
  isCurrent: boolean;
}

/**
 * Escanea los procesos vivos de Pi en el sistema operativo (Debian/WSL Linux)
 * leyendo directamente desde /proc/<pid>/cwd.
 * Garantiza detección al 100% en tiempo real de todas las terminales y labs abiertos,
 * incluso si la sesión se inició antes de arrancar el daemon supervisor.
 */
export function scanRunningPiProcesses(): RunningPiProcess[] {
  const results: RunningPiProcess[] = [];
  const currentPid = process.pid;

  // Estrategia 1: Leer /proc directamente (nativo de Linux sin subprocesos)
  if (fs.existsSync("/proc")) {
    try {
      const pids = fs.readdirSync("/proc");
      for (const entry of pids) {
        if (!/^\d+$/.test(entry)) continue;
        const pid = parseInt(entry, 10);
        const commPath = path.join("/proc", entry, "comm");
        const cmdlinePath = path.join("/proc", entry, "cmdline");
        const cwdLink = path.join("/proc", entry, "cwd");

        try {
          let isPi = false;
          if (fs.existsSync(commPath)) {
            const comm = fs.readFileSync(commPath, "utf-8").trim();
            if (comm === "pi" || comm.includes("pi-coding-agent")) {
              isPi = true;
            }
          }

          if (!isPi && fs.existsSync(cmdlinePath)) {
            const cmdline = fs.readFileSync(cmdlinePath, "utf-8");
            if (cmdline.includes("pi-coding-agent") || cmdline.split("\0")[0]?.endsWith("/pi")) {
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

            const projectName = cwd ? path.basename(cwd) : `PID ${pid}`;
            results.push({
              pid,
              cwd,
              projectName,
              isCurrent: pid === currentPid,
            });
          }
        } catch {
          // El proceso pudo terminar mientras se escaneaba
        }
      }

      if (results.length > 0) {
        return results;
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

        const projectName = cwd ? path.basename(cwd) : `PID ${pid}`;
        results.push({
          pid,
          cwd,
          projectName,
          isCurrent: pid === currentPid,
        });
      }
    }
  } catch {
    // Si no hay procesos pi activos
  }

  return results;
}
