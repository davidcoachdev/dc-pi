import type { GitGraphCommit, GitGraphCommitKind, GitGraphData, GitGraphRow, GitGraphWorkingTreeStatus } from "./dc-git-graph-types.ts";

export const COMMIT_REC_MARKER = "COMMIT_REC:";

/** Pure parser for git log --graph output formatted with COMMIT_REC delimiter. */
export function parseGitGraph(
  rawOutput: string,
  headCommitHash?: string,
  currentBranch?: string,
  workingTreeStatus?: GitGraphWorkingTreeStatus,
): GitGraphData {
  if (!rawOutput || !rawOutput.trim()) {
    return {
      rows: [],
      commits: [],
      headCommitHash,
      currentBranch,
      workingTreeStatus,
    };
  }

  const lines = rawOutput.split("\n").filter((l) => l.trim().length > 0);
  const rows: GitGraphRow[] = [];
  const commits: GitGraphCommit[] = [];

  for (const line of lines) {
    const markerIndex = line.indexOf(COMMIT_REC_MARKER);
    if (markerIndex === -1) {
      // Pure connector line (e.g. |\ or |/ or * etc.)
      rows.push({
        kind: "connector",
        graphText: line,
        rawLine: line,
      });
      continue;
    }

    const graphPrefix = line.slice(0, markerIndex);
    const payload = line.slice(markerIndex + COMMIT_REC_MARKER.length);
    const fields = payload.split("\x1f");

    const hash = fields[0]?.trim() || "";
    const shortHash = fields[1]?.trim() || hash.slice(0, 7);
    const rawRefs = fields[2]?.trim() || "";
    const subject = fields[3]?.trim() || "";
    const author = fields[4]?.trim() || "";
    const date = fields[5]?.trim() || "";

    const refs = parseRefs(rawRefs);
    const isHead = headCommitHash
      ? hash === headCommitHash || shortHash === headCommitHash
      : rawRefs.includes("HEAD");

    const isMerge =
      subject.toLowerCase().startsWith("merge ") ||
      subject.toLowerCase().startsWith("merge pull request");

    const isRemoteTip =
      !isHead &&
      refs.some((r) => r.startsWith("origin/") || (r.includes("/") && !r.startsWith("HEAD")));

    let commitKind: GitGraphCommitKind = "commit";
    if (isHead) {
      commitKind = "head";
    } else if (isMerge) {
      commitKind = "merge";
    } else if (isRemoteTip) {
      commitKind = "remote-tip";
    }

    const commit: GitGraphCommit = {
      hash,
      shortHash,
      refs,
      refString: rawRefs,
      subject,
      author,
      date,
      isHead,
      isMerge,
      isRemoteTip,
      commitKind,
      graphPrefix,
    };

    commits.push(commit);
    rows.push({
      kind: "commit",
      commit,
      rawLine: line,
    });
  }

  // Ensure headCommitHash is resolved
  const resolvedHead = headCommitHash || commits.find((c) => c.isHead)?.hash;

  return {
    rows,
    commits,
    headCommitHash: resolvedHead,
    currentBranch,
    workingTreeStatus,
  };
}

function parseRefs(raw: string): string[] {
  if (!raw) return [];
  let s = raw.trim();
  if (s.startsWith("(") && s.endsWith(")")) {
    s = s.slice(1, -1).trim();
  }
  if (!s) return [];
  return s
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}
