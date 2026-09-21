import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

const DC_LOGO = [
  "              ██████████████████████████████████████████████████              ",
  "            ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████            ",
  "          ████░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░░████          ",
  "        ████░▒▒▒▒▒████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒████▒▒▒░░░████        ",
  "      ████░▒▒▒▒▒████░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░░████▒▒▒░░░████      ",
  "      ████▒▒▒▒▒░████▒▒▒▒▒▒▒▒▒▒██████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒▒▒▒▒▒▒░██░░░██▒▒▒▒▒██████▒▒▒▒▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒▒▒▒▒▒▒░██▒▒░░██▒▒▒██░░░░▒▒▒▒▒▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒▒▒▒▒▒▒░██▒▒▒░██▒▒░██▒▒▒▒▒▒▒▒▒▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒▒▒▒▒▒▒░██▒▒▒██▒▒▒░██▒▒▒▒▒▒▒▒▒▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "    ████░▒▒▒▒▒████░▒▒▒▒▒▒▒▒▒▒░██████▒▒▒▒░░██████▒▒▒▒▒▒▒▒▒░░░████▒▒▒░░░████    ",
  "  ████░▒▒▒▒▒████░▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░▒▒▒▒▒▒░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒░░░████▒▒▒░░░████  ",
  "  ████▒▒▒▒▒░████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░████▒▒▒▒▒░████  ",
  "    ████▒▒▒░░░████▒▒▒▒▒▒██████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒████░▒▒▒▒▒████    ",
  "      ████▒▒▒░░░████▒▒▒░██░░░██▒▒▒▒▒█████▒▒▒▒██▒▒▒▒▒▒██▒▒▒████░▒▒▒▒▒████      ",
  "      ████▒▒▒▒▒░████▒▒▒░██▒▒░░██▒▒▒██░░░██▒▒░░██▒▒▒▒██▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒░██▒▒▒░██▒▒░███████▒▒▒░░██▒▒██▒▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒░██▒▒▒██▒▒▒░██░░░░▒▒▒▒▒░░████▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒░██████▒▒▒▒░░█████▒▒▒▒▒▒░░██▒▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "      ████▒▒▒▒▒░████▒▒▒░░░░░░▒▒▒▒▒▒░░░░░▒▒▒▒▒▒▒▒░░▒▒▒▒▒▒▒░████▒▒▒▒▒░████      ",
  "        ████▒▒▒░░░████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒████░▒▒▒▒▒████        ",
  "          ████▒▒▒░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░▒▒▒▒▒████          ",
  "            ████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒████            ",
  "              █████████████████████████████████████████████████               ",
];

const FULL_WIDTH = Math.max(...DC_LOGO.map((l) => [...l].length));
const COMPACT_ART = ["✦ Dc Studio ✦"];

// Frames del thinking (animación cuando piensa). 8 frames estilo barra rebotando.
const THINKING_FRAMES = [
  "☻☻☻☺☺☺☺",
  "☺☻☻☻☺☺☺",
  "☺☺☻☻☻☺☺",
  "☺☺☺☻☻☻☺",
  "☺☺☺☺☻☻☻",
  "☺☺☺☻☻☻☺",
  "☺☺☻☻☻☺☺",
  "☺☻☻☻☺☺☺",
];

// Escala sangre: brillo → sangre profunda (a juego con tema Dc-Sangre).
const ROBO_TOP: [number, number, number] = [255, 51, 51]; // bloodBright #ff3333
const ROBO_BOTTOM: [number, number, number] = [153, 0, 0]; // bloodDeep #990000

