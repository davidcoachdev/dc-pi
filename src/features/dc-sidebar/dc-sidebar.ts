
export const G_CTX = Symbol.for("dc.sidebar.ctx");
export function getSidebarContext(): ExtensionContext | undefined {
  return (globalThis as any)[G_CTX];
}
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { readSidebarPrefs, writeSidebarPrefs, getSidebarBreakpoint } from "./core/dc-sidebar-prefs.ts";
import {
  enforceBar,
  tryWrap,
  startPolling,
  stopPolling,
  restoreNative,
  getTerminalColumns,
  invalidateLayout,
} from "./runtime/dc-sidebar-host.ts";
import { wrapFooterBrand, unwrapFooterBrand } from "./bottom-bar/index.ts";

export const ANCHOR_KEY = "dc-sidebar-anchor";
const G_TUI = Symbol.for("dc.sidebar.tui-ref");

export default function dcSidebarExtension(pi: ExtensionAPI): void {
  // 1. Comando unificado /dc-sidebar
  pi.registerCommand("dc-sidebar", {
    description: "Alternar o configurar la barra lateral de DC Studio (/dc-sidebar [hide|show|minwidth <cols>])",
    handler: async (args: string, ctx: ExtensionContext) => {
      const sub = (args || "").trim().toLowerCase();
      const tui = (globalThis as any)[G_TUI];
      const cols = getTerminalColumns(tui);
      const breakpoint = getSidebarBreakpoint();

      if (sub === "hide") {
        writeSidebarPrefs({ hidden: true });
        dcNotifier.notify(ctx, "DC Sidebar oculta", "info");
      } else if (sub === "show") {
        // PRIMERO validar ancho antes de tocar estado
        if (cols > 0 && cols < breakpoint) {
          dcNotifier.notify(
            ctx,
            `Ancho insuficiente: (actual: ${cols}) < ${breakpoint}.`,
            "warning",
          );
          return;
        }
        writeSidebarPrefs({ hidden: false });
        dcNotifier.notify(ctx, "DC Sidebar visible", "info");
      } else if (sub.startsWith("minwidth ") || sub.startsWith("breakpoint ")) {
        const val = parseInt(sub.split(/\s+/)[1] ?? "", 10);
        if (isNaN(val) || val < 80 || val > 300) {
          dcNotifier.notify(ctx, "Uso: /dc-sidebar minwidth <80-300>", "error");
          return;
        }
        writeSidebarPrefs({ minWidth: val });
        dcNotifier.notify(ctx, `Ancho mínimo configurado a ${val} columnas`, "info");
      } else if (sub === "header on" || sub === "header off") {
        const enabled = sub === "header on";
        writeSidebarPrefs({ headerBar: enabled });
        dcNotifier.notify(ctx, `Barra superior de Gentle Shell: ${enabled ? "visible" : "oculta"}`, "info");
      } else {
        // PRIMERO validar ancho antes de tocar estado
        if (cols > 0 && cols < breakpoint) {
          dcNotifier.notify(
            ctx,
            `Ancho insuficiente: (actual: ${cols}) < ${breakpoint}.`,
            "warning",
          );
          return;
        }
        const current = readSidebarPrefs();
        const nextHidden = !current.hidden;
        writeSidebarPrefs({ hidden: nextHidden });
        dcNotifier.notify(ctx, nextHidden ? "DC Sidebar oculta" : "DC Sidebar visible", "info");
      }

      if (ctx.hasUI && ctx.mode === "tui") {
        if (tui) {
          enforceBar(tui);
          tryWrap(tui);
          wrapFooterBrand(tui, () => ctx.ui.theme);
          invalidateLayout(tui);
          tui.requestRender?.();
        }
      }
    },
  });

  // 2. Atajo canónico Alt+Shift+B
  pi.registerShortcut("alt+shift+b", {
    description: "Alternar visibilidad del sidebar DC Studio",
    handler: async (ctx: ExtensionContext) => {
      const tui = (globalThis as any)[G_TUI];
      const cols = getTerminalColumns(tui);
      const breakpoint = getSidebarBreakpoint();

      // PRIMERO validar ancho antes de tocar el estado persistido
      if (cols > 0 && cols < breakpoint) {
        dcNotifier.notify(
          ctx,
          `Ancho insuficiente: (actual: ${cols}) < ${breakpoint}.`,
          "warning",
        );
        return;
      }

      const current = readSidebarPrefs();
      const nextHidden = !current.hidden;
      writeSidebarPrefs({ hidden: nextHidden });
      dcNotifier.notify(ctx, nextHidden ? "DC Sidebar oculta" : "DC Sidebar visible", "info");

      if (ctx.hasUI && ctx.mode === "tui") {
        if (tui) {
          enforceBar(tui);
          tryWrap(tui);
          wrapFooterBrand(tui, () => ctx.ui.theme);
          invalidateLayout(tui);
          tui.requestRender?.();
        }
      }
    },
  });

  let resizeHandler: (() => void) | null = null;

  // 3. Captura del host y montaje del rail
  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    (globalThis as any)[Symbol.for("dc.sidebar.theme-fn")] = () => ctx.ui.theme;
    (globalThis as any)[G_CTX] = ctx;

    const onResize = () => {
      const tui = (globalThis as any)[G_TUI];
      if (tui) {
        enforceBar(tui);
        tryWrap(tui);
        wrapFooterBrand(tui, () => ctx.ui.theme);
        invalidateLayout(tui);
        tui.requestRender?.();
      }
    };

    resizeHandler = onResize;
    try {
      process.stdout.on("resize", onResize);
    } catch {
      /* noop */
    }

    try {
      ctx.ui.setWidget(ANCHOR_KEY, (tui: any) => {
        (globalThis as any)[G_TUI] = tui;
        try {
          enforceBar(tui);
          tryWrap(tui);
          wrapFooterBrand(tui, () => ctx.ui.theme);
        } catch {
          /* noop */
        }
        return { render: () => [], invalidate() {} };
      });

      const tui = (globalThis as any)[G_TUI];
      if (tui) {
        enforceBar(tui);
        tryWrap(tui);
        wrapFooterBrand(tui, () => ctx.ui.theme);
        startPolling(tui);
        tui.requestRender?.();
      }
    } catch {
      /* noop */
    }

    for (const ms of [400, 1000, 2000]) {
      setTimeout(() => {
        const tui = (globalThis as any)[G_TUI];
        if (tui) {
          enforceBar(tui);
          tryWrap(tui);
          wrapFooterBrand(tui, () => ctx.ui.theme);
          tui.requestRender?.();
        }
      }, ms);
    }
  });

  pi.on("session_shutdown", () => {
    if (resizeHandler) {
      try {
        process.stdout.off("resize", resizeHandler);
      } catch {
        /* noop */
      }
      resizeHandler = null;
    }
    stopPolling();
    const tui = (globalThis as any)[G_TUI];
    if (tui) {
      unwrapFooterBrand(tui);
    }
    restoreNative();
  });
}
