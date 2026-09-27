import type { ResearchPaperItem } from "../../core/dc-websearch-types.ts";
import { redactSecrets } from "../../core/dc-websearch-security.ts";

/**
 * Busca papers académicos y preprints en arXiv mediante su API pública Atom/XML.
 */
export async function searchArxivPapers(query: string, limit: number = 5): Promise<ResearchPaperItem[]> {
  try {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const xml = await res.text();
    const entries = xml.split(/<entry>/i).slice(1);
    const papers: ResearchPaperItem[] = [];

    for (const entry of entries) {
      const idMatch = entry.match(/<id>([^<]+)<\/id>/i);
      const titleMatch = entry.match(/<title>([\s\S]+?)<\/title>/i);
      const summaryMatch = entry.match(/<summary>([\s\S]+?)<\/summary>/i);
      const publishedMatch = entry.match(/<published>(\d{4})/i);

      // Autores
      const authorMatches = [...entry.matchAll(/<name>([^<]+)<\/name>/gi)];
      const authors = authorMatches.map((m) => m[1]?.trim() ?? "").filter(Boolean);

      const paperUrl = idMatch?.[1]?.trim() ?? "";
      const arxivId = paperUrl.split("/abs/").pop() ?? paperUrl;

      if (titleMatch?.[1]) {
        papers.push({
          id: arxivId,
          source: "arxiv",
          title: titleMatch[1].replace(/\s+/g, " ").trim(),
          authors,
          abstract: redactSecrets((summaryMatch?.[1] ?? "").replace(/\s+/g, " ").trim()),
          year: publishedMatch?.[1] ? parseInt(publishedMatch[1], 10) : undefined,
          url: paperUrl,
        });
      }
    }

    return papers;
  } catch {
    return [];
  }
}

/**
 * Busca papers en OpenAlex (índice global abierto de ciencia).
 */
export async function searchOpenAlexPapers(query: string, limit: number = 5): Promise<ResearchPaperItem[]> {
  try {
    const mailto = process.env.OPENALEX_MAILTO ? `&mailto=${encodeURIComponent(process.env.OPENALEX_MAILTO)}` : "";
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}${mailto}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const data = await res.json();
    const results = data?.results ?? [];

    return results.map((w: any) => {
      const authors = (w.authorships ?? [])
        .map((a: any) => a.author?.display_name)
        .filter(Boolean);

      return {
        id: w.id,
        source: "openalex",
        title: w.title ?? "Sin título",
        authors,
        abstract: redactSecrets(w.abstract_inverted_index ? reconstructAbstract(w.abstract_inverted_index) : ""),
        year: w.publication_year,
        url: w.doi ?? w.id,
        doi: w.doi,
        citationCount: w.cited_by_count ?? 0,
      };
    });
  } catch {
    return [];
  }
}

function reconstructAbstract(invertedIndex: Record<string, number[]>): string {
  const words: Array<{ word: string; pos: number }> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words.push({ word, pos });
    }
  }
  words.sort((a, b) => a.pos - b.pos);
  return words.map((w) => w.word).join(" ");
}
