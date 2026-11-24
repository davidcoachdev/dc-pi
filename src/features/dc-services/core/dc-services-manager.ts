import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import type {
  ServiceConfig,
  ServiceLogsOptions,
  ServiceLogsResult,
  ServiceRuntimeStatus,
  WorkspaceServicesConfigFile,
} from "./dc-services-types.ts";
import { assertPathWithinRoots } from "../../../core/dc-path-confinement.ts";
import { redactSecrets } from "../../dc-websearch/core/dc-websearch-security.ts";

const VALID_SERVICE_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const VALID_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertValidServiceName(serviceName: string): string {
  if (
    typeof serviceName !== "string" ||
    serviceName.length === 0 ||
    !VALID_SERVICE_NAME_RE.test(serviceName) ||
    serviceName === "." ||
    serviceName === ".." ||
    serviceName.includes("..")
  ) {
    throw new Error(
      `Nombre de servicio inválido: "${String(serviceName)}". Solo se permiten [a-zA-Z0-9._-] sin ".." ni separadores de ruta.`,
    );
  }
  return serviceName;
}

function sanitizeServiceEnv(
  env: Record<string, string> | undefined,
): Record<string, string> {
  if (!env || typeof env !== "object") return {};
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!VALID_ENV_KEY_RE.test(key)) {
      throw new Error(`Variable de entorno inválida en configuración de servicio: "${key}"`);
    }
    if (typeof value !== "string" || value.includes("\0")) {
      throw new Error(`Valor inválido para variable de entorno "${key}"`);
    }
    cleaned[key] = value;
  }
  return cleaned;
}

interface SavedProcessState {
  pid: number;
  startedAt: number;
  command: string;
}

const sessionStartedServices = new Map<string, Set<string>>();

export function recordSessionStartedService(cwd: string, name: string): void {
  const resolved = path.resolve(cwd);
  let set = sessionStartedServices.get(resolved);
  if (!set) {
    set = new Set<string>();
    sessionStartedServices.set(resolved, set);
  }
  set.add(name);
}

export function clearSessionStartedService(cwd: string, name: string): void {
  const resolved = path.resolve(cwd);
  sessionStartedServices.get(resolved)?.delete(name);
}

export async function stopSessionStartedServices(cwd?: string): Promise<void> {
  const targets = cwd
    ? [path.resolve(cwd)]
    : Array.from(sessionStartedServices.keys());

  for (const dir of targets) {
    const names = sessionStartedServices.get(dir);
    if (!names || names.size === 0) continue;
    const manager = new DcServicesManager(dir);
    const configured = manager.listConfiguredServices();
    for (const name of Array.from(names)) {
      const cfg = configured[name] as (ServiceConfig & { persistent?: boolean; stopOnShutdown?: boolean }) | undefined;
      if (cfg?.persistent === true || cfg?.stopOnShutdown === false) {
        continue;
      }
      try {
        await manager.stopService(name, 2000);
      } catch {
        /* ignore shutdown error */
      }
      names.delete(name);
    }
    if (names.size === 0) {
      sessionStartedServices.delete(dir);
    }
  }
}

