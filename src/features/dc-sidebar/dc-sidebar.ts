
export const G_CTX = Symbol.for("dc.sidebar.ctx");
export function getSidebarContext(): ExtensionContext | undefined {
  return (globalThis as any)[G_CTX];
}
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { DcTabItem } from "../../ui/dc-tabs.ts";
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
import { wrapFooterBrand, unwrapFooterBrand, wrapDockWidgetsAbove, unwrapDockWidgetsAbove } from "./bottom-bar/index.ts";
import { patchExtensionWidgets, wrapMountedWidgets } from "./runtime/dc-sidebar-widgets.ts";
import { SIDEBAR_TABS, type DcSidebarTabs } from "./views/dc-sidebar-tabs.ts";
import { getSidebarTabs } from "./views/dc-sidebar-frame.ts";
import { getSidebarPagedBody } from "./views/dc-sidebar-body.ts";

export const ANCHOR_KEY = "dc-sidebar-anchor";
const G_TUI = Symbol.for("dc.sidebar.tui-ref");

/**
 * Localiza la pestaña correspondiente por número ordinal (1-9), key, ID o label.
 * Admite pestañas dinámicas adicionales si se agregan más allá de las 5 iniciales.
 */
export function findSidebarTab(
  tabIdentifier: number | string,
  tabsInstance?: DcSidebarTabs,
): DcTabItem | undefined {
  const tabs = tabsInstance ? tabsInstance.getTabs() : SIDEBAR_TABS;
  if (typeof tabIdentifier === "number" || /^[1-9]$/.test(String(tabIdentifier).trim())) {
    const num = typeof tabIdentifier === "number" ? tabIdentifier : parseInt(String(tabIdentifier).trim(), 10);
    return tabs.find((t, idx) => t.key === String(num) || idx === num - 1);
  }
  const query = String(tabIdentifier).trim().toLowerCase();
  return tabs.find((t) => t.id.toLowerCase() === query || t.label.toLowerCase() === query);
}

/**
 * Navega directamente a una pestaña del sidebar, abriéndolo si estaba oculto.
 * Válido para atajos Alt+1..9 y comando /dc-sidebar <1-9>.
 */
export function switchSidebarTab(
  tabIdentifier: number | string,
  ctx?: ExtensionContext,
  tuiOverride?: any,
): { success: boolean; tab?: DcTabItem; reason?: string } {
  const tui = tuiOverride ?? (globalThis as any)[G_TUI];
  const tabs = tui ? getSidebarTabs(tui) : undefined;
  const targetTab = findSidebarTab(tabIdentifier, tabs);

  if (!targetTab) {
    const displayNum = typeof tabIdentifier === "number" ? tabIdentifier : tabIdentifier;
    if (ctx) {
      dcNotifier.notify(ctx, `DC Sidebar: pestaña [${displayNum}] no disponible`, "warning");
    }
    return { success: false, reason: "tab_not_found" };
  }

  const currentPrefs = readSidebarPrefs();
  const cols = getTerminalColumns(tui);
  const breakpoint = getSidebarBreakpoint();

  const wasHidden = currentPrefs.hidden;
  if (wasHidden) {
    if (cols > 0 && cols < breakpoint) {
      if (ctx) {
        dcNotifier.notify(
          ctx,
          `Ancho insuficiente: (actual: ${cols}) < ${breakpoint}.`,
          "warning",
        );
      }
      return { success: false, reason: "insufficient_width" };
    }
    writeSidebarPrefs({ hidden: false, activeTab: targetTab.id });
  } else {
    writeSidebarPrefs({ activeTab: targetTab.id });
  }

  if (tabs) {
    tabs.setActiveTab(targetTab.id);
  }
  const pagedBody = getSidebarPagedBody();
  pagedBody?.setTab(targetTab.id);

  if (tui) {
    enforceBar(tui);
    tryWrap(tui);
    const themeFn = ctx?.ui?.theme ? () => ctx.ui.theme : (globalThis as any)[Symbol.for("dc.sidebar.theme-fn")];
    if (themeFn) {
      wrapFooterBrand(tui, themeFn);
    }
    wrapDockWidgetsAbove(tui);
    invalidateLayout(tui);
    tui.requestRender?.();
  }

  const allTabs = tabs ? tabs.getTabs() : SIDEBAR_TABS;
  const tabIndex = allTabs.findIndex((t) => t.id === targetTab.id);
  const keyDisplay = targetTab.key ?? (tabIndex >= 0 ? `${tabIndex + 1}` : "");

  if (ctx) {
    const statusPrefix = wasHidden ? "DC Sidebar visible: " : "DC Sidebar: ";
    dcNotifier.notify(ctx, `${statusPrefix}[${keyDisplay ? `${keyDisplay} ` : ""}${targetTab.label}]`, "info");
  }

  return { success: true, tab: targetTab };
}

