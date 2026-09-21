import { execFileSync } from "node:child_process";

export interface RenameTabOptions {
  /** Función de ejecución personalizada (para pruebas unitarias). */
  execFn?: (cmd: string, args: string[]) => string | void;
  /** Función de escritura OSC (para pruebas unitarias). */
  writeOscFn?: (data: string) => void;
  /** Variables de entorno personalizadas (para pruebas unitarias). */
  env?: Record<string, string | undefined>;
}

export interface RenameTabResult {
  herdr: boolean;
  tmux: boolean;
  osc: boolean;
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
 * Renombra la pestaña / ventana activa en Herdr, Tmux y terminal compatible con OSC 0.
 */
export function renameTab(
  title = "Pi",
  options?: RenameTabOptions,
): RenameTabResult {
  const result: RenameTabResult = { herdr: false, tmux: false, osc: false };
  const env = options?.env ?? process.env;
  const exec = options?.execFn ?? ((cmd, args) => execFileSync(cmd, args, { stdio: "ignore", timeout: 1500 }));
  const writeOsc = options?.writeOscFn ?? ((str) => process.stdout.write(str));

  // 1. Herdr tab rename
  if (isHerdr(env)) {
    try {
      const herdrBin = env.HERDR_BIN_PATH ?? "herdr";
      let tabId = env.HERDR_TAB_ID;

      if (!tabId && env.HERDR_PANE_ID) {
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
          }
        } catch {
          /* Fallback sin tabId */
        }
      }

      if (tabId) {
        exec(herdrBin, ["tab", "rename", String(tabId), title]);
        result.herdr = true;
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
