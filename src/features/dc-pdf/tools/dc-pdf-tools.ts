import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { extractPdf } from "../core/dc-pdf-extractor.ts";

export function registerDcPdfTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "dc_pdf_extract",
    label: "DC PDF Extract",
    description: "Extrae texto limpio, metadatos (páginas, autor), hash SHA-256 e información estructural de un archivo PDF local. Protege la ventana de contexto limitando los caracteres retornados.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Ruta del archivo PDF local (relativa al workspace o absoluta)" },
        textCharsLimit: { type: "number", description: "Límite máximo de caracteres de texto a retornar (default: 50000)" },
      },
      required: ["path"],
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const result = await extractPdf({
          path: params.path,
          textCharsLimit: params.textCharsLimit,
          cwd: ctx?.cwd ?? process.cwd(),
        });

        const warning = result.truncated
          ? `\n\n⚠️ Texto truncado a ${params.textCharsLimit ?? 50000} caracteres para proteger el context window (longitud total original: ${result.textCharsCount} caracteres).`
          : "";

        const summary = [
          `Archivo: ${result.path}`,
          `Páginas: ${result.metadata.pagesCount}`,
          `Tamaño: ${result.byteSize} bytes`,
          `SHA-256: ${result.sha256.slice(0, 16)}...`,
          result.metadata.title ? `Título: ${result.metadata.title}` : "",
          result.metadata.author ? `Autor: ${result.metadata.author}` : "",
        ].filter(Boolean).join("  ·  ");

        return {
          content: [{
            type: "text",
            text: `### Resumen de PDF (${summary})\n\n---\n\n${result.text}${warning}`,
          }],
          details: result,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error al extraer PDF: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });
}
