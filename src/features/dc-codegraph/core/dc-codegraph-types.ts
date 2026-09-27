export interface CodeGraphStatusResult {
  indexed: boolean;
  projectRoot: string;
  filesCount?: number;
  symbolsCount?: number;
  relationshipsCount?: number;
  lastSync?: string;
  isGitRepo: boolean;
  rawText: string;
}

export interface CodeGraphNodeResult {
  target: string;
  kind?: "symbol" | "file";
  path?: string;
  codeSnippet?: string;
  callers?: string[];
  callees?: string[];
  dependents?: string[];
  rawText: string;
}

export interface CodeGraphImpactResult {
  target: string;
  directAffected: string[];
  transitiveAffected: string[];
  totalAffectedCount: number;
  rawText: string;
}

export interface CodeGraphExploreResult {
  query: string;
  output: string;
  byteSize: number;
  truncated: boolean;
}

export interface CodeGraphSyncResult {
  synced: boolean;
  output: string;
}
