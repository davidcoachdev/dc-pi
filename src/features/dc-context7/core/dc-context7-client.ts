import { Context7 } from "@upstash/context7-sdk";
import type {
  Context7Documentation,
  Context7LibraryCandidate,
  Context7Snippet,
  Context7Status,
} from "./dc-context7-types.ts";
import { redactSecrets } from "../../dc-websearch/core/dc-websearch-security.ts";

export class DcContext7Client {
  private client?: Context7;
  private apiKey?: string;

  constructor() {
    this.refreshApiKey();
  }

  private refreshApiKey(): void {
    const key = process.env.CONTEXT7_API_KEY?.trim();
    if (key && key !== this.apiKey) {
      this.apiKey = key;
      this.client = new Context7({ apiKey: key });
    }
  }

  getStatus(): Context7Status {
    this.refreshApiKey();
    const hasApiKey = Boolean(this.apiKey);
    return {
      configured: hasApiKey,
      hasApiKey,
    };
  }

  private getClient(): Context7 {
    this.refreshApiKey();
    if (!this.client || !this.apiKey) {
      throw new Error(
        "Falta CONTEXT7_API_KEY en variables de entorno. Obtené una clave gratuita en https://context7.com y configurala como export CONTEXT7_API_KEY='tu_clave'",
      );
    }
    return this.client;
  }

  /**
   * Busca candidatos de librerías en Context7 por nombre humano (ej: 'zod', 'tailwind', 'hono').
   */
  async searchLibrary(query: string, libraryName: string, limit: number = 5): Promise<Context7LibraryCandidate[]> {
    const client = this.getClient();
    const raw = (await client.searchLibrary(query, libraryName, { type: "json" })) as any;

    if (!Array.isArray(raw)) return [];

    return raw.slice(0, limit).map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      totalSnippets: r.totalSnippets,
      trustScore: r.trustScore,
      benchmarkScore: r.benchmarkScore,
      versions: Array.isArray(r.versions) ? r.versions : undefined,
    }));
  }

  /**
   * Obtiene documentación oficial y snippets de código de Context7 para una librería específica.
   * Limita el payload a 150KB de texto para proteger la ventana de contexto.
   */
  async getContext(query: string, libraryId: string, maxChars: number = 80000): Promise<Context7Documentation> {
    const client = this.getClient();
    const raw = (await client.getContext(query, libraryId, { type: "json" })) as any;

    let snippets: Context7Snippet[] = [];
    if (Array.isArray(raw)) {
      snippets = raw.map((s: any) => ({
        title: s.title,
        content: redactSecrets(s.content ?? ""),
        source: s.source,
        sourceUrl: s.sourceUrl,
      }));
    }

    // Calcular tamaño total y truncar si es excesivo
    let totalText = snippets.map((s) => s.content).join("\n");
    const byteSize = Buffer.byteLength(totalText, "utf8");
    let truncated = false;

    if (totalText.length > maxChars) {
      truncated = true;
      // Truncar snippets preservando los primeros más relevantes
      let currentLen = 0;
      const boundedSnippets: Context7Snippet[] = [];
      for (const snip of snippets) {
        if (currentLen + snip.content.length <= maxChars) {
          boundedSnippets.push(snip);
          currentLen += snip.content.length;
        } else {
          const remaining = maxChars - currentLen;
          if (remaining > 500) {
            boundedSnippets.push({
              ...snip,
              content: snip.content.slice(0, remaining) + "\n\n... [Contenido truncado por límite de contexto]",
            });
          }
          break;
        }
      }
      snippets = boundedSnippets;
    }

    return {
      libraryId,
      query,
      snippets,
      byteSize,
      truncated,
    };
  }
}

export const dcContext7Client = new DcContext7Client();
