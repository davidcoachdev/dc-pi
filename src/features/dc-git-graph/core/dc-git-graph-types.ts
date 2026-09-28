import type { Theme } from "@earendil-works/pi-coding-agent";

export interface GitGraphCommit {
  hash: string;
  shortHash: string;
  refs: string[];
  refString: string;
  subject: string;
  author: string;
  date: string;
  isHead: boolean;
  graphPrefix: string;
}

export type GitGraphRow =
  | { kind: "commit"; commit: GitGraphCommit; rawLine: string }
  | { kind: "connector"; graphText: string; rawLine: string };

export interface GitGraphData {
  rows: GitGraphRow[];
  commits: GitGraphCommit[];
  headCommitHash?: string;
  currentBranch?: string;
}

export interface DcGitGraphPanelOptions {
  cwd: string;
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  getGraphData?: (cwd: string) => GitGraphData;
  getCommitDetail?: (cwd: string, hash: string) => string[];
  requestRender: () => void;
  initialSelectedHash?: string;
}
