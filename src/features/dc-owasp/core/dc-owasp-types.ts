/**
 * dc-owasp-types.ts — Tipos y contratos para dc-owasp.
 */

export interface OwaspIndexEntry {
  location: string;
  title: string;
  text?: string;
  category?: string;
}

export interface OwaspSearchResult {
  title: string;
  location: string;
  category: string;
  snippet?: string;
  score: number;
}

export interface OwaspSheetContent {
  title: string;
  filename: string;
  markdown: string;
  url: string;
  fetchedAt: number;
}

export interface OwaspAuditFinding {
  severity: "high" | "medium" | "low" | "info";
  ruleId: string;
  category: string;
  cheatsheet: string;
  cheatsheetUrl: string;
  file?: string;
  line?: number;
  snippet?: string;
  message: string;
  remediation: string;
}

export interface OwaspAuditReport {
  timestamp: number;
  totalFindings: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  findings: OwaspAuditFinding[];
}