function rgb(r: number, g: number, b: number, text: string): string {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function roboShade(row: number, total: number): [number, number, number] {
  const t = total <= 1 ? 0 : row / (total - 1);
  return [
    lerp(ROBO_TOP[0], ROBO_BOTTOM[0], t),
    lerp(ROBO_TOP[1], ROBO_BOTTOM[1], t),
    lerp(ROBO_TOP[2], ROBO_BOTTOM[2], t),
  ];
}

function centerPad(lineWidth: number, width: number): string {
  return " ".repeat(Math.max(0, Math.floor((width - lineWidth) / 2)));
}

const G_BANNER_ACTIVE = Symbol.for("dc.banner.active");
const G_TUI = Symbol.for("dc.sidebar.tui-ref");

function notifyLayoutRender(): void {
  try {
    const tui = (globalThis as unknown as Record<symbol, { requestRender?: () => void } | undefined>)[G_TUI];
    tui?.requestRender?.();
  } catch {
    /* noop */
  }
}

export default function (pi: ExtensionAPI) {
  let dispose = () => {};
  let dismissed = false;
  pi.on("session_shutdown", () => {
    dispose();
    dismissed = false;
    (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = false;
  });

  // Al mandar el primer mensaje se oculta el logo: header vacio y activa marcos.
  const hideHeader = (ctx: { ui: { setHeader: (h: unknown) => void } }) => {
    if (dismissed) return;
    dismissed = true;
    (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = false;
    notifyLayoutRender();
    try {
      ctx.ui.setHeader(() => ({
        render(_width: number): string[] {
          return [];
        },
        invalidate() {},
      }));
    } catch {
      /* noop */
    }
  };

  pi.on("message_start", async (event, ctx) => {
    const role = (event as { message?: { role?: string } }).message?.role;
    if (role === "user") hideHeader(ctx as never);
  });

  // Fallback: el primer turno siempre viene tras el primer mensaje del user.
  pi.on("turn_start", async (_event, ctx) => {
    hideHeader(ctx as never);
  });

  pi.on("session_start", async (event, ctx) => {
    dispose();
    dismissed = false;
    if (!ctx.hasUI) {
      (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = false;
      return;
    }

    // Logo en arranque nuevo, /new Y en /reload si no hay mensajes.
    const reason = (event as { reason?: string } | undefined)?.reason;
    const isApplicableReason =
      !reason ||
      reason === "startup" ||
      reason === "new" ||
      reason === "new-session" ||
      reason === "reload";
    if (!isApplicableReason) {
      (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = false;
      return;
    }

    // Si la sesión ya tiene mensajes (reanudando chat), no mostrar logo y activar marcos
    const hasMessages = (ctx as any).sessionManager?.getEntries?.()?.some?.(
      (e: any) => e?.type === "message" && e?.message?.role === "user"
    );
    if (hasMessages) {
      dismissed = true;
      (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = false;
      return;
    }

    // No molestar comandos CLI como `pi update` / `pi install` con el banner.
    const isCLICommand =
      process.argv.length > 2 &&
      !process.argv.every((arg) => arg.startsWith("-") || arg.endsWith(".ts"));
    if (isCLICommand) {
      (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = false;
      return;
    }

    (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = true;
    notifyLayoutRender();

    dispose = () => {};
    // Thinking custom: tus 8 frames ☻/☺ en rojo sangre.
    try {
      ctx.ui.setWorkingIndicator({
        frames: THINKING_FRAMES.map((f) => rgb(...ROBO_TOP, f)),
        intervalMs: 120,
      });
    } catch {
      /* noop */
    }

    // Interceptar setHiddenThinkingLabel para que cualquier indicador ("Thinking... Xs", "Thought for Xs")
    // use estrictamente la paleta rojo sangre y nunca se muestre en azul.
    try {
      const proto = Object.getPrototypeOf(ctx.ui);
      if (proto && typeof proto.setHiddenThinkingLabel === "function") {
        const origSetHidden = proto.setHiddenThinkingLabel;
        proto.setHiddenThinkingLabel = function (label?: string) {
          if (!label) return origSetHidden.call(this, label);
          // Si trae secuencias de color azul/celeste (B > R o G > R), convertirlas a rojo sangre brillante:
          const sanitized = label.replace(
            /\x1b\[38;2;(\d+);(\d+);(\d+)m/g,
            (match, rStr, gStr, bStr) => {
              const r = Number(rStr);
              const g = Number(gStr);
              const b = Number(bStr);
              if (b > r || g > r) {
                return "\x1b[38;2;255;77;77m"; // rojo sangre brillante
              }
              return match;
            }
          );
          return origSetHidden.call(this, sanitized);
        };
      }
    } catch {
      /* noop */
    }
    setTimeout(() => {
      try {
        if (dismissed) return;
        ctx.ui.setHeader(() => {
        return {
          render(width: number): string[] {
            const w = Math.max(1, width);
            const useFull = w >= 82;
            const art = useFull ? DC_LOGO : COMPACT_ART;
            const out: string[] = [];
            // Aire arriba: 10 enters para cuadrar el logo a mitad de pantalla.
            out.push("", "", "", "", "", "", "", "", "", "");
            // El logo ya trae sus espacios internos (canvas FULL_WIDTH).
            // Pad uniforme: centrar cada linea recortada la corria a la derecha en T/2.
            const fullPad = centerPad(FULL_WIDTH, w);

            for (let i = 0; i < art.length; i++) {
              const raw = art[i] ?? "";
              const trimmed = raw.replace(/\s+$/g, "");
              const pad = useFull ? fullPad : centerPad([...trimmed].length, w);
              let painted = trimmed;
              if (useFull) {
                const [r, g, b] = roboShade(i, art.length);
                painted = rgb(r, g, b, trimmed);
              } else {
                painted = rgb(...ROBO_TOP, trimmed);
              }
              out.push(truncateToWidth(pad + painted, w, ""));
            }

            return out;
          },
          invalidate() {},
        };
      });
      } catch {
        /* noop */
      }
    }, 50);
  });
}
