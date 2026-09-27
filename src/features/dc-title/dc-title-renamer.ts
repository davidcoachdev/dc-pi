import { execFileSync } from "node:child_process";
import * as path from "node:path";

export interface RenameTabOptions {
  /** Función de ejecución personalizada (para pruebas unitarias). */
  execFn?: (cmd: string, args: string[]) => string | void;
  /** Función de escritura OSC (para pruebas unitarias). */
  writeOscFn?: (data: string) => void;
  /** Variables de entorno personalizadas (para pruebas unitarias). */
  env?: Record<string, string | undefined>;
  /** Directorio de trabajo para derivar el nombre de proyecto / lab. */
  cwd?: string;
}

export interface RenameTabResult {
  herdr: boolean;
  tmux: boolean;
  osc: boolean;
  workspaceRenamed?: boolean;
}

/**
 * Detecta si el entorno actual se ejecuta bajo Herdr.
 */
export function isHerdr(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.HERDR_PANE_ID || env.HERDR_ENV);
}

/**
 * Detecta si el entorno actual se ejecuta bajo Tmux.
 */
export function isTmux(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.TMUX);
}

/**
 * Deriva un nombre conciso de proyecto o laboratorio a partir de la ruta del workspace (cwd).
 * Ejemplos:
 * - "/home/dc-studio/dc-lab/dc-projects/dc-pi" -> "dc-pi"
 * - "/home/dc-studio/dc-lab/lab-00" -> "lab-00"
 * - "/home/dc-studio" -> "home"
 */
export function deriveProjectName(cwd: string = process.cwd()): string {
  const normalized = path.resolve(cwd);
  const base = path.basename(normalized);
  return base || "dc-studio";
}

/**
 * Renombra la pestaña y el Workspace activo en Herdr, Tmux y terminal compatible con OSC 0.
 */
export function renameTab(
  title = "⛩  Dc Studio",
  options?: RenameTabOptions,
): RenameTabResult {
  const result: RenameTabResult = { herdr: false, tmux: false, osc: false };
  const env = options?.env ?? process.env;
  const exec = options?.execFn ?? ((cmd, args) => execFileSync(cmd, args, { stdio: "ignore", timeout: 1500 }));
  const writeOsc = options?.writeOscFn ?? ((str) => process.stdout.write(str));

  // 1. Herdr: renombrar tab y renombrar workspace al nombre del proyecto/lab
  if (isHerdr(env)) {
    try {
      const herdrBin = env.HERDR_BIN_PATH ?? "herdr";
      let tabId = env.HERDR_TAB_ID;
      let workspaceId = env.HERDR_WORKSPACE_ID;

      if ((!tabId || !workspaceId) && env.HERDR_PANE_ID) {
        try {
          const out = options?.execFn
            ? (options.execFn(herdrBin, ["pane", "get", env.HERDR_PANE_ID]) as string)
            : execFileSync(herdrBin, ["pane", "get", env.HERDR_PANE_ID], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
                timeout: 1500,
              });
          if (typeof out === "string" && out.trim().length > 0) {
            const parsed = JSON.parse(out);
            tabId = parsed?.result?.pane?.tab_id;
            workspaceId = parsed?.result?.pane?.workspace_id;
          }
        } catch {
          /* Fallback sin pane info */
        }
      }

      // Renombrar la pestaña
      if (tabId) {
        exec(herdrBin, ["tab", "rename", String(tabId), title]);
        result.herdr = true;
      }

      // Renombrar el workspace al nombre del proyecto o lab (ej: dc-pi)
      if (workspaceId) {
        const projectName = deriveProjectName(options?.cwd ?? process.cwd());
        try {
          exec(herdrBin, ["workspace", "rename", String(workspaceId), projectName]);
          result.workspaceRenamed = true;
        } catch {
          /* noop */
        }
      }
    } catch {
      /* noop */
    }
  }

  // 2. Tmux window rename
  if (isTmux(env)) {
    try {
      const args = ["rename-window"];
      if (env.TMUX_PANE) {
        args.push("-t", env.TMUX_PANE);
      }
      args.push(title);
      exec("tmux", args);
      result.tmux = true;
    } catch {
      /* noop */
    }
  }

  // 3. Secuencia OSC 0 para emuladores de terminal
  try {
    writeOsc(`\x1b]0;${title}\x07`);
    result.osc = true;
  } catch {
    /* noop */
  }

  return result;
}
