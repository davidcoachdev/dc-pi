export type GitSyncStatus = "synced" | "ahead" | "behind" | "diverged" | "no_upstream" | "not_a_repo";

export interface GitSyncDiagnostic {
  isGitRepo: boolean;
  branch?: string;
  upstream?: string;
  status: GitSyncStatus;
  aheadCount: number;
  behindCount: number;
  hasUncommittedChanges: boolean;
  hasUntrackedFiles: boolean;
  summary: string;
  recommendation?: string;
}
