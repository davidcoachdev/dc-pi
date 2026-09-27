import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { registerDcYoutubeTools } from "./tools/dc-youtube-tools.ts";
import { isYtDlpAvailable } from "./core/dc-youtube-client.ts";

/**
 * Extensión dc-youtube para Pi y DC Studio.
 * - Registra herramientas completas de investigación en YouTube:
 *   dc_youtube_search, dc_youtube_video_get, dc_youtube_transcript_get, dc_youtube_channel_search.
 * - Comando /dc-youtube para comprobar estado de yt-dlp y conectividad.
 */
export default function dcYoutubeExtension(pi: ExtensionAPI): void {
  registerDcYoutubeTools(pi);

  pi.registerCommand("dc-youtube", {
    description: "DC Studio: check YouTube research engine and yt-dlp status",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      const ready = isYtDlpAvailable();
      const msg = ready
        ? "yt-dlp detectado y listo para búsqueda de videos y extracción de transcripciones"
        : "yt-dlp no detectado en PATH. Instalalo con: brew install yt-dlp";

      if (ctx.hasUI) {
        dcNotifier.notify(ctx, "DC YouTube", msg, ready ? "info" : "warning");
      }
      dcNotifier.notifyHerdr(`DC YouTube: ${msg}`);
    },
  });
}
