import { convert } from "html-to-text";
import type { WebFetchResponse, WebSearchItem, WebSearchResponse } from "../../core/dc-websearch-types.ts";
import { isSafeWebUrl, redactSecrets } from "../../core/dc-websearch-security.ts";

const EXA_MCP_ENDPOINT = "https://mcp.exa.ai/mcp";
const PARALLEL_SEARCH_ENDPOINT = "https://search.parallel.ai/v1/search";

export interface WebSearchOptions {
  query: string;
  limit?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
  mode?: "fast" | "auto" | "deep";
  timeoutMs?: number;
}

/**
 * Busca en la web usando Exa como motor primario (con failover a Parallel o fallback estructurado).
 */
export async function executeWebSearch(options: WebSearchOptions): Promise<WebSearchResponse> {
  const limit = Math.min(20, Math.max(1, options.limit ?? 8));
  const timeoutMs = options.timeoutMs ?? 15000;

  // 1. Intentar Exa MCP / API
  try {
    const exaKey = process.env.EXA_API_KEY;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (exaKey) {
      headers["x-api-key"] = exaKey;
    }

    const payload = {
      method: "tools/call",
      params: {
        name: "web_search_exa",
        arguments: {
          query: options.query,
          num_results: limit,
          include_domains: options.includeDomains,
          exclude_domains: options.excludeDomains,
        },
      },
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    const res = await fetch(EXA_MCP_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const content = data?.result?.content;
      if (Array.isArray(content)) {
        const textBlock = content.find((c: any) => c.type === "text")?.text ?? "";
        const parsedResults = parseExaMarkdownResults(textBlock);
        if (parsedResults.length > 0) {
          return {
            query: options.query,
            provider: "exa",
            results: parsedResults.slice(0, limit),
            total: parsedResults.length,
          };
        }
      }
    }
  } catch {
    // Failover a Parallel
  }

  // 2. Intentar Parallel Search API
  try {
    const parallelKey = process.env.PARALLEL_API_KEY;
    if (parallelKey) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      const res = await fetch(PARALLEL_SEARCH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${parallelKey}`,
        },
        body: JSON.stringify({
          query: options.query,
          max_results: limit,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const items: WebSearchItem[] = (data?.results ?? []).map((r: any) => ({
          title: r.title ?? "Sin título",
          url: r.url,
          snippet: redactSecrets(r.snippet ?? r.description ?? ""),
          publishedDate: r.published_date,
        }));
        if (items.length > 0) {
          return {
            query: options.query,
            provider: "parallel",
            results: items,
            total: items.length,
          };
        }
      }
    }
  } catch {
    // Continuar al fallback
  }

  // 3. Fallback de cortesía / DuckDuckGo HTML simple
  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(options.query)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(ddgUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const html = await res.text();
      const items = parseDuckDuckGoHtml(html, limit);
      return {
        query: options.query,
        provider: "fallback",
        results: items,
        total: items.length,
      };
    }
  } catch {
    // Retornar vacío si fallan todos los fallbacks
  }

  return {
    query: options.query,
    provider: "fallback",
    results: [],
    total: 0,
  };
}

/**
 * Lector web seguro con límite de 2MB, protección anti-SSRF y sanitización con html-to-text.
 */
export async function executeWebFetch(url: string, maxBytes: number = 2 * 1024 * 1024): Promise<WebFetchResponse> {
  const check = isSafeWebUrl(url);
  if (!check.safe) {
    throw new Error(`fetch bloqueado: ${check.reason}`);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);

  const res = await fetch(url, {
    headers: {
      "User-Agent": "DC-Studio-WebFetch/1.0",
      Accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8",
    },
    signal: ctrl.signal,
  });
  clearTimeout(timer);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const rawText = await res.text();
  const byteSize = Buffer.byteLength(rawText, "utf8");
  const truncated = byteSize > maxBytes;
  const safeText = truncated ? rawText.slice(0, maxBytes) : rawText;

  let content = safeText;
  if (contentType.includes("html")) {
    content = convert(safeText, {
      wordwrap: 120,
      selectors: [
        { selector: "nav", format: "skip" },
        { selector: "footer", format: "skip" },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "a", options: { ignoreHref: false } },
      ],
    });
  }

  return {
    url,
    content: redactSecrets(content.trim()),
    byteSize,
    truncated,
  };
}

function parseExaMarkdownResults(text: string): WebSearchItem[] {
  const items: WebSearchItem[] = [];
  const blocks = text.split(/(?=Title:)/i);
  for (const block of blocks) {
    const titleMatch = block.match(/Title:\s*(.+)$/im);
    const urlMatch = block.match(/URL:\s*(https?:\/\/[^\s]+)/im);
    const snippetMatch = block.match(/(?:Snippet|Text|Content):\s*([\s\S]+?)(?=(?:Title:|URL:|$))/im);
    if (urlMatch && urlMatch[1]) {
      items.push({
        title: titleMatch?.[1]?.trim() ?? "Sin título",
        url: urlMatch[1].trim(),
        snippet: redactSecrets(snippetMatch?.[1]?.trim() ?? ""),
      });
    }
  }
  return items;
}

function parseDuckDuckGoHtml(html: string, limit: number): WebSearchItem[] {
  const items: WebSearchItem[] = [];
  const regex = /<a[^>]+class="result__snippet[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis;
  let match;
  while ((match = regex.exec(html)) !== null && items.length < limit) {
    const rawUrl = match[1] ?? "";
    const cleanSnippet = match[2]?.replace(/<[^>]+>/g, "").trim() ?? "";
    if (rawUrl) {
      items.push({
        title: "Resultado de búsqueda",
        url: rawUrl,
        snippet: redactSecrets(cleanSnippet),
      });
    }
  }
  return items;
}
