import type { GitHubCodeItem, GitHubFileResult } from "../../core/dc-websearch-types.ts";
import { redactSecrets } from "../../core/dc-websearch-security.ts";

/**
 * Busca archivos o fragmentos de código público en GitHub usando la API oficial.
 */
export async function searchGitHubCode(query: string, repo?: string, limit: number = 5): Promise<GitHubCodeItem[]> {
  try {
    const q = repo ? `${query} repo:${repo}` : query;
    const url = `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=${limit}`;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "DC-Studio-GitHub-Search/1.0",
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];

    const data = await res.json();
    const items = data?.items ?? [];

    return items.map((i: any) => ({
      repo: i.repository?.full_name ?? "",
      path: i.path ?? "",
      url: i.html_url ?? "",
      sha: i.sha,
    }));
  } catch {
    return [];
  }
}

/**
 * Obtiene el contenido de un archivo en GitHub público sin clonar el repositorio.
 */
export async function getGitHubFile(repo: string, filePath: string, ref: string = "HEAD"): Promise<GitHubFileResult> {
  const cleanPath = filePath.replace(/^\/+/, "");
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${cleanPath}`;

  const headers: Record<string, string> = {
    "User-Agent": "DC-Studio-GitHub-Fetch/1.0",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    throw new Error(`No se pudo obtener ${cleanPath} de ${repo} (HTTP ${res.status})`);
  }

  const content = await res.text();
  const byteSize = Buffer.byteLength(content, "utf8");

  return {
    repo,
    path: cleanPath,
    ref,
    content: redactSecrets(content),
    byteSize,
  };
}
