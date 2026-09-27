import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type {
  ServiceConfig,
  ServiceLogsOptions,
  ServiceLogsResult,
  ServiceRuntimeStatus,
  WorkspaceServicesConfigFile,
} from "./dc-services-types.ts";
import { redactSecrets } from "../../dc-websearch/core/dc-websearch-security.ts";

interface SavedProcessState {
  pid: number;
  startedAt: number;
  command: string;
}

export class DcServicesManager {
  private runtimeDir: string;
  private logsDir: string;
  private stateFilePath: string;

  constructor(private readonly cwd: string = process.cwd()) {
    this.runtimeDir = path.join(this.cwd, ".pi", "dc-services");
    this.logsDir = path.join(this.runtimeDir, "logs");
    this.stateFilePath = path.join(this.runtimeDir, "state.json");
    this.ensureDirs();
  }

  private ensureDirs(): void {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
      }
      this.ensureGitIgnore();
    } catch {
      /* ignore */
    }
  }

  private ensureGitIgnore(): void {
    try {
      const gitIgnorePath = path.join(this.cwd, ".gitignore");
      if (fs.existsSync(gitIgnorePath)) {
        const content = fs.readFileSync(gitIgnorePath, "utf8");
        if (!content.includes(".pi/dc-services")) {
          fs.appendFileSync(gitIgnorePath, "\n.pi/dc-services/\n", "utf8");
        }
      }
    } catch {
      /* ignore */
    }
  }

  public getConfigFile(): WorkspaceServicesConfigFile {
    const candidates = [
      path.join(this.cwd, ".pi", "services.json"),
      path.join(this.cwd, ".pi", "workspace-services.json"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        try {
          const raw = fs.readFileSync(candidate, "utf8");
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.services === "object") {
            return parsed as WorkspaceServicesConfigFile;
          }
        } catch {
          /* continue */
        }
      }
    }

    return { services: {} };
  }

  private readState(): Record<string, SavedProcessState> {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, "utf8");
        return JSON.parse(raw) as Record<string, SavedProcessState>;
      }
    } catch {
      /* fallback */
    }
    return {};
  }

  private writeState(state: Record<string, SavedProcessState>): void {
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2) + "\n", "utf8");
    } catch {
      /* ignore */
    }
  }

  public isProcessAlive(pid: number): boolean {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (e: any) {
      return e?.code === "EPERM";
    }
  }

  public getLogPath(serviceName: string): string {
    return path.join(this.logsDir, `${serviceName}.log`);
  }

  public listConfiguredServices(): Record<string, ServiceConfig> {
    return this.getConfigFile().services;
  }

  public getServiceStatus(name: string): ServiceRuntimeStatus {
    const config = this.getConfigFile().services[name];
    const state = this.readState()[name];
    const logPath = this.getLogPath(name);

    if (!config) {
      throw new Error(`Servicio "${name}" no encontrado en .pi/services.json`);
    }

    let isRunning = false;
    let uptimeSeconds: number | undefined;
    let startedAtStr: string | undefined;

    if (state && this.isProcessAlive(state.pid)) {
      isRunning = true;
      uptimeSeconds = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
      startedAtStr = new Date(state.startedAt).toISOString();
    }

    return {
      name,
      state: isRunning ? "running" : "stopped",
      pid: isRunning ? state?.pid : undefined,
      uptimeSeconds,
      startedAt: startedAtStr,
      command: config.command,
      logPath,
      description: config.description,
    };
  }

  public getAllStatuses(): ServiceRuntimeStatus[] {
    const services = this.getConfigFile().services;
    const names = Object.keys(services);
    return names.map((name) => this.getServiceStatus(name));
  }

  public async startService(name: string): Promise<ServiceRuntimeStatus> {
    const config = this.getConfigFile().services[name];
    if (!config) {
      throw new Error(`Servicio "${name}" no está configurado en .pi/services.json`);
    }

    const state = this.readState();
    const existing = state[name];

    if (existing && this.isProcessAlive(existing.pid)) {
      return this.getServiceStatus(name);
    }

    const serviceCwd = config.cwd
      ? (path.isAbsolute(config.cwd) ? config.cwd : path.resolve(this.cwd, config.cwd))
      : this.cwd;

    const logPath = this.getLogPath(name);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logFd = fs.openSync(logPath, "a");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `\n=== [DC Services] Starting ${name} at ${timestamp}: ${config.command} ===\n`, "utf8");

    const child = spawn(config.command, [], {
      cwd: serviceCwd,
      shell: true,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        ...config.env,
      },
    });

    try {
      fs.closeSync(logFd);
    } catch {
      /* ignore */
    }

    const pid = child.pid;
    if (!pid) {
      throw new Error(`No se pudo iniciar el proceso para ${name}`);
    }

    child.unref();

    state[name] = {
      pid,
      startedAt: Date.now(),
      command: config.command,
    };
    this.writeState(state);

    // Breve pausa para comprobar si murió de inmediato
    await new Promise((r) => setTimeout(r, 200));

    return this.getServiceStatus(name);
  }

  public async stopService(name: string, timeoutMs: number = 5000): Promise<ServiceRuntimeStatus> {
    const state = this.readState();
    const record = state[name];
    const logPath = this.getLogPath(name);

    if (!record || !this.isProcessAlive(record.pid)) {
      delete state[name];
      this.writeState(state);
      return this.getServiceStatus(name);
    }

    const pid = record.pid;

    try {
      // Intentar matar el grupo de procesos (SIGTERM)
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* ignore */
      }
    }

    const start = Date.now();
    while (this.isProcessAlive(pid) && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }

    if (this.isProcessAlive(pid)) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }

    delete state[name];
    this.writeState(state);

    try {
      fs.appendFileSync(logPath, `\n=== [DC Services] Stopped ${name} at ${new Date().toISOString()} ===\n`, "utf8");
    } catch {
      /* ignore */
    }

    return this.getServiceStatus(name);
  }

  public async restartService(name: string): Promise<ServiceRuntimeStatus> {
    await this.stopService(name);
    return this.startService(name);
  }

  public getLogs(options: ServiceLogsOptions): ServiceLogsResult {
    const logPath = this.getLogPath(options.service);
    const limit = Math.min(2000, Math.max(1, options.lines ?? 100));
    const maxBytes = options.maxBytes ?? 100 * 1024;

    if (!fs.existsSync(logPath)) {
      return {
        service: options.service,
        logPath,
        totalLines: 0,
        lines: ["(archivo de logs vacío o sin iniciar)"],
        byteSize: 0,
      };
    }

    const stat = fs.statSync(logPath);
    const byteSize = stat.size;

    // Leer solo la cola si el archivo es grande
    const bufferSize = Math.min(maxBytes, byteSize);
    const buffer = Buffer.alloc(bufferSize);
    const fd = fs.openSync(logPath, "r");
    try {
      fs.readSync(fd, buffer, 0, bufferSize, Math.max(0, byteSize - bufferSize));
    } finally {
      fs.closeSync(fd);
    }

    const text = redactSecrets(buffer.toString("utf8"));
    const allLines = text.split("\n");
    const slice = allLines.slice(-limit);

    return {
      service: options.service,
      logPath,
      totalLines: allLines.length,
      lines: slice,
      byteSize,
    };
  }
}
