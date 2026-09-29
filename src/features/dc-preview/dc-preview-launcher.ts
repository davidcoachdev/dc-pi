import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isHerdr, isTmux } from "../dc-title/dc-title-renamer.ts";

export type DcPreviewToolMode = "manager" | "nvim" | "fzf" | "yazi" | "dc-studio" | "engram";
export type DcPreviewOrientation = "h" | "v";

export const DC_PREVIEW_SPLIT_PERCENT = 40;
export const DC_PREVIEW_PI_RATIO = 0.6;

export const DC_PREVIEW_TOOL_LABELS: Record<DcPreviewToolMode, string> = {
  manager: "📊  task-manager",
  nvim: "📝  nvim",
  fzf: "🔍  fzf",
  yazi: "🦆  yazi",
  "dc-studio": "🧰  dc-studio",
  engram: "🧠  engram (TUI)",
};

export const DC_PREVIEW_DIRECTION_LABELS: Record<DcPreviewOrientation, string> = {
  h: "→  A la derecha (40%)",
  v: "↓  Abajo        (40%)",
};

// Colores DC Studio para fzf inline
export const FZF_COLORS =
  "--color=fg:#ffcccc,bg:#0d0d0d,hl:#ff9999,fg+:#000000,bg+:#ff3333 " +
  "--color=hl+:#ff4d4d,info:#ff6666,prompt:#ff6666,pointer:#ff3333 " +
  "--color=marker:#ff4d4d,spinner:#ff9999,header:#262626,border:#404040,gutter:#262626 ";

export const VIEWER_FZF_RIGHT =
  'set -l sel (fzf --height=100% ' +
  '--preview="bat --theme=gruvbox-dark --color=always --style=numbers {}" ' +
  "--preview-window=down,50% " +
  FZF_COLORS +
  '--bind "ctrl-p:toggle-preview,' +
  'ctrl-down:preview-down,ctrl-up:preview-up,ctrl-right:preview-page-down,ctrl-left:preview-page-up"' +
  '); and nvim "$sel"; or exec fish';

export const VIEWER_FZF_DOWN =
  'set -l sel (fzf --layout=reverse --height=100% ' +
  '--preview="bat --theme=gruvbox-dark --color=always --style=numbers {}" ' +
  "--preview-window=left,50% " +
  FZF_COLORS +
  '--bind "ctrl-p:toggle-preview,' +
  'ctrl-down:preview-down,ctrl-up:preview-up,ctrl-right:preview-page-down,ctrl-left:preview-page-up"' +
  '); and nvim "$sel"; or exec fish';

export function parseToolArg(s: string | undefined): DcPreviewToolMode | undefined {
  if (!s) return undefined;
  const t = s.trim().toLowerCase();
  if (t === "manager" || t === "task-manager" || t === "taskmanager") return "manager";
  if (t === "nvim" || t === "vim") return "nvim";
  if (t === "fzf") return "fzf";
  if (t === "yazi") return "yazi";
  if (t === "dc" || t === "dc-studio" || t === "dcstudio") return "dc-studio";
  if (t === "engram" || t === "tui" || t === "memoria" || t === "memory") return "engram";
  return undefined;
}

export function parseOrientationArg(s: string | undefined): DcPreviewOrientation | undefined {
  if (!s) return undefined;
  const t = s.trim().toLowerCase();
  if (t === "h" || t === "right" || t === "derecha" || t === "r") return "h";
  if (t === "v" || t === "down" || t === "abajo" || t === "d") return "v";
  return undefined;
}

export function resolveTaskManagerScript(customHome?: string): string | undefined {
  const home = customHome ?? os.homedir();
  const candidates = [
    path.join(home, ".local/bin/task-manager-portable-setup.sh"),
    "/home/dcdebian/.local/bin/task-manager-portable-setup.sh",
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* continuar */
    }
  }
  return undefined;
}

export function buildFishToolCommand(
  mode: "nvim" | "fzf" | "yazi" | "dc-studio" | "engram",
  orientation: DcPreviewOrientation,
): string {
  if (mode === "nvim") return "nvim .";
  if (mode === "yazi") return "yazi .";
  if (mode === "dc-studio") return "dc";
  if (mode === "engram") return "engram tui";
  return orientation === "v" ? VIEWER_FZF_DOWN : VIEWER_FZF_RIGHT;
}

