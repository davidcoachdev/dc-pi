import type { Theme } from "@earendil-works/pi-coding-agent";

export type GitGraphCommitKind = "head" | "merge" | "remote-tip" | "commit";

export interface GitGraphCommit {
  hash: string;
  shortHash: string;
  refs: string[];
  refString: string;
  subject: string;
  author: string;
  date: string;
  isHead: boolean;
  isMerge: boolean;
  isRemoteTip: boolean;
  commitKind: GitGraphCommitKind;
  graphPrefix: string;
  typeTag?: string;
  typeColorAnsi?: string;
}

export type GitGraphRow =
  | { kind: "commit"; commit: GitGraphCommit; rawLine: string }
  | { kind: "connector"; graphText: string; rawLine: string };

export interface GitGraphWorkingTreeStatus {
  modifiedCount: number;
  untrackedCount: number;
  summaryText: string;
  diffStat?: string;
}

export interface GitGraphData {
  rows: GitGraphRow[];
  commits: GitGraphCommit[];
  headCommitHash?: string;
  currentBranch?: string;
  workingTreeStatus?: GitGraphWorkingTreeStatus;
}

export interface DcGitGraphPanelOptions {
  cwd: string;
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  getGraphData?: (cwd: string) => GitGraphData;
  getCommitDetail?: (cwd: string, hash: string) => string[];
  maxRows?: number | (() => number);
  requestRender: () => void;
  initialSelectedHash?: string;
}
