/**
 * dc-title — Renombra la pestaña / ventana a "Pi" en Herdr y Tmux.
 *
 * Al abrir Pi (arranque de sesión o recarga), detecta el multiplexor activo
 * y renombra la pestaña actual a "Pi":
 *   - En Herdr: usa `herdr tab rename <tab_id> Pi`
 *   - En Tmux:  usa `tmux rename-window [-t target] Pi`
 *   - Terminal: emite secuencia OSC 0 para emuladores de terminal
 *
 * Comando: /titulo [nombre] (por defecto "Pi")
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";

const HERDR_BIN =
  process.env.HERDR_BIN_PATH ??
  "/home/linuxbrew/.linuxbrew/Cellar/herdr/0.9.0/bin/herdr";

export function isHerdr(): boolean {
  return typeof process !== "undefined" && Boolean(process.env.HERDR_PANE_ID || process.env.HERDR_ENV);
}

export function isTmux(): boolean {
  return typeof process !== "undefined" && Boolean(process.env.TMUX);
}

export function renameTab(title = "Pi"): { herdr: boolean; tmux: boolean; osc: boolean } {
  const result = { herdr: false, tmux: false, osc: false };

  // 1. Herdr tab rename
  if (isHerdr()) {
    try {
      let tabId = process.env.HERDR_TAB_ID;
      if (!tabId && process.env.HERDR_PANE_ID) {
        const out = execFileSync(
          HERDR_BIN,
          ["pane", "get", process.env.HERDR_PANE_ID],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1500 },
        );
        const parsed = JSON.parse(out);
        tabId = parsed?.result?.pane?.tab_id;
      }
      if (tabId) {
        execFileSync(HERDR_BIN, ["tab", "rename", tabId, title], {
          stdio: "ignore",
          timeout: 1500,
        });
        result.herdr = true;
      }
    } catch {
      /* noop */
    }
  }

  // 2. Tmux window rename
  if (isTmux()) {
    try {
      const args = ["rename-window"];
      if (process.env.TMUX_PANE) {
        args.push("-t", process.env.TMUX_PANE);
      }
      args.push(title);
      execFileSync("tmux", args, { stdio: "ignore", timeout: 1500 });
      result.tmux = true;
    } catch {
      /* noop */
    }
  }

  // 3. Secuencia OSC para emuladores de terminal
  try {
    process.stdout.write(`\x1b]0;${title}\x07`);
    result.osc = true;
  } catch {
    /* noop */
  }

  return result;
}

export default function dcTitleExtension(pi: ExtensionAPI) {
  // Renombrar automáticamente en session_start
  pi.on("session_start", async (_event, _ctx) => {
    try {
      renameTab("Pi");
    } catch {
      /* noop */
    }
  });

  // Comando manual: /titulo [nuevo_nombre]
  pi.registerCommand("titulo", {
    description: "Renombra la pestaña activa a Pi (o al nombre indicado) en Herdr/Tmux",
    handler: async (args, ctx) => {
      const name = (args ?? "").trim() || "Pi";
      const res = renameTab(name);
      if (ctx.hasUI) {
        const targets: string[] = [];
        if (res.herdr) targets.push("Herdr");
        if (res.tmux) targets.push("Tmux");
        if (res.osc) targets.push("Terminal");
        const detail = targets.length ? ` en ${targets.join(" + ")}` : "";
        ctx.ui.notify(`Pestaña renombrada a "${name}"${detail}`, "info");
      }
    },
  });
}
