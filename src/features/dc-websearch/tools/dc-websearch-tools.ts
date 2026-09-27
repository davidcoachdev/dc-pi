import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { executeWebFetch, executeWebSearch } from "../providers/web/dc-web-provider.ts";
import { getStackOverflowAnswers, searchHackerNews, searchStackOverflow } from "../providers/discussions/dc-discussions-provider.ts";
import { getGitHubFile, searchGitHubCode } from "../providers/github/dc-github-provider.ts";
import { searchArxivPapers, searchOpenAlexPapers } from "../providers/research/dc-research-provider.ts";

export function registerDcWebsearchTools(pi: ExtensionAPI): void {
  // 1. Web Search
  pi.registerTool({
    name: "dc_web_search",
    label: "DC Web Search",
    description: "Búsqueda web avanzada para desarrollo técnico usando Exa con fallback a Parallel. Úsala para buscar documentación de librerías, errores, blogs y noticias recientes.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Consulta de búsqueda técnica" },
        limit: { type: "number", description: "Cantidad de resultados (1-20, default: 8)" },
        includeDomains: { type: "array", items: { type: "string" }, description: "Dominios a incluir (ej: ['docs.rs', 'github.com'])" },
        mode: { type: "string", enum: ["fast", "auto", "deep"], description: "Modo de búsqueda" },
      },
      required: ["query"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const res = await executeWebSearch({
          query: params.query,
          limit: params.limit,
          includeDomains: params.includeDomains,
          mode: params.mode,
        });

        if (res.results.length === 0) {
          return {
            content: [{ type: "text", text: `No se encontraron resultados web para: "${params.query}"` }],
            details: res,
          };
        }

        const formatted = res.results.map((r, i) =>
          `### [${i + 1}] ${r.title}\n- URL: ${r.url}\n${r.snippet ? `- Resumen: ${r.snippet}\n` : ""}`
        ).join("\n");

        return {
          content: [{
            type: "text",
            text: `Resultados web (${res.provider}) para "${params.query}":\n\n${formatted}`,
          }],
          details: res,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_web_search: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 2. Web Fetch
  pi.registerTool({
    name: "dc_web_fetch",
    label: "DC Web Fetch",
    description: "Descarga y convierte una página web HTTPS a texto limpio y legible (Markdown) con protección contra SSRF y límite de 2MB. Úsala para leer documentación o artículos completos.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL HTTPS pública a consultar" },
      },
      required: ["url"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const res = await executeWebFetch(params.url);
        const warning = res.truncated ? `\n\n⚠️ Contenido truncado a 2MB para proteger la ventana de contexto.` : "";
        return {
          content: [{
            type: "text",
            text: `Contenido de ${res.url} (${res.byteSize} bytes):\n\n${res.content}${warning}`,
          }],
          details: { url: res.url, byteSize: res.byteSize, truncated: res.truncated },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_web_fetch: ${err.message}` }],
          details: { url: params?.url ?? "", error: err.message },
          isError: true,
        };
      }
    },
  });

  // 3. Discussion Search (Stack Overflow + Hacker News)
  pi.registerTool({
    name: "dc_discussion_search",
    label: "DC Discussion Search",
    description: "Busca en foros técnicos especializados de la comunidad de desarrollo: Stack Overflow y Hacker News. Ideal para errores de compilación, bugs y debates técnicos.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Tema, error o consulta a buscar" },
        source: { type: "string", enum: ["all", "stack_overflow", "hacker_news"], description: "Fuente de discusión (default: all)" },
        limit: { type: "number", description: "Cantidad de resultados por fuente (default: 5)" },
      },
      required: ["query"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const source = params.source ?? "all";
        const limit = params.limit ?? 5;
        const results: any[] = [];

        if (source === "all" || source === "stack_overflow") {
          const so = await searchStackOverflow(params.query, limit);
          results.push(...so);
        }
        if (source === "all" || source === "hacker_news") {
          const hn = await searchHackerNews(params.query, limit);
          results.push(...hn);
        }

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: `No se encontraron discusiones comunitarias para: "${params.query}"` }],
            details: { query: params.query, count: 0, items: [] },
          };
        }

        const formatted = results.map((d, i) =>
          `### [${i + 1}] (${d.source.toUpperCase()}) ${d.title}\n- URL: ${d.url}\n- Puntos/Votos: ${d.score} | Comentarios: ${d.commentsCount}\n${d.snippet ? `- Extracto: ${d.snippet}\n` : ""}`
        ).join("\n");

        return {
          content: [{
            type: "text",
            text: `Discusiones encontradas para "${params.query}":\n\n${formatted}`,
          }],
          details: { query: params.query, count: results.length, items: results },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_discussion_search: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 4. Discussion Answers Get (Stack Overflow specific)
  pi.registerTool({
    name: "dc_discussion_answers_get",
    label: "DC Discussion Answers Get",
    description: "Obtiene las respuestas más votadas o la solución aceptada para una pregunta de Stack Overflow específica.",
    parameters: {
      type: "object",
      properties: {
        questionId: { type: "string", description: "ID numérico de la pregunta de Stack Overflow" },
        limit: { type: "number", description: "Número de respuestas a traer (default: 3)" },
      },
      required: ["questionId"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const answers = await getStackOverflowAnswers(params.questionId, params.limit ?? 3);
        if (answers.length === 0) {
          return {
            content: [{ type: "text", text: `No se encontraron respuestas para la pregunta ${params.questionId}` }],
            details: { questionId: params.questionId, count: 0 },
          };
        }

        const formatted = answers.map((a, i) =>
          `### Respuesta [${i + 1}] ${a.isAccepted ? "⭐ (ACEPTADA)" : ""} - Votos: ${a.score} (Autor: ${a.author ?? "anónimo"})\n\n${a.body}\n`
        ).join("\n---\n");

        return {
          content: [{
            type: "text",
            text: `Respuestas de Stack Overflow para ID ${params.questionId}:\n\n${formatted}`,
          }],
          details: { questionId: params.questionId, count: answers.length },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_discussion_answers_get: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 5. GitHub Code Search & File Get
  pi.registerTool({
    name: "dc_github_code_search",
    label: "DC GitHub Code Search",
    description: "Busca código público en GitHub para encontrar ejemplos de implementación, APIs o patrones de arquitectura.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto o símbolo a buscar en el código" },
        repo: { type: "string", description: "Opcional: Repositorio en formato 'owner/repo'" },
        limit: { type: "number", description: "Resultados máximos (default: 5)" },
      },
      required: ["query"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const items = await searchGitHubCode(params.query, params.repo, params.limit ?? 5);
        if (items.length === 0) {
          return {
            content: [{ type: "text", text: `No se encontró código en GitHub para "${params.query}"` }],
            details: { query: params.query, count: 0, items: [] },
          };
        }

        const formatted = items.map((c, i) =>
          `### [${i + 1}] ${c.repo} ➡️ \`${c.path}\`\n- URL: ${c.url}`
        ).join("\n\n");

        return {
          content: [{
            type: "text",
            text: `Código encontrado en GitHub para "${params.query}":\n\n${formatted}\n\n*Podés leer cualquier archivo con dc_github_get*.`,
          }],
          details: { query: params.query, count: items.length, items },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_github_code_search: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "dc_github_get",
    label: "DC GitHub Get File",
    description: "Descarga un archivo específico de un repositorio público de GitHub sin necesidad de clonarlo.",
    parameters: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repositorio en formato 'owner/repo' (ej: 'facebook/react')" },
        path: { type: "string", description: "Ruta del archivo dentro del repositorio (ej: 'packages/react/index.js')" },
        ref: { type: "string", description: "Rama, tag o commit SHA (default: 'HEAD' o 'main')" },
      },
      required: ["repo", "path"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const res = await getGitHubFile(params.repo, params.path, params.ref ?? "HEAD");
        return {
          content: [{
            type: "text",
            text: `Archivo ${res.repo}:${res.path} (${res.byteSize} bytes):\n\n\`\`\`\n${res.content}\n\`\`\``,
          }],
          details: { repo: res.repo, path: res.path, byteSize: res.byteSize },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_github_get: ${err.message}` }],
          details: { repo: params?.repo ?? "", path: params?.path ?? "", error: err.message },
          isError: true,
        };
      }
    },
  });

  // 6. Research Papers (arXiv + OpenAlex)
  pi.registerTool({
    name: "dc_research_search",
    label: "DC Research Search",
    description: "Busca papers científicos, preprints e investigaciones académicas en arXiv y OpenAlex. Úsala para temas de IA, machine learning, algoritmos y especificaciones científicas.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Tema o términos de investigación académica" },
        source: { type: "string", enum: ["all", "arxiv", "openalex"], description: "Fuente académica (default: all)" },
        limit: { type: "number", description: "Resultados por fuente (default: 5)" },
      },
      required: ["query"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const source = params.source ?? "all";
        const limit = params.limit ?? 5;
        const papers: any[] = [];

        if (source === "all" || source === "arxiv") {
          const arxiv = await searchArxivPapers(params.query, limit);
          papers.push(...arxiv);
        }
        if (source === "all" || source === "openalex") {
          const alex = await searchOpenAlexPapers(params.query, limit);
          papers.push(...alex);
        }

        if (papers.length === 0) {
          return {
            content: [{ type: "text", text: `No se encontraron papers académicos para: "${params.query}"` }],
            details: { query: params.query, count: 0, items: [] },
          };
        }

        const formatted = papers.map((p, i) =>
          `### [${i + 1}] (${p.source.toUpperCase()}) ${p.title} ${p.year ? `(${p.year})` : ""}\n- Autores: ${p.authors.join(", ") || "No especificados"}\n- URL: ${p.url}\n${p.citationCount ? `- Citas: ${p.citationCount}\n` : ""}${p.abstract ? `- Abstract: ${p.abstract.slice(0, 300)}...\n` : ""}`
        ).join("\n\n");

        return {
          content: [{
            type: "text",
            text: `Papers académicos encontrados para "${params.query}":\n\n${formatted}`,
          }],
          details: { query: params.query, count: papers.length, items: papers },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_research_search: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });
}
