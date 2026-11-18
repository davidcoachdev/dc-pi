import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { openDcModal } from "../../ui/dc-modal.ts";
import { getGitChanges, getFileDiff, listGitWorktrees } from "../../integrations/dc-git/dc-git.ts";
import { DcChangesPanel } from "./dc-changes-panel.ts";

export function parseEditorCommand(rawEditor?: string): { command: string; args: string[] } {
  const input = (rawEditor ?? process.env.VISUAL ?? process.env.EDITOR ?? "nano").trim();
  if (!input) {
    return { command: "nano", args: [] };
  }

  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === "\\" && quote === '"' && i + 1 < input.length) {
        current += input[++i]!;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  const [command = "nano", ...args] = tokens;
  return { command, args };
}

/**
 * Open the DC Studio Git Changes & Diff Viewer in a two-panel modal with multi-worktree support.
 */
export async function openChangesViewer(ctx: ExtensionContext): Promise<void> {
  const cwd = ctx.cwd ?? process.cwd();
  const worktrees = listGitWorktrees(cwd);
  const multiWt = worktrees.length > 1;

  const footerLeft = multiWt
    ? ` [w] Worktree   [↑/↓] Archivo   [PgUp/Dn] Scroll diff   [r] Refrescar`
    : ` [↑/↓] Archivo   [PgUp/Dn/Rueda] Scroll diff   [r] Refrescar`;

  let panelRef: DcChangesPanel | undefined;

  await openDcModal<void>(ctx, {
    title: "Dc Studio - Cambios",
    glyph: "⛩ ",
    frame: "double",
    paddingX: 0,
    width: "86%",
    maxHeight: "86%",
    footer: (theme) => ({
      left: footerLeft,
      right: `[Enter Editar] `,
    }),
    onFooterRightClick: () => {
      panelRef?.openCurrentSelected();
    },
    onReload: () => {
      panelRef?.refresh();
    },
    content: (_done, theme, tui) => {
      panelRef = new DcChangesPanel({
        cwd,
        theme,
        getChanges: getGitChanges,
        getDiff: getFileDiff,
        listWorktreesFn: listGitWorktrees,
        onOpenEditor: (file, worktreePath) => {
          const rawEditor = process.env.VISUAL || process.env.EDITOR || "nano";
          const { command, args } = parseEditorCommand(rawEditor);
          const baseDir = worktreePath || cwd;
          const fullPath = path.resolve(baseDir, file);
          try {
            const child = spawn(command, [...args, fullPath], { stdio: "inherit" });
            child.on("error", (err) => {
              dcNotifier.notify(ctx, "DC Cambios", `No se pudo abrir el editor (${command}): ${err.message}`, "error");
            });
            child.on("exit", () => {
              tui.requestRender();
            });
          } catch {
            dcNotifier.notify(ctx, "DC Cambios", `No se pudo abrir el editor: ${command}`, "error");
          }
        },
        requestRender: () => tui.requestRender(),
      });
      return panelRef;
    },
  });
}

export default function dcChangesExtension(pi: ExtensionAPI): void {
  async function showChanges(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      dcNotifier.notify(ctx, "DC Cambios", "dc-changes necesita TUI (no hay UI en este modo).", "error");
      return;
    }
    await openChangesViewer(ctx);
  }

  pi.registerCommand("dc-changes", {
    description: "Visor interactivo de cambios Git y diffs en dos paneles con soporte de Worktrees",
    handler: async (_args, ctx) => {
      await showChanges(ctx);
    },
  });

  try {
    pi.registerShortcut("alt+shift+f" as never, {
      description: "Visor de cambios Git (DC Studio)",
      handler: async (ctx) => {
        await showChanges(ctx);
      },
    });
  } catch {
    // Graceful fallback
  }
}
