import { InteractiveMode, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../integrations/dc-notify/dc-notifier.ts";

export const G_INTERACTIVE = Symbol.for("dc.interactive-mode");
const INTERCEPTED = Symbol.for("dc.command-executor.intercepted");

// Capturar de forma limpia la instancia activa de InteractiveMode
try {
  const proto = (InteractiveMode as any)?.prototype;
  if (proto && !proto[INTERCEPTED]) {
    proto[INTERCEPTED] = true;

    const origSetWidget = proto.setExtensionWidget;
    if (typeof origSetWidget === "function") {
      proto.setExtensionWidget = function (key: string, content: any, options: any) {
        (globalThis as any)[G_INTERACTIVE] = this;
        return origSetWidget.call(this, key, content, options);
      };
    }

    const origSetupShortcuts = proto.setupExtensionShortcuts;
    if (typeof origSetupShortcuts === "function") {
      proto.setupExtensionShortcuts = function (runner: any) {
        (globalThis as any)[G_INTERACTIVE] = this;
        return origSetupShortcuts.call(this, runner);
      };
    }
  }
} catch {
  /* noop */
}

/**
 * Ejecuta un comando slash de Pi (/mcp, /gentle:agents, /gentle:profiles, etc.)
 * utilizando el mecanismo oficial de prompt del AgentSession o el handler de comando registrado.
 */
export async function executeSlashCommand(
  ctx: ExtensionContext | undefined,
  commandWithSlash: string,
  title: string,
): Promise<boolean> {
  const cleanCmd = commandWithSlash.trim();
  const cmdName = cleanCmd.startsWith("/") ? cleanCmd.slice(1).split(/\s+/)[0]! : cleanCmd.split(/\s+/)[0]!;
  const cmdArgs = cleanCmd.includes(" ") ? cleanCmd.slice(cleanCmd.indexOf(" ") + 1) : "";

  // 1. Intentar mediante la sesión activa de Pi (session.prompt("/command"))
  try {
    const im = (globalThis as any)[G_INTERACTIVE];
    const session = im?.session || (ctx as any)?.session;
    if (session && typeof session.prompt === "function") {
      await session.prompt(cleanCmd.startsWith("/") ? cleanCmd : `/${cleanCmd}`);
      return true;
    }
  } catch (e: any) {
    if (ctx) {
      dcNotifier.notify(ctx, title, `Error al ejecutar ${commandWithSlash}: ${e?.message ?? e}`, "error");
    }
    return false;
  }

  // 2. Intentar buscando el comando en el extensionRunner activo
  try {
    const im = (globalThis as any)[G_INTERACTIVE];
    const runner = im?.session?.extensionRunner || (ctx as any)?.session?.extensionRunner || (ctx as any)?.extensionRunner;
    if (runner) {
      const command = runner.getCommand?.(cmdName) || runner.getCommands?.()?.get?.(cmdName);
      if (command && typeof command.handler === "function") {
        const cmdCtx = runner.createCommandContext ? runner.createCommandContext() : ctx;
        await command.handler(cmdArgs, cmdCtx);
        return true;
      }
    }
  } catch (e: any) {
    if (ctx) {
      dcNotifier.notify(ctx, title, `Error al ejecutar ${commandWithSlash}: ${e?.message ?? e}`, "error");
    }
    return false;
  }

  // 3. Si no se pudo ejecutar, notificar claramente el error
  if (ctx) {
    dcNotifier.notify(
      ctx,
      title,
      `No se pudo abrir ${commandWithSlash}. El comando no está disponible en esta sesión.`,
      "error",
    );
  }
  return false;
}
