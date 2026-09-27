export interface ServiceConfig {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  env_file?: boolean;
  description?: string;
}

export interface WorkspaceServicesConfigFile {
  services: Record<string, ServiceConfig>;
}

export type ServiceStatusState = "running" | "stopped" | "failed" | "unknown";

export interface ServiceRuntimeStatus {
  name: string;
  state: ServiceStatusState;
  pid?: number;
  uptimeSeconds?: number;
  startedAt?: string;
  exitCode?: number | null;
  command: string;
  logPath: string;
  description?: string;
}

export interface ServiceLogsOptions {
  service: string;
  lines?: number;
  maxBytes?: number;
}

export interface ServiceLogsResult {
  service: string;
  logPath: string;
  totalLines: number;
  lines: string[];
  byteSize: number;
}