export class DcServicesManager {
  private readonly cwd: string;
  private runtimeDir: string;
  private logsDir: string;
  private stateFilePath: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
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
    const safeName = assertValidServiceName(serviceName);
    const candidate = path.join(this.logsDir, `${safeName}.log`);
    return assertPathWithinRoots(candidate, [this.logsDir], `log del servicio "${safeName}"`);
  }

  public listConfiguredServices(): Record<string, ServiceConfig> {
    return this.getConfigFile().services;
  }

  public getServiceStatus(name: string): ServiceRuntimeStatus {
    const safeName = assertValidServiceName(name);
    const config = this.getConfigFile().services[safeName];
    const state = this.readState()[safeName];
    const logPath = this.getLogPath(safeName);

    if (!config) {
      throw new Error(`Servicio "${safeName}" no encontrado en .pi/services.json`);
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
      name: safeName,
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
    const safeName = assertValidServiceName(name);
    const config = this.getConfigFile().services[safeName];
    if (!config) {
      throw new Error(`Servicio "${safeName}" no está configurado en .pi/services.json`);
    }
    if (typeof config.command !== "string" || config.command.trim().length === 0 || config.command.includes("\0")) {
      throw new Error(`Comando inválido para el servicio "${safeName}"`);
    }

    const state = this.readState();
    const existing = state[safeName];

    if (existing && this.isProcessAlive(existing.pid)) {
      return this.getServiceStatus(safeName);
    }

    const rawServiceCwd = config.cwd
      ? path.resolve(this.cwd, config.cwd)
      : this.cwd;
    const serviceCwd = assertPathWithinRoots(
      rawServiceCwd,
      [this.cwd],
      `directorio de trabajo del servicio "${safeName}"`,
    );
    const serviceEnv = sanitizeServiceEnv(config.env);

    const logPath = this.getLogPath(safeName);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const logFd = fs.openSync(logPath, "a");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `\n=== [DC Services] Starting ${safeName} at ${timestamp}: ${config.command} ===\n`, "utf8");

    // Local developer-authored `.pi/services.json` commands may use shell syntax
    // (pipes, &&, quoted args, npm scripts). `serviceCwd`, `serviceName`, `logPath`
    // and `serviceEnv` are strictly validated/confined before spawning.
    const child = spawn(config.command, [], {
      cwd: serviceCwd,
      shell: true,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        ...serviceEnv,
      },
    });

    try {
      fs.closeSync(logFd);
    } catch {
      /* ignore */
    }

    const pid = child.pid;
    if (!pid) {
      throw new Error(`No se pudo iniciar el proceso para ${safeName}`);
    }

    child.unref();

    state[safeName] = {
      pid,
      startedAt: Date.now(),
      command: config.command,
    };
    this.writeState(state);
    recordSessionStartedService(this.cwd, safeName);

    // Breve pausa para comprobar si murió de inmediato
    await new Promise((r) => setTimeout(r, 200));

    return this.getServiceStatus(safeName);
  }

  public async stopService(name: string, timeoutMs: number = 5000): Promise<ServiceRuntimeStatus> {
    const safeName = assertValidServiceName(name);
    const state = this.readState();
    const record = state[safeName];
    const logPath = this.getLogPath(safeName);
    clearSessionStartedService(this.cwd, safeName);

    if (!record || !this.isProcessAlive(record.pid)) {
      delete state[safeName];
      this.writeState(state);
      return this.getServiceStatus(safeName);
    }

    const pid = record.pid;
    const isWin = process.platform === "win32";

    if (isWin) {
      try {
        execFileSync("taskkill", ["/PID", String(pid), "/T"], { stdio: "ignore", timeout: 2000 });
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          /* ignore */
        }
      }
    } else {
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
    }

    const start = Date.now();
    while (this.isProcessAlive(pid) && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }

    if (this.isProcessAlive(pid)) {
      if (isWin) {
        try {
          execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", timeout: 2000 });
        } catch {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            /* ignore */
          }
        }
      } else {
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
    }

    delete state[safeName];
    this.writeState(state);

    try {
      fs.appendFileSync(logPath, `\n=== [DC Services] Stopped ${safeName} at ${new Date().toISOString()} ===\n`, "utf8");
    } catch {
      /* ignore */
    }

    return this.getServiceStatus(safeName);
  }

  public async restartService(name: string): Promise<ServiceRuntimeStatus> {
    const safeName = assertValidServiceName(name);
    await this.stopService(safeName);
    return this.startService(safeName);
  }

  public getLogs(options: ServiceLogsOptions): ServiceLogsResult {
    const safeName = assertValidServiceName(options.service);
    const logPath = this.getLogPath(safeName);
    const limit = Math.min(2000, Math.max(1, options.lines ?? 100));
    const maxBytes = options.maxBytes ?? 100 * 1024;

    if (!fs.existsSync(logPath)) {
      return {
        service: safeName,
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
      service: safeName,
      logPath,
      totalLines: allLines.length,
      lines: slice,
      byteSize,
    };
  }
}
