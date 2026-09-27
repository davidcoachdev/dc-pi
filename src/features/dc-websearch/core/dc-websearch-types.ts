export interface WebSearchItem {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  author?: string;
  score?: number;
}

export interface WebSearchResponse {
  query: string;
  provider: "exa" | "parallel" | "fallback";
  results: WebSearchItem[];
  total?: number;
}

export interface WebFetchResponse {
  url: string;
  title?: string;
  content: string;
  byteSize: number;
  truncated: boolean;
}

export interface DiscussionItem {
  id: string | number;
  source: "stack_overflow" | "github_issue" | "github_discussion" | "hacker_news";
  title: string;
  url: string;
  author?: string;
  score?: number;
  commentsCount?: number;
  snippet?: string;
  body?: string;
  answers?: DiscussionAnswer[];
}

export interface DiscussionAnswer {
  id: string | number;
  author?: string;
  score?: number;
  isAccepted?: boolean;
  body: string;
}

export interface ResearchPaperItem {
  id: string; // DOI o arXiv ID
  source: "arxiv" | "openalex" | "semantic_scholar";
  title: string;
  authors: string[];
  abstract: string;
  year?: number;
  url: string;
  doi?: string;
  citationCount?: number;
}

export interface GitHubFileResult {
  repo: string;
  path: string;
  ref?: string;
  content: string;
  byteSize: number;
}

export interface GitHubCodeItem {
  repo: string;
  path: string;
  url: string;
  sha?: string;
}
