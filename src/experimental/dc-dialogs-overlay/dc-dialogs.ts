import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { setActiveContext } from "./dc-dialogs-helpers.ts";
import {
  installDialogsPatch,
  isDialogsEnabled,
  setDialogsEnabled,
} from "./dc-dialogs-patch.ts";

/**
 * DC Dialogs Overlay — Applies DcWindow chrome to Pi modals and popups.
 *
 * Canonical command:
 *   /dc-dialogs [on|off|status]
 */
export default function dcDialogsExtension(pi: ExtensionAPI, ctx?: ExtensionContext): void {
  if (ctx) {
    setActiveContext(ctx);
  }

  try {
    pi.on("session_start", async (_event, sessionCtx) => {
      setActiveContext(sessionCtx);
    });
  } catch {
    /* ignore session_start subscription error in mock/test environments */
  }

  if (isDialogsEnabled()) {
    installDialogsPatch();
  }

  pi.registerCommand("dc-dialogs", {
    description: "Toggle or check DC Dialogs overlay: /dc-dialogs [on|off|status]",
    handler: async (args: string | undefined, commandCtx: ExtensionContext) => {
      const sub = (args ?? "").trim().toLowerCase();

      if (sub === "on" || sub === "enable") {
        setDialogsEnabled(true);
        installDialogsPatch();
        if (commandCtx.hasUI) {
          dcNotifier.notify(commandCtx, "DC Dialogs overlay: enabled.", "info");
        }
        return;
      }

      if (sub === "off" || sub === "disable") {
        setDialogsEnabled(false);
        if (commandCtx.hasUI) {
          dcNotifier.notify(commandCtx, "DC Dialogs overlay: disabled.", "info");
        }
        return;
      }

      const status = isDialogsEnabled() ? "enabled" : "disabled";
      if (commandCtx.hasUI) {
        dcNotifier.notify(commandCtx, `DC Dialogs overlay: ${status}.`, "info");
      }
    },
  });
}

export { dcDialogsExtension };
