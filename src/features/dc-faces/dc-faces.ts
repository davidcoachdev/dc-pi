import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { openDcModal } from "../../ui/dc-modal.ts";
import { ProfileDuel, type ProfileId } from "./dc-profile-duel.ts";

/**
 * Open the DC Studio Profile Duel modal (dcdev vs cubis) using DcWindow.
 * Returns the selected ProfileId or undefined if dismissed.
 */
export async function openProfilePicker(
  ctx: ExtensionContext,
  current: ProfileId = "dcdev",
): Promise<ProfileId | undefined> {
  let duelRef: ProfileDuel | undefined;

  return openDcModal<ProfileId>(ctx, {
    title: "Dc Studio - Perfil",
    glyph: "⛩ ",
    frame: "double",
    width: 60,
    maxHeight: 24,
    footer: (theme) => ({
      left: `  ${theme.fg("accent", "←→")} ${theme.fg("dim", "elegir")}   ${theme.fg("accent", "enter")} ${theme.fg("dim", "usar")}   ${theme.fg("accent", "esc")} ${theme.fg("dim", "cerrar")}`,
      right: `${theme.fg("accent", "[ Usar ]")}  `,
    }),
    onFooterRightClick: () => {
      duelRef?.pickCurrent();
    },
    content: (done, theme, tui) => {
      const duel = new ProfileDuel(theme, current);
      duelRef = duel;
      duel.onPick = (p) => done(p);
      duel.onCancel = () => done(undefined);
      return duel;
    },
  });
}

export default function profileDuelExtension(pi: ExtensionAPI): void {
  let activeProfile: ProfileId = "dcdev";

  async function showDuel(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      dcNotifier.notify(ctx, "perfil necesita TUI (no hay UI en este modo).", "error");
      return;
    }
    const picked = await openProfilePicker(ctx, activeProfile);
    if (!picked) return;
    activeProfile = picked;
    dcNotifier.notify(ctx, `✔ Perfil activo: ${picked}`, "info");
  }

  pi.registerCommand("dc-faces", {
    description: "Carita: duelo dcdev vs cubis, elegí perfil con flechas o mouse",
    handler: async (_args, ctx) => {
      await showDuel(ctx);
    },
  });

  try {
    pi.registerShortcut("alt+c" as never, {
      description: "Carita: duelo dcdev vs cubis (DC Studio)",
      handler: async (ctx) => {
        await showDuel(ctx);
      },
    });
  } catch {
    // Graceful fallback if runtime does not support registerShortcut
  }
}
