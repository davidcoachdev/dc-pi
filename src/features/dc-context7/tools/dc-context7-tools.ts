import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dcContext7Client } from "../core/dc-context7-client.ts";

export function registerDcContext7Tools(pi: ExtensionAPI): void {
  // 1. Status tool
  pi.registerTool({
    name: "dc_context7_status",
    label: "DC Context7 Status",
    description: "Comprueba si Context7 está configurado con su API key (CONTEXT7_API_KEY) para consultar documentación oficial de librerías.",
    parameters: {
      type: "object",
      properties: {},
    } as any,
    async execute(): Promise<any> {
      const status = dcContext7Client.getStatus();
      return {
        content: [{
          type: "text",
          text: status.configured
            ? "Context7 está activo y listo para consultar documentación oficial."
            : "Context7 no está configurado. Para activarlo, definí CONTEXT7_API_KEY en tu entorno.",
        }],
        details: status,
      };
    },
  });

  // 2. Search library tool
  pi.registerTool({
    name: "dc_context7_search",
    label: "DC Context7 Search Library",
    description: "Busca librerías y frameworks indexados en Context7 por nombre humano (ej: 'zod', 'hono', 'tailwind', 'express') para obtener su libraryId oficial.",
    parameters: {
      type: "object",
      properties: {
        libraryName: { type: "string", description: "Nombre de la librería o paquete (ej: 'tailwind', 'zod')" },
        query: { type: "string", description: "Tema o contexto de uso para afinar la búsqueda (ej: 'validation', 'routing')" },
        limit: { type: "number", description: "Máximo de librerías candidatas a retornar (default: 5)" },
      },
      required: ["libraryName"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const query = params.query ?? params.libraryName;
        const candidates = await dcContext7Client.searchLibrary(query, params.libraryName, params.limit ?? 5);

        if (candidates.length === 0) {
          return {
            content: [{ type: "text", text: `No se encontraron librerías en Context7 para: "${params.libraryName}"` }],
            details: { count: 0, candidates: [] },
          };
        }

        const formatted = candidates.map((c, i) =>
          `### [${i + 1}] ${c.name} (\`libraryId: ${c.id}\`)\n${c.description ? `- Descripción: ${c.description}\n` : ""}${c.totalSnippets ? `- Snippets oficiales: ${c.totalSnippets}\n` : ""}${c.versions ? `- Versiones: ${c.versions.join(", ")}\n` : ""}`
        ).join("\n");

        return {
          content: [{
            type: "text",
            text: `Librerías encontradas en Context7:\n\n${formatted}\n\n*Usa dc_context7_get_context con el libraryId para traer documentación oficial.*`,
          }],
          details: { count: candidates.length, candidates },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_context7_search: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 3. Get context / documentation tool
  pi.registerTool({
    name: "dc_context7_get_context",
    label: "DC Context7 Get Context",
    description: "Obtiene documentación oficial actualizada, guías de migración y ejemplos de código reales de una librería mediante su libraryId de Context7.",
    parameters: {
      type: "object",
      properties: {
        libraryId: { type: "string", description: "ID de la librería devuelto por dc_context7_search (ej: '/libraries/zod', '/libraries/hono')" },
        query: { type: "string", description: "Pregunta o tema específico de la librería (ej: 'schema transforms', 'middleware auth', 'streaming')" },
      },
      required: ["libraryId", "query"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const doc = await dcContext7Client.getContext(params.query, params.libraryId);

        if (doc.snippets.length === 0) {
          return {
            content: [{ type: "text", text: `No se encontraron snippets de documentación en ${params.libraryId} para la consulta: "${params.query}"` }],
            details: doc,
          };
        }

        const formattedSnippets = doc.snippets.map((s, i) =>
          `#### Snippet [${i + 1}] ${s.title ? `: ${s.title}` : ""}\n${s.sourceUrl ? `Fuente: ${s.sourceUrl}\n` : ""}\n\`\`\`\n${s.content}\n\`\`\``
        ).join("\n\n---\n\n");

        const warn = doc.truncated ? "\n\n⚠️ Documentación acotada para respetar la ventana de contexto." : "";

        return {
          content: [{
            type: "text",
            text: `Documentación oficial de ${doc.libraryId} para "${doc.query}" (${doc.byteSize} bytes):\n\n${formattedSnippets}${warn}`,
          }],
          details: doc,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_context7_get_context: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });
}
