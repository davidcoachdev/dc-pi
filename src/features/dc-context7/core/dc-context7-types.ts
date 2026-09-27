export interface Context7LibraryCandidate {
  id: string;
  name: string;
  description?: string;
  totalSnippets?: number;
  trustScore?: number;
  benchmarkScore?: number;
  versions?: string[];
}

export interface Context7Snippet {
  title?: string;
  content: string;
  source?: string;
  sourceUrl?: string;
}

export interface Context7Documentation {
  libraryId: string;
  query: string;
  snippets: Context7Snippet[];
  byteSize: number;
  truncated: boolean;
}

export interface Context7Status {
  configured: boolean;
  hasApiKey: boolean;
}
