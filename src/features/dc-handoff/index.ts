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

export interface HandoffTurn {
  role: "user" | "assistant";
  text: string;
}

function extractMessageText(content: unknown, fallbackText?: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (item && typeof item === "object") {
        const block = item as { type?: string; text?: string };
        if ((!block.type || block.type === "text") && typeof block.text === "string") {
          parts.push(block.text);
        }
      }
    }
    const joined = parts.join("\n").trim();
    if (joined) return joined;
  }
  if (typeof fallbackText === "string") {
    return fallbackText.trim();
  }
  return "";
}

export function extractConversationTail(
  ctx: ExtensionContext,
  explicitEntries?: unknown[],
  maxTurns = 6,
  maxCharsPerTurn = 400,
): HandoffTurn[] {
  const sm = ctx?.sessionManager as unknown as {
    getBranch?: () => unknown[];
    getEntries?: () => unknown[];
    getMessages?: () => unknown[];
  } | undefined;

  const rawEntries =
    explicitEntries ??
    sm?.getBranch?.() ??
    sm?.getEntries?.() ??
    sm?.getMessages?.() ??
    [];

  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    return [];
  }

  const turns: HandoffTurn[] = [];
  for (const raw of rawEntries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as {
      type?: string;
      role?: string;
      content?: unknown;
      text?: unknown;
      message?: { role?: string; content?: unknown; text?: unknown };
    };
    const msg = entry.message && typeof entry.message === "object" ? entry.message : entry;
    const role = msg.role;
    if (role !== "user" && role !== "assistant") continue;

    const fullText = extractMessageText(msg.content, msg.text).replace(/\s+/g, " ").trim();
    if (!fullText) continue;

    const clipped =
      fullText.length > maxCharsPerTurn
        ? `${fullText.slice(0, maxCharsPerTurn)}...`
        : fullText;
    turns.push({ role, text: clipped });
  }

  return turns.slice(-maxTurns);
}

export function writeHandoffNote(ctx: ExtensionContext, explicitEntries?: unknown[]): string | null {
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
    );
    if (sessionId) {
      lines.push(`- **Session ID:** \`${sessionId}\``);
    }
    if (sessionFile) {
      lines.push(`- **Session File:** \`${sessionFile}\``);
    }

    const tail = extractConversationTail(ctx, explicitEntries);
    if (tail.length > 0) {
      lines.push("", "## Conversación Reciente", "");
      for (const turn of tail) {
        const label = turn.role === "user" ? "Usuario" : "Asistente";
        lines.push(`- **${label}:** ${turn.text}`);
      }
    }

    lines.push("");
    writeFileSync(handoffPath, lines.join("\n"), "utf8");
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
