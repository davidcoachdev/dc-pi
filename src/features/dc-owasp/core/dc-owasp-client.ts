/**
 * dc-owasp-client.ts — Cliente para consultar índices y markdowns de OWASP Cheat Sheets
 * con estrategia Híbrida Bajo Demanda y caché local en ~/.cache/dc-pi/owasp/.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { OwaspIndexEntry, OwaspSearchResult, OwaspSheetContent } from "./dc-owasp-types.ts";
import { OWASP_CATALOG } from "./dc-owasp-catalog.ts";

const BASE_RAW_URL = "https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets";
const SEARCH_INDEX_URL = "https://cheatsheetseries.owasp.org/search/search_index.json";

export class DcOwaspClient {
  private cacheDir: string;
  private indexCache: OwaspIndexEntry[] | null = null;

  constructor(customCacheDir?: string) {
    this.cacheDir = customCacheDir || path.join(os.homedir(), ".cache", "dc-pi", "owasp");
    this.ensureCacheDir();
  }

  private ensureCacheDir(): void {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch {
      // Best effort
    }
  }

  /**
   * Obtiene o carga el índice de búsqueda (search_index.json).
   * Si no hay red, usa el catálogo local curado como fallback.
   */
  async getIndex(): Promise<OwaspIndexEntry[]> {
    if (this.indexCache) return this.indexCache;

    const indexPath = path.join(this.cacheDir, "search_index.json");

    // 1. Revisar si tenemos caché en disco menor a 7 días
    if (fs.existsSync(indexPath)) {
      try {
        const stat = fs.statSync(indexPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs < 7 * 24 * 60 * 60 * 1000) {
          const raw = fs.readFileSync(indexPath, "utf-8");
          const parsed = JSON.parse(raw);
          const docs: OwaspIndexEntry[] = Array.isArray(parsed.docs) ? parsed.docs : [];
          if (docs.length > 0) {
            this.indexCache = docs;
            return docs;
          }
        }
      } catch {
        // Fallback a fetch
      }
    }

    // 2. Intentar fetch remoto
    try {
      const resp = await fetch(SEARCH_INDEX_URL, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = await resp.json();
        const docs: OwaspIndexEntry[] = Array.isArray(data?.docs) ? data.docs : [];
        if (docs.length > 0) {
          try {
            fs.writeFileSync(indexPath, JSON.stringify(data), "utf-8");
          } catch {
            // Best effort
          }
          this.indexCache = docs;
          return docs;
        }
      }
    } catch {
      // Falla de red, usamos fallback
    }

    // 3. Fallback: Construir índice a partir del catálogo curado
    const fallbackDocs: OwaspIndexEntry[] = OWASP_CATALOG.map((item) => ({
      location: item.filename.replace(/\.md$/, "/"),
      title: item.title,
      text: `${item.title} ${item.keywords.join(" ")}`,
      category: item.category,
    }));

    this.indexCache = fallbackDocs;
    return fallbackDocs;
  }

  /**
   * Búsqueda por término o intención.
   */
  async search(query: string, limit = 10): Promise<OwaspSearchResult[]> {
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const index = await this.getIndex();
    const results: OwaspSearchResult[] = [];

    // Priorizar coincidencias en el catálogo curado
    for (const cat of OWASP_CATALOG) {
      let score = 0;
      if (cat.title.toLowerCase().includes(q)) score += 10;
      if (cat.keywords.some((kw) => kw.includes(q) || q.includes(kw))) score += 7;
      if (cat.category.toLowerCase().includes(q)) score += 3;

      if (score > 0) {
        results.push({
          title: cat.title,
          location: cat.filename.replace(/\.md$/, "/"),
          category: cat.category,
          score,
        });
      }
    }

    // Buscar en el índice completo de MkDocs
    for (const doc of index) {
      // Ignorar sub-secciones que ya estén en results por documento principal
      const isHeader = doc.location.includes("#");
      const titleLower = doc.title.toLowerCase();
      const textLower = (doc.text || "").toLowerCase();

      if (results.some((r) => r.location === doc.location || r.title === doc.title)) {
        continue;
      }

      let score = 0;
      if (titleLower === q) score += 15;
      else if (titleLower.includes(q)) score += 8;
      else if (textLower.includes(q)) score += 2;

      if (score > 0) {
        results.push({
          title: doc.title,
          location: doc.location,
          category: doc.category || (isHeader ? "Section" : "General"),
          snippet: doc.text ? doc.text.slice(0, 150) + "..." : undefined,
          score,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Obtiene el markdown crudo de una Cheat Sheet (con caché local perezoso).
   */
  async getSheetMarkdown(filenameOrId: string): Promise<OwaspSheetContent | null> {
    let filename = filenameOrId;

    // Resolver si pasaron un ID del catálogo (ej. 'auth', 'sql-injection')
    const catalogItem = OWASP_CATALOG.find(
      (c) => c.id === filenameOrId || c.filename === filenameOrId || c.title.toLowerCase() === filenameOrId.toLowerCase(),
    );

    if (catalogItem) {
      filename = catalogItem.filename;
    } else if (!filename.endsWith(".md")) {
      filename = `${filename.replace(/\/$/, "")}.md`;
    }

    const localPath = path.join(this.cacheDir, filename);

    // 1. Revisar si ya está en caché local
    if (fs.existsSync(localPath)) {
      try {
        const md = fs.readFileSync(localPath, "utf-8");
        const stat = fs.statSync(localPath);
        return {
          title: catalogItem ? catalogItem.title : filename.replace(/_Cheat_Sheet\.md$/, "").replace(/_/g, " "),
          filename,
          markdown: md,
          url: catalogItem ? catalogItem.url : `${BASE_RAW_URL}/${filename}`,
          fetchedAt: stat.mtimeMs,
        };
      } catch {
        // Fallback a fetch
      }
    }

    // 2. Fetch remoto desde Raw GitHub
    const rawUrl = `${BASE_RAW_URL}/${filename}`;
    try {
      const resp = await fetch(rawUrl, { signal: AbortSignal.timeout(6000) });
      if (resp.ok) {
        const md = await resp.text();
        try {
          fs.writeFileSync(localPath, md, "utf-8");
        } catch {
          // Best effort
        }
        return {
          title: catalogItem ? catalogItem.title : filename.replace(/_Cheat_Sheet\.md$/, "").replace(/_/g, " "),
          filename,
          markdown: md,
          url: catalogItem ? catalogItem.url : rawUrl,
          fetchedAt: Date.now(),
        };
      }
    } catch {
      // Error de red
    }

    return null;
  }
}
