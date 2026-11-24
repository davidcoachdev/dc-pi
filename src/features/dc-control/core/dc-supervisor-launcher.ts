import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { getDcControlPaths } from "../../../core/dc-paths.ts";
import { getCanonicalDcSupervisorPaths } from "./dc-supervisor-paths.ts";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export interface LauncherOptions {
  socketPath?: string;
  pidPath?: string;
  daemonScriptPath?: string;
}

export class DcSupervisorLauncher {
  private socketPath: string;
  private pidPath: string;
  private daemonScriptPath?: string;

  constructor(options?: LauncherOptions) {
    const canonical = getCanonicalDcSupervisorPaths();
    this.socketPath = options?.socketPath ?? canonical.socketPath;
    this.pidPath = options?.pidPath ?? canonical.pidPath;
    this.daemonScriptPath = options?.daemonScriptPath;
  }

  /**
   * Comprueba si el daemon está vivo intentando conectar al socket Unix.
   */
  public async isDaemonAlive(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!fs.existsSync(this.socketPath)) {
        return resolve(false);
      }

      const client = net.createConnection(this.socketPath, () => {
        client.destroy();
        resolve(true);
      });

      client.on("error", () => {
        client.destroy();
        resolve(false);
      });
    });
  }

  private resolveDaemonScript(): { command: string; args: string[] } | null {
    if (this.daemonScriptPath && fs.existsSync(this.daemonScriptPath)) {
      return { command: process.execPath, args: [this.daemonScriptPath] };
    }

    const candidates = [
      path.join(currentDir, "dc-control-daemon-hub.js"),
      path.join(process.cwd(), ".test-build", "src", "features", "dc-control", "core", "dc-control-daemon-hub.js"),
      getDcControlPaths().daemonEntry,
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return { command: process.execPath, args: [cand] };
      }
    }

    // Si estamos en entorno de desarrollo con TypeScript y existe el .ts
    const tsCandidate = path.join(currentDir, "dc-control-daemon-hub.ts");
    if (fs.existsSync(tsCandidate)) {
      return {
        command: process.execPath,
        args: ["--no-warnings", "--loader", "ts-node/esm", tsCandidate],
      };
    }

    return null;
  }

  /**
   * Garantiza que el Daemon esté corriendo:
   * 1. Si ya responde, retorna true de inmediato.
   * 2. Si no responde pero hay socket o PID huérfano, los limpia.
   * 3. Spawnea el daemon en segundo plano (detached, unref).
   * 4. Espera activamente hasta que el socket esté disponible (polling máx 3s).
   */
  public async ensureDaemonRunning(): Promise<boolean> {
    const alive = await this.isDaemonAlive();
    if (alive) {
      return true;
    }

    // Limpiar restos huérfanos si el daemon murió abruptamente
    this.cleanupOrphanedFiles();

    // Determinar comando y script de arranque
    let launchTarget = this.resolveDaemonScript();

    // Si no se encontró un .js existente, creamos el entrypoint JS canónico en runtimeDir
    if (!launchTarget) {
      const canonical = getCanonicalDcSupervisorPaths();
      const entryFile = path.join(canonical.runtimeDir, "daemon-entry.mjs");
      const compiledHub = path.join(process.cwd(), ".test-build", "src", "features", "dc-control", "core", "dc-control-daemon-hub.js");
      
      const fileToImport = fs.existsSync(compiledHub) ? compiledHub : path.join(currentDir, "dc-control-daemon-hub.js");
      const content = `import { DcControlDaemonHub } from ${JSON.stringify(fileToImport)};
const daemon = new DcControlDaemonHub();
daemon.start().catch((err) => {
  process.stderr.write("[dc-control-daemon] Error: " + err.message + "\\n");
  process.exit(1);
});
`;
      try {
        fs.writeFileSync(entryFile, content, "utf-8");
        launchTarget = { command: process.execPath, args: [entryFile] };
      } catch {
        /* best-effort */
      }
    }

    if (!launchTarget) {
      return false;
    }

    try {
      const child = spawn(launchTarget.command, launchTarget.args, {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          DC_SUPERVISOR_SOCKET: this.socketPath,
          DC_SUPERVISOR_PID: this.pidPath,
        },
      });

      child.unref();

      // Esperar a que el daemon cree el socket y empiece a escuchar
      const maxRetries = 30; // 30 * 100ms = 3 segundos
      for (let i = 0; i < maxRetries; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (await this.isDaemonAlive()) {
          return true;
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  private cleanupOrphanedFiles(): void {
    if (fs.existsSync(this.pidPath)) {
      try {
        const raw = fs.readFileSync(this.pidPath, "utf-8").trim();
        const pid = parseInt(raw, 10);
        if (!isNaN(pid)) {
          try {
            process.kill(pid, 0); // Si no tira error, el PID existe
          } catch (err: any) {
            if (err.code === "ESRCH") {
              fs.unlinkSync(this.pidPath);
            }
          }
        }
      } catch {}
    }

    if (fs.existsSync(this.socketPath)) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {}
    }
  }
}
