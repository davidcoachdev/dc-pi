import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { registerDcAudioTools } from "./tools/dc-audio-tools.ts";
import { isAudioTtsAvailable } from "./core/dc-audio-synthesizer.ts";

/**
 * Extensión dc-audio para Pi y DC Studio.
 * - Registra herramientas para síntesis de voz: dc_markdown_to_audio y dc_text_to_audio.
 * - Comando /dc-audio para comprobar disponibilidad de motores TTS (espeak-ng / piper).
 */
export default function dcAudioExtension(pi: ExtensionAPI): void {
  registerDcAudioTools(pi);

  pi.registerCommand("dc-audio", {
    description: "DC Studio: check text-to-speech audio synthesis engine status",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      const check = isAudioTtsAvailable();
      const msg = check.available
        ? `Motor TTS activo: ${check.engine} disponible para síntesis de voz`
        : "Ningún motor TTS detectado. Podés instalarlo con: brew install espeak-ng";

      if (ctx.hasUI) {
        dcNotifier.notify(ctx, "DC Audio", msg, check.available ? "info" : "warning");
      }
      dcNotifier.notifyHerdr(`DC Audio: ${msg}`);
    },
  });
}
