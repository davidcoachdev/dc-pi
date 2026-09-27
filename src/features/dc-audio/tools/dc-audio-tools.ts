import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { markdownToSpokenText } from "../core/dc-audio-cleaner.ts";
import { synthesizeAudio } from "../core/dc-audio-synthesizer.ts";
import type { AudioTtsEngine } from "../core/dc-audio-types.ts";

export function registerDcAudioTools(pi: ExtensionAPI): void {
  // 1. Tool Markdown to Audio
  pi.registerTool({
    name: "dc_markdown_to_audio",
    label: "DC Markdown to Audio Briefing",
    description: "Convierte un archivo Markdown local (ej: report.md de investigación o noticias) en un resumen hablado de audio en formato .wav sin tablas ni código crudo.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ruta del archivo Markdown local a convertir" },
        outputPath: { type: "string", description: "Ruta opcional donde guardar el archivo .wav generado" },
        language: { type: "string", description: "Código de idioma para la voz (ej: 'es', 'en', 'es-la'). Default: 'es'" },
        speed: { type: "number", description: "Velocidad de habla en palabras por minuto (default: 160)" },
      },
      required: ["path"],
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const cwd = ctx?.cwd ?? process.cwd();
        const resolvedPath = path.isAbsolute(params.path) ? params.path : path.resolve(cwd, params.path);

        if (!fs.existsSync(resolvedPath)) {
          throw new Error(`Archivo no encontrado: ${resolvedPath}`);
        }

        const rawMarkdown = fs.readFileSync(resolvedPath, "utf8");
        const spokenText = markdownToSpokenText(rawMarkdown);

        if (!spokenText) {
          throw new Error("El archivo Markdown no contiene texto narrativo convertible a audio.");
        }

        const res = await synthesizeAudio({
          text: spokenText,
          outputPath: params.outputPath,
          language: params.language,
          speed: params.speed,
          cwd,
        });

        return {
          content: [{
            type: "text",
            text: `### Resumen de Audio Generado (.wav)\n- Archivo generado: \`${res.outputPath}\`\n- Tamaño: ${Math.round(res.byteSize / 1024)} KB\n- Duración estimada: ~${res.durationEstimateSeconds} segundos\n- Idioma: ${res.language.toUpperCase()} (${res.engineUsed})\n- Caracteres hablados: ${res.textCharCount}`,
          }],
          details: res,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error al convertir Markdown a audio: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 2. Tool Text to Audio
  pi.registerTool({
    name: "dc_text_to_audio",
    label: "DC Text to Audio Speech",
    description: "Sintetiza un texto o mensaje directo a un archivo de audio .wav utilizando el motor de síntesis local.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Texto a sintetizar en voz" },
        outputPath: { type: "string", description: "Ruta opcional para guardar el archivo .wav" },
        language: { type: "string", description: "Idioma de voz (default: 'es')" },
        speed: { type: "number", description: "Velocidad de habla en palabras por minuto (default: 160)" },
      },
      required: ["text"],
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const cwd = ctx?.cwd ?? process.cwd();
        const res = await synthesizeAudio({
          text: params.text,
          outputPath: params.outputPath,
          language: params.language,
          speed: params.speed,
          cwd,
        });

        return {
          content: [{
            type: "text",
            text: `Audio generado con éxito en \`${res.outputPath}\` (~${res.durationEstimateSeconds}s, ${Math.round(res.byteSize / 1024)} KB)`,
          }],
          details: res,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error al sintetizar texto a audio: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });
}
