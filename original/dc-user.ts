/**
 * dc-user — nombre del usuario para el chrome de DC Studio.
 *
 * - Se guarda en ~/.pi/agent/dc-user.json → { "name": "..." }
 * - Si NO está, al arrancar lo PREGUNTA una vez (ventana DcWindow) y lo guarda.
 * - `/usuario [nombre]` para cambiarlo cuando quieras.
 * - Exporta `userName()` para que otras extensiones lo usen en sus títulos.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { Component, TUI } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DcWindow } from "./dc-window.ts";
import { notify } from "./dc-notify.ts";

const FILE = path.join(os.homedir(), ".pi/agent/dc-user.json");

/** Nombre guardado ("" si todavía no hay). */
export function userName(): string {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8")) as { name?: string };
    return typeof j.name === "string" ? j.name.trim() : "";
  } catch {
    return "";
  }
}

function saveName(name: string): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ name: name.trim() }));
  } catch {
    /* noop */
  }
}

/** Input de texto mínimo: imprimibles, backspace, enter (ok), esc (cancelar). */
class PromptInput implements Component {
  private value = "";
  constructor(
    private readonly theme: Theme,
    private readonly tui: TUI,
    private readonly label: string,
    private readonly onSubmit: (v: string) => void,
    private readonly onCancel: () => void,
  ) {}
  invalidate(): void {}
  render(_width: number): string[] {
    const t = this.theme;
    return ["", " " + t.fg("muted", this.label), " " + t.fg("text", this.value) + t.fg("accent", "\u2588")];
  }
  handleInput(data: string): void {
    if (matchesKey(data, Key.enter)) return this.onSubmit(this.value);
    if (matchesKey(data, Key.escape)) return this.onCancel();
    if (matchesKey(data, Key.backspace)) {
      this.value = this.value.slice(0, -1);
      this.tui.requestRender();
      return;
    }
    if (data.length === 1) {
      const c = data.charCodeAt(0);
      if (c >= 32 && c < 127) {
        this.value += data;
        this.tui.requestRender();
      }
    }
  }
}

async function askName(ctx: ExtensionContext): Promise<string> {
  try {
    const res = await ctx.ui.custom<string>(
      (tui, theme, _kb, done) =>
        new DcWindow({
          title: "¿Cómo te llamás?",
          glyph: "\u{1F464}",
          theme,
          content: new PromptInput(theme, tui, "Tu nombre (para el chrome de tus mensajes):", (v) => done(v.trim()), () => done("")),
          onClose: () => done(""),
          paddingX: 1,
          frame: "double",
        }),
      { overlay: true, overlayOptions: { anchor: "center", width: "50%", maxHeight: "40%" } },
    );
    return typeof res === "string" ? res.trim() : "";
  } catch {
    return "";
  }
}

export default function dcUserExtension(pi: ExtensionAPI) {
  let asked = false;
  let timer: NodeJS.Timeout | null = null;

  const askOnce = async (ctx: ExtensionContext) => {
    try {
      if (asked || Boolean(userName()) || !ctx.hasUI || ctx.mode !== "tui") return;
      asked = true;
      const name = await askName(ctx);
      if (name) {
        saveName(name);
        notify(ctx, `usuario: ${name}`);
      }
    } catch {
      /* noop: ignora context stale tras un /reload */
    }
  };

  pi.on("session_shutdown", () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    // Si ya hay nombre guardado, no hay nada que preguntar ni esperar
    if (userName()) return;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void askOnce(ctx);
    }, 4000);
    (timer as { unref?: () => void }).unref?.();
  });

  // Fallback: si el usuario manda el primer prompt antes del delay, preguntamos ahí.
  pi.on("message_start", async (event, ctx) => {
    const role = (event as { message?: { role?: string } }).message?.role;
    if (role === "user") void askOnce(ctx);
  });

  pi.registerCommand("usuario", {
    description: "Ver/cambiar tu nombre (chrome DC Studio)",
    handler: async (args, ctx) => {
      const arg = (args ?? "").trim();
      const name = arg || (await askName(ctx));
      if (name) {
        saveName(name);
        notify(ctx, `usuario: ${name}`);
      }
    },
  });

  // Atajo para abrir el prompt del nombre (alt+n estaba libre).
  pi.registerShortcut("alt+n", {
    description: "usuario: ver/cambiar tu nombre",
    handler: async (ctx) => {
      const name = await askName(ctx);
      if (name) {
        saveName(name);
        notify(ctx, `usuario: ${name}`);
      }
    },
  });
}
