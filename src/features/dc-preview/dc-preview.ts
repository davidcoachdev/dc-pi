import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { openDcModal } from "../../ui/dc-modal.ts";
import {
  DC_PREVIEW_DIRECTION_LABELS,
  DC_PREVIEW_TOOL_LABELS,
  type DcPreviewLauncherOptions,
  type DcPreviewOrientation,
  type DcPreviewToolMode,
  launchPanel,
  parseOrientationArg,
  parseToolArg,
  resolveTaskManagerScript,
} from "./dc-preview-launcher.ts";
import { DcPreviewSelectPanel } from "./dc-preview-panel.ts";
import { execFileSync } from "node:child_process";

export async function openPreviewModal<T extends string>(
  ctx: ExtensionContext,
  title: string,
  items: Array<{ value: T; label: string; description?: string }>,
): Promise<T | undefined> {
  const result = await openDcModal<T>(ctx, {
    title,
    glyph: "▸",
    width: "44%",
    maxHeight: 14,
    paddingX: 1,
    frame: "double",
    footer: (theme) =>
      `${theme.fg("accent", "↑/↓ / Clic")} elegir   ${theme.fg("accent", "Enter")} abrir   ${theme.fg("accent", "Esc")} cerrar`,
    content: (done, theme, tui) =>
      new DcPreviewSelectPanel(
        items,
        theme,
        (val) => done(val as T),
        () => done(undefined),
        () => tui.requestRender(),
      ),
  });

  return result;
}

export async function showTaskManagerSetup(cwd: string, ctx: ExtensionContext): Promise<void> {
  try {
    const script = resolveTaskManagerScript();
    if (!script) {
      dcNotifier.notify(ctx, "DC Preview", "No se encontró el script de setup de task-manager.", "error");
      return;
    }
    const out = execFileSync("bash", [script, cwd], { encoding: "utf8" });
    if (out.includes("no implementado") || out.includes("Task Manager no implementado")) {
      dcNotifier.notify(ctx, "DC Preview", `⚠️ Task Manager no implementado en ${cwd}`, "warning");
      return;
    }
    dcNotifier.notify(ctx, "DC Preview", "✔ Task Manager configurado correctamente.", "info");
  } catch (e) {
    dcNotifier.notify(ctx, "DC Preview", `task-manager falló: ${String(e)}`, "error");
  }
}

export async function openPreviewDirectionMenu(
  ctx: ExtensionContext,
  mode: "nvim" | "fzf" | "yazi" | "dc-studio",
  cwd?: string,
  options?: DcPreviewLauncherOptions,
): Promise<void> {
  if (!ctx.hasUI) {
    dcNotifier.notify(ctx, "DC Preview", "dc-preview necesita modo TUI.", "error");
    return;
  }
  const targetCwd = cwd || ctx.cwd || process.cwd();
  const label = DC_PREVIEW_TOOL_LABELS[mode];

  const picked = await openPreviewModal<DcPreviewOrientation>(
    ctx,
    `⛩  Dc Studio - Preview (${label})`,
    [
      { value: "h", label: DC_PREVIEW_DIRECTION_LABELS.h },
      { value: "v", label: DC_PREVIEW_DIRECTION_LABELS.v },
    ],
  );

  if (!picked) return;
  const res = launchPanel(mode, picked, targetCwd, options);
  dcNotifier.notify(ctx, "DC Preview", res.message, res.success ? "info" : "error");
}

export const openToolPreview = openPreviewDirectionMenu;

export default function dcPreviewExtension(
  pi: ExtensionAPI,
  options?: DcPreviewLauncherOptions,
): void {
  async function showDirectionMenu(
    ctx: ExtensionContext,
    mode: "nvim" | "fzf" | "yazi" | "dc-studio",
  ): Promise<void> {
    await openPreviewDirectionMenu(ctx, mode, undefined, options);
  }

  async function showToolMenu(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      dcNotifier.notify(ctx, "DC Preview", "dc-preview necesita modo TUI.", "error");
      return;
    }
    const cwd = ctx.cwd || process.cwd();

    const choice = await openPreviewModal<DcPreviewToolMode>(
      ctx,
      "⛩  Dc Studio - Preview",
      [
        { value: "manager", label: DC_PREVIEW_TOOL_LABELS.manager },
        { value: "nvim", label: DC_PREVIEW_TOOL_LABELS.nvim },
        { value: "fzf", label: DC_PREVIEW_TOOL_LABELS.fzf },
        { value: "yazi", label: DC_PREVIEW_TOOL_LABELS.yazi },
        { value: "dc-studio", label: DC_PREVIEW_TOOL_LABELS["dc-studio"] },
      ],
    );

    if (!choice) return;

    if (choice === "manager") {
      await showTaskManagerSetup(cwd, ctx);
    } else {
      await showDirectionMenu(ctx, choice);
    }
  }

  // Comando único en inglés: /dc-preview
  pi.registerCommand("dc-preview", {
    description:
      "Open tools (task-manager, nvim, fzf, yazi, dc-studio) in a 40% split pane (right/down) in Tmux or Herdr. Usage: /dc-preview [nvim|fzf|yazi|manager|dc] [h|v]",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      const parts = (args || "").trim().split(/\s+/).filter(Boolean);
      const tool = parseToolArg(parts[0]);
      const orientation = parseOrientationArg(parts[1]);
      const cwd = ctx.cwd || process.cwd();

      if (!tool) {
        await showToolMenu(ctx);
        return;
      }

      if (tool === "manager") {
        await showTaskManagerSetup(cwd, ctx);
        return;
      }

      if (!orientation) {
        await showDirectionMenu(ctx, tool);
        return;
      }

      const res = launchPanel(tool, orientation, cwd, options);
      if (ctx.hasUI) {
        dcNotifier.notify(ctx, "DC Preview", res.message, res.success ? "info" : "error");
      }
    },
  });

  // Atajo Alt+Shift+V
  try {
    pi.registerShortcut("alt+shift+v", {
      description: "DC Studio: Open split tool preview menu (Tmux / Herdr)",
      handler: async (ctx) => {
        await showToolMenu(ctx);
      },
    });
  } catch {
    /* fallback si no está soportado */
  }
}
