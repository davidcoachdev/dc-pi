/**
 * dc-handoff — Conversation resume & handoff note on shutdown.
 *
 * Leaves a project-local handoff note under .pi/handoff.md when quitting Pi,
 * with the exact restore command and recent conversation tail.
 * Automatically ensures .pi/.gitignore protects the directory from Git leaks.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";

export function ensurePiDirProtected(cwd: string): string {
  const dir = join(cwd, ".pi");
  mkdirSync(dir, { recursive: true });
  const gitignore = join(dir, ".gitignore");
  if (!existsSync(gitignore)) {
    writeFileSync(gitignore, "*\n!.gitignore\n", "utf8");
  }
  return dir;
}

export function writeHandoffNote(ctx: ExtensionContext): string | null {
  try {
    const cwd = ctx.cwd || process.cwd();
    const piDir = ensurePiDirProtected(cwd);
    const handoffPath = join(piDir, "handoff.md");

    const now = new Date().toISOString();
    const sessionManager = ctx.sessionManager;
    const sessionFile = sessionManager?.getSessionFile?.();
    const sessionId = sessionManager?.getSessionId?.();

    const isWin = process.platform === "win32";
    const shellLang = isWin ? "powershell" : "bash";

    const lines: string[] = [
      "# DC Studio — Handoff Note",
      "",
      "> Archivo local autogenerado para retomar la sesión. No commitear.",
      "",
      "## Comando para Restaurar Sesión",
      "",
      `\`\`\`${shellLang}`,
    ];

    if (sessionFile) {
      lines.push(`pi --session "${sessionFile}"`);
    } else if (sessionId) {
      lines.push(`pi --session ${sessionId}`);
    } else {
      lines.push("pi --resume");
    }

    lines.push(
      "```",
      "",
      "## Metadatos",
      "",
      `- **Actualizado:** ${now}`,
      `- **CWD:** \`${cwd}\``,
      sessionId ? `- **Session ID:** \`${sessionId}\`` : "",
      sessionFile ? `- **Session File:** \`${sessionFile}\`` : "",
      "",
    );

    writeFileSync(handoffPath, lines.filter(Boolean).join("\n"), "utf8");
    return handoffPath;
  } catch {
    return null;
  }
}

export function dcHandoffExtension(pi: ExtensionAPI): void {
  // Register manual command to create a handoff snapshot anytime
  pi.registerCommand("dc-handoff", {
    description: "Genera una nota local de handoff en .pi/handoff.md con el comando exacto para reanudar",
    handler: async (_args: string, ctx: ExtensionContext) => {
      const path = writeHandoffNote(ctx);
      if (path) {
        dcNotifier.notify(ctx, "Handoff", `Nota de handoff guardada en ${path}`, "info");
      } else {
        dcNotifier.notify(ctx, "Handoff", "No se pudo generar la nota de handoff", "error");
      }
    },
  });

  // Automatically write on session quit / exit
  try {
    if (typeof pi.on === "function") {
      pi.on("session_shutdown", (_event, ctx) => {
        writeHandoffNote(ctx as ExtensionContext);
      });
    }
  } catch {
    // Best-effort hook
  }
}

export default dcHandoffExtension;
