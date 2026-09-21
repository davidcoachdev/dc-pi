import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getSidebarContext } from "../dc-sidebar.ts";

export interface McpServerDetail {
  name: string;
  disabled: boolean;
  toolsCount?: number;
}

export interface McpInfoResult {
  totalCount: number;
  enabledCount: number;
  disabledCount: number;
  servers: McpServerDetail[];
}

let mcpCacheTimestamp = 0;
let lastMcpCwd = "";
let cachedMcpInfo: McpInfoResult = {
  totalCount: 0,
  enabledCount: 0,
  disabledCount: 0,
  servers: [],
};

/**
 * Inspecciona los archivos de configuración de MCP (globales y de proyecto)
 * y la caché de herramientas de Pi para obtener el estado de cada servidor.
 */
export function getMcpServersInfo(cwd?: string, forceRefresh?: boolean): McpInfoResult {
  const now = Date.now();
  const ctx = getSidebarContext();
  const currentDir = cwd || (ctx as any)?.sessionManager?.getCwd?.() || process.cwd();

  if (
    !forceRefresh &&
    currentDir === lastMcpCwd &&
    now - mcpCacheTimestamp < 3000 &&
    cachedMcpInfo.servers.length > 0
  ) {
    return cachedMcpInfo;
  }

  mcpCacheTimestamp = now;
  lastMcpCwd = currentDir;

  try {
    const mcpGlobalPath = path.join(os.homedir(), ".pi", "agent", "mcp.json");
    const mcpHomePath = path.join(os.homedir(), ".mcp.json");
    const projectMcpPath = path.join(currentDir, "mcp.json");
    const projectPiPath = path.join(currentDir, ".pi", "mcp.json");
    const cachePath = path.join(os.homedir(), ".pi", "agent", "mcp-cache.json");

    const serverDefs: Record<string, any> = {};

    // 1. Fuentes globales
    for (const p of [mcpHomePath, mcpGlobalPath]) {
      if (fs.existsSync(p)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
          if (cfg?.mcpServers && typeof cfg.mcpServers === "object") {
            Object.assign(serverDefs, cfg.mcpServers);
          }
        } catch {
          /* noop */
        }
      }
    }

    // 2. Fuentes locales de proyecto (tienen precedencia sobre disabled)
    for (const p of [projectMcpPath, projectPiPath]) {
      if (fs.existsSync(p)) {
        try {
          const prj = JSON.parse(fs.readFileSync(p, "utf8"));
          if (prj?.mcpServers && typeof prj.mcpServers === "object") {
            for (const [name, def] of Object.entries(prj.mcpServers)) {
              serverDefs[name] = { ...(serverDefs[name] || {}), ...(def as object) };
            }
          }
        } catch {
          /* noop */
        }
      }
    }

    // 3. Caché de herramientas
    let cacheServers: Record<string, { tools?: unknown[] }> = {};
    if (fs.existsSync(cachePath)) {
      try {
        const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        if (cache?.servers && typeof cache.servers === "object") {
          cacheServers = cache.servers;
        }
      } catch {
        /* noop */
      }
    }

    const servers: McpServerDetail[] = Object.keys(serverDefs).map((name) => {
      const def = serverDefs[name];
      const disabled = def?.disabled === true;
      const toolsCount = Array.isArray(cacheServers[name]?.tools)
        ? cacheServers[name].tools.length
        : undefined;
      return {
        name,
        disabled,
        toolsCount,
      };
    });

    const enabledCount = servers.filter((s) => !s.disabled).length;
    const disabledCount = servers.filter((s) => s.disabled).length;

    cachedMcpInfo = {
      totalCount: servers.length,
      enabledCount,
      disabledCount,
      servers,
    };
    return cachedMcpInfo;
  } catch {
    return cachedMcpInfo;
  }
}