export interface DcPreviewLauncherOptions {
  execFn?: (cmd: string, args: string[]) => string | void;
  env?: Record<string, string | undefined>;
}

export interface DcPreviewLaunchResult {
  success: boolean;
  target: "tmux" | "herdr" | "none";
  message: string;
}

/**
 * Abre un panel split (derecha o abajo al 40%) en Tmux o Herdr.
 */
export function launchPanel(
  mode: "nvim" | "fzf" | "yazi" | "dc-studio" | "engram",
  orientation: DcPreviewOrientation,
  cwd: string,
  options?: DcPreviewLauncherOptions,
): DcPreviewLaunchResult {
  const env = options?.env ?? process.env;
  const dir = cwd && cwd.trim().length > 0 ? cwd.trim() : ".";
  const where = orientation === "h" ? "derecha" : "abajo";
  const flag = orientation === "v" ? "-v" : "-h";
  const direction = orientation === "h" ? "right" : "down";
  const fishCmd = buildFishToolCommand(mode, orientation);
  const successMsg = `✔ dc-preview — ${mode} → panel ${where} (${DC_PREVIEW_SPLIT_PERCENT}%)`;

  const exec = options?.execFn ?? ((cmd, args) => execFileSync(cmd, args, { stdio: "ignore" }));

  // 1. Caso Tmux
  if (isTmux(env)) {
    try {
      // Verificar servidor tmux
      if (options?.execFn) {
        options.execFn("tmux", ["list-sessions"]);
      } else {
        execFileSync("tmux", ["list-sessions"], { stdio: "ignore" });
      }
    } catch {
      return {
        success: false,
        target: "tmux",
        message: "No hay servidor tmux activo. Abrí pi dentro de tmux y reintentá.",
      };
    }

    try {
      const args = mode === "engram"
        ? ["split-window", "-p", String(DC_PREVIEW_SPLIT_PERCENT), flag, "-c", dir, "engram", "tui"]
        : ["split-window", "-p", String(DC_PREVIEW_SPLIT_PERCENT), flag, "-c", dir, "fish", "-lc", fishCmd];
      exec("tmux", args);
      return {
        success: true,
        target: "tmux",
        message: successMsg,
      };
    } catch (e) {
      return {
        success: false,
        target: "tmux",
        message: `tmux split falló: ${String(e)}`,
      };
    }
  }

  // 2. Caso Herdr
  if (isHerdr(env)) {
    const currentPaneId = env.HERDR_PANE_ID || "";
    if (!currentPaneId) {
      return {
        success: false,
        target: "herdr",
        message: "No se pudo obtener el pane ID de herdr.",
      };
    }

    let newPaneId: string;
    try {
      const splitArgs = [
        "pane",
        "split",
        currentPaneId,
        "--direction",
        direction,
        "--ratio",
        String(DC_PREVIEW_PI_RATIO),
        "--cwd",
        dir,
        "--focus",
      ];

      const out = options?.execFn
        ? (options.execFn("herdr", splitArgs) as string)
        : execFileSync("herdr", splitArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

      const parsed = JSON.parse(String(out).trim());
      newPaneId = parsed.result.pane.pane_id;
    } catch (e) {
      return {
        success: false,
        target: "herdr",
        message: `Error al hacer split en herdr: ${String(e)}`,
      };
    }

    try {
      const runArgs = mode === "engram"
        ? ["pane", "run", newPaneId, "engram", "tui"]
        : ["pane", "run", newPaneId, "fish", "-lc", fishCmd];
      exec("herdr", runArgs);
      return {
        success: true,
        target: "herdr",
        message: successMsg,
      };
    } catch (e) {
      return {
        success: false,
        target: "herdr",
        message: `Error al ejecutar en nuevo pane de herdr: ${String(e)}`,
      };
    }
  }

  return {
    success: false,
    target: "none",
    message: "No estás en tmux ni herdr. Abrí pi dentro de tmux o herdr y reintentá.",
  };
}
