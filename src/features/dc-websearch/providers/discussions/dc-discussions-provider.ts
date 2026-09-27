import type { DiscussionAnswer, DiscussionItem } from "../../core/dc-websearch-types.ts";
import { redactSecrets } from "../../core/dc-websearch-security.ts";

/**
 * Busca discusiones en Hacker News mediante la API pública de Algolia.
 */
export async function searchHackerNews(query: string, limit: number = 5): Promise<DiscussionItem[]> {
  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];

    const data = await res.json();
    const hits = data?.hits ?? [];

    return hits.map((h: any) => ({
      id: h.objectID,
      source: "hacker_news",
      title: h.title ?? "Sin título",
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      author: h.author,
      score: h.points ?? 0,
      commentsCount: h.num_comments ?? 0,
      snippet: redactSecrets(h.story_text ?? ""),
    }));
  } catch {
    return [];
  }
}

/**
 * Busca preguntas y respuestas en Stack Overflow mediante la API pública de Stack Exchange.
 */
export async function searchStackOverflow(query: string, limit: number = 5): Promise<DiscussionItem[]> {
  try {
    const apiKeyParam = process.env.STACK_EXCHANGE_KEY ? `&key=${process.env.STACK_EXCHANGE_KEY}` : "";
    const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=${limit}&filter=withbody${apiKeyParam}`;
    
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];

    const data = await res.json();
    const items = data?.items ?? [];

    return items.map((item: any) => ({
      id: item.question_id,
      source: "stack_overflow",
      title: item.title ?? "Sin título",
      url: item.link,
      author: item.owner?.display_name,
      score: item.score ?? 0,
      commentsCount: item.answer_count ?? 0,
      snippet: redactSecrets((item.body ?? "").replace(/<[^>]+>/g, "").slice(0, 300)),
    }));
  } catch {
    return [];
  }
}

/**
 * Obtiene las respuestas más votadas de una pregunta en Stack Overflow.
 */
export async function getStackOverflowAnswers(questionId: string | number, limit: number = 3): Promise<DiscussionAnswer[]> {
  try {
    const apiKeyParam = process.env.STACK_EXCHANGE_KEY ? `&key=${process.env.STACK_EXCHANGE_KEY}` : "";
    const url = `https://api.stackexchange.com/2.3/questions/${questionId}/answers?order=desc&sort=votes&site=stackoverflow&pagesize=${limit}&filter=withbody${apiKeyParam}`;
    
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];

    const data = await res.json();
    const items = data?.items ?? [];

    return items.map((a: any) => ({
      id: a.answer_id,
      author: a.owner?.display_name,
      score: a.score ?? 0,
      isAccepted: a.is_accepted ?? false,
      body: redactSecrets((a.body ?? "").replace(/<[^>]+>/g, "")),
    }));
  } catch {
    return [];
  }
}
