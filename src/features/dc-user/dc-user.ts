import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { openDcModal } from "../../ui/dc-modal.ts";
import { DcPromptInputComponent } from "./dc-user-prompt-input.ts";
import { getUserName, saveUserName } from "./dc-user-store.ts";

export interface AskUserNameOptions {
  label?: string;
  initialValue?: string;
  filePath?: string;
}

/**
 * Abre el modal interactivo de DC Studio para ingresar o editar el nombre de usuario.
 */
export async function askUserName(
  ctx: ExtensionContext,
  options?: AskUserNameOptions,
): Promise<string> {
  const current = options?.initialValue ?? getUserName(options?.filePath);

  const res = await openDcModal<string>(ctx, {
    title: "⛩  Dc Studio - Usuario",
    glyph: "\u{1F464}",
    width: "48%",
    maxHeight: 11,
    paddingX: 1,
    frame: "double",
    content: (done, theme, tui) =>
      new DcPromptInputComponent(theme, tui, {
        label: options?.label ?? "¿Cómo te llamás? (para el chrome de tus mensajes):",
        initialValue: current,
        onSubmit: (v) => done(v.trim()),
        onCancel: () => done(""),
      }),
  });

  return typeof res === "string" ? res.trim() : "";
}

/**
 * Extensión de usuario para Pi / DC Studio.
 * - Registra /dc-usuario y /dc-user.
 * - Registra atajo Alt+N.
 * - Consulta automáticamente en session_start (con delay de 4s) si aún no está configurado.
 */
export default function dcUserExtension(pi: ExtensionAPI): void {
  let asked = false;
  let timer: NodeJS.Timeout | null = null;

  const askOnce = async (ctx: ExtensionContext) => {
    try {
      if (asked || Boolean(getUserName()) || !ctx.hasUI || ctx.mode !== "tui") return;
      asked = true;
      const name = await askUserName(ctx);
      if (name) {
        saveUserName(name);
        dcNotifier.notify(ctx, `usuario: ${name}`);
      }
    } catch {
      /* noop: ignora context stale tras un reload */
    }
  };

  pi.on("session_shutdown", () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    if (getUserName()) return;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void askOnce(ctx);
    }, 4000);
    (timer as { unref?: () => void }).unref?.();
  });

  // Si el usuario envía un mensaje antes de los 4 segundos, abrimos el prompt
  pi.on("message_start", async (event, ctx) => {
    const role = (event as { message?: { role?: string } }).message?.role;
    if (role === "user") {
      void askOnce(ctx);
    }
  });

  const handleUserCommand = async (args: string | undefined, ctx: ExtensionContext) => {
    const arg = (args ?? "").trim();
    const name = arg || (await askUserName(ctx));
    if (name) {
      saveUserName(name);
      dcNotifier.notify(ctx, `usuario: ${name}`);
    }
  };

  pi.registerCommand("dc-user", {
    description: "View or edit your username for DC Studio chrome",
    handler: handleUserCommand,
  });

  pi.registerShortcut("alt+n", {
    description: "DC Studio: ver o cambiar tu nombre de usuario",
    handler: async (ctx) => {
      const name = await askUserName(ctx);
      if (name) {
        saveUserName(name);
        dcNotifier.notify(ctx, `usuario: ${name}`);
      }
    },
  });
}