export default function dcSidebarExtension(pi: ExtensionAPI): void {
  // 1. Comando unificado /dc-sidebar
  pi.registerCommand("dc-sidebar", {
    description: "Alternar o configurar la barra lateral de DC Studio (/dc-sidebar [hide|show|1-9|tab <1-9>|minwidth <cols>])",
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
      } else if (/^(?:tab\s+)?([1-9])$/.test(sub)) {
        const match = sub.match(/^(?:tab\s+)?([1-9])$/)!;
        const tabNum = parseInt(match[1]!, 10);
        switchSidebarTab(tabNum, ctx);
        return;
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
          wrapDockWidgetsAbove(tui);
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
          wrapDockWidgetsAbove(tui);
          invalidateLayout(tui);
          tui.requestRender?.();
        }
      }
    },
  });

  // 3. Atajos dinámicos Alt+1 a Alt+9 para ir directo a pestañas del sidebar
  for (let i = 1; i <= 9; i++) {
    pi.registerShortcut(`alt+${i}` as never, {
      description: `Ir directamente a la pestaña [${i}] del sidebar DC Studio`,
      handler: async (ctx: ExtensionContext) => {
        switchSidebarTab(i, ctx);
      },
    });
  }

  let resizeHandler: (() => void) | null = null;

  // 3. Captura del host y montaje del rail
  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    (globalThis as any)[Symbol.for("dc.sidebar.theme-fn")] = () => ctx.ui.theme;
    (globalThis as any)[G_CTX] = ctx;
    (globalThis as any)[Symbol.for("dc.sidebar.pi")] = pi;

    // Instalar intercepción inteligente de widgets de extensión (para dock aboveEditor cuando sidebar está oculto)
    patchExtensionWidgets();

    // Escuchar eventos de RDD de Gentle-Pi para mantener sincronizada la tarjeta de status
    try {
      pi.events?.on?.("gentle-ai:review-sidebar", (payload: any) => {
        (globalThis as any)[Symbol.for("gentle-ai.review-sidebar.snapshot")] = payload;
        const tui = (globalThis as any)[G_TUI];
        if (tui) {
          invalidateLayout(tui);
          tui.requestRender?.();
        }
      });
    } catch {
      /* noop */
    }

    const onResize = () => {
      const tui = (globalThis as any)[G_TUI];
      if (tui) {
        enforceBar(tui);
        tryWrap(tui);
        wrapFooterBrand(tui, () => ctx.ui.theme);
        wrapDockWidgetsAbove(tui);
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
          wrapDockWidgetsAbove(tui);
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
        wrapDockWidgetsAbove(tui);
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
          wrapDockWidgetsAbove(tui);
          wrapMountedWidgets();
          tui.requestRender?.();
        }
      }, ms);
    }
  });

  pi.on("session_shutdown", () => {
    (globalThis as any)[G_CTX] = undefined;
    (globalThis as any)[Symbol.for("dc.sidebar.pi")] = undefined;
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
      unwrapDockWidgetsAbove(tui);
    }
    restoreNative();
  });
}
