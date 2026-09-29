import test from "node:test";
import assert from "node:assert/strict";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import {
  parseGitGraph,
  DcGitGraphPanel,
  openGitGraphViewer,
  dcGitGraphExtension,
  type GitGraphCommit,
  type GitGraphData,
} from "../src/features/dc-git-graph/index.ts";
import {
  getGitCommitDetail,
  getGitCommitGraph,
  getGitHeadHash,
  getGitCurrentBranch,
} from "../src/integrations/dc-git/dc-git.ts";

const dummyTheme: Pick<Theme, "fg" | "bg" | "bold"> = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

const sampleGitLog = [
  "*   COMMIT_REC:2d271f8c06a558d87bfcad7923347ad8ed02887d\x1f2d271f8\x1f (HEAD -> main, origin/main)\x1fmerge feat\x1fTest User\x1f2026-09-28",
  "|\\  ",
  "| * COMMIT_REC:486b5f90441d8d88af165262ae41b6261d80b896\x1f486b5f9\x1f (feat, tag: v1.0.0)\x1ffeat commit\x1fAlice Dev\x1f2026-09-27",
  "* | COMMIT_REC:fa1b8c6adcfdbaa35108453b1cb2f05b655246d2\x1ffa1b8c6\x1f\x1fmain commit\x1fBob Dev\x1f2026-09-26",
  "|/  ",
  "* COMMIT_REC:5fa11eea78ba0b123db831537a6b21b50b72f78a\x1f5fa11ee\x1f\x1finit commit\x1fTest User\x1f2026-09-25",
].join("\n");

test("parseGitGraph correctly parses commit records, graph connectors, and refs", () => {
  const data = parseGitGraph(sampleGitLog, undefined, "main");

  assert.equal(data.commits.length, 4);
  assert.equal(data.rows.length, 6); // 4 commits + 2 connectors

  // First commit (HEAD)
  const c0 = data.commits[0]!;
  assert.equal(c0.shortHash, "2d271f8");
  assert.equal(c0.hash, "2d271f8c06a558d87bfcad7923347ad8ed02887d");
  assert.equal(c0.subject, "merge feat");
  assert.equal(c0.author, "Test User");
  assert.equal(c0.date, "2026-09-28");
  assert.equal(c0.isHead, true);
  assert.deepEqual(c0.refs, ["HEAD -> main", "origin/main"]);
  assert.equal(c0.graphPrefix, "*   ");

  // Connector row 1
  const r1 = data.rows[1]!;
  assert.equal(r1.kind, "connector");
  if (r1.kind === "connector") {
    assert.equal(r1.graphText.trim(), "|\\");
  }

  // Second commit with tags
  const c1 = data.commits[1]!;
  assert.equal(c1.shortHash, "486b5f9");
  assert.equal(c1.subject, "feat commit");
  assert.equal(c1.isHead, false);
  assert.deepEqual(c1.refs, ["feat", "tag: v1.0.0"]);

  // Connector row 4
  const r4 = data.rows[4]!;
  assert.equal(r4.kind, "connector");
  if (r4.kind === "connector") {
    assert.equal(r4.graphText.trim(), "|/");
  }
});

test("parseGitGraph respects headCommitHash when explicit", () => {
  // If HEAD is detached or points to c1
  const data = parseGitGraph(sampleGitLog, "486b5f90441d8d88af165262ae41b6261d80b896", "detached");
  assert.equal(data.headCommitHash, "486b5f90441d8d88af165262ae41b6261d80b896");
  assert.equal(data.currentBranch, "detached");
  assert.equal(data.commits[1]!.isHead, true);
});

test("parseGitGraph handles empty output safely", () => {
  const data = parseGitGraph("", undefined, "main");
  assert.equal(data.commits.length, 0);
  assert.equal(data.rows.length, 0);
});

test("parseGitGraph handles malformed lines safely without crashing", () => {
  const malformed = "some random log error\nwarning: something broke\n";
  const data = parseGitGraph(malformed);
  assert.equal(data.commits.length, 0);
  assert.equal(data.rows.length, 2);
  assert.equal(data.rows[0]!.kind, "connector");
});

test("DcGitGraphPanel initially selects HEAD commit and renders two panes", () => {
  const graphData = parseGitGraph(sampleGitLog, undefined, "main");
  const detailCalls: string[] = [];

  const panel = new DcGitGraphPanel({
    cwd: "/fake/repo",
    theme: dummyTheme,
    getGraphData: () => graphData,
    getCommitDetail: (_cwd, hash) => {
      detailCalls.push(hash);
      return [`commit ${hash}`, "Author: Test User", "    Subject message", "diff --git a b"];
    },
    requestRender: () => {},
  });

  // Selected index should be 0 (the HEAD commit)
  assert.equal(panel.getSelectedIndex(), 0);
  assert.equal(panel.getSelectedCommit()?.shortHash, "2d271f8");
  assert.equal(detailCalls.length, 1);
  assert.equal(detailCalls[0], "2d271f8c06a558d87bfcad7923347ad8ed02887d");

  // Render output contains two columns separated by vertical divider (1/3 graph left, 2/3 detail right)
  const lines = panel.render(100);
  assert.ok(lines.length > 5);
  assert.ok(lines.some((l) => l.includes("│"))); // divider
  assert.ok(lines.some((l) => l.includes("main")));
  assert.ok(lines.some((l) => l.includes("2d271f8") || l.includes("merge feat")));
  assert.ok(lines.some((l) => l.includes("Subject message")));
});

test("DcGitGraphPanel keyboard navigation: Down/Up updates selected commit and details", () => {
  const graphData = parseGitGraph(sampleGitLog, undefined, "main");
  const loadedHashes: string[] = [];

  const panel = new DcGitGraphPanel({
    cwd: "/fake/repo",
    theme: dummyTheme,
    getGraphData: () => graphData,
    getCommitDetail: (_cwd, hash) => {
      loadedHashes.push(hash);
      return [`Details for ${hash}`];
    },
    requestRender: () => {},
  });

  assert.equal(panel.getSelectedIndex(), 0);

  // Press Down arrow
  const handledDown = panel.handleInput("\x1b[B");
  assert.equal(handledDown, true);
  assert.equal(panel.getSelectedIndex(), 1);
  assert.equal(panel.getSelectedCommit()?.shortHash, "486b5f9");
  assert.ok(loadedHashes.includes("486b5f90441d8d88af165262ae41b6261d80b896"));

  // Press Up arrow
  const handledUp = panel.handleInput("\x1b[A");
  assert.equal(handledUp, true);
  assert.equal(panel.getSelectedIndex(), 0);
  assert.equal(panel.getSelectedCommit()?.shortHash, "2d271f8");

  // Home / End keys
  panel.handleInput("\x1b[F"); // End
  assert.equal(panel.getSelectedIndex(), 3);
  panel.handleInput("\x1b[H"); // Home
  assert.equal(panel.getSelectedIndex(), 0);
});

test("DcGitGraphPanel scrolling right pane does not alter selected commit", () => {
  const graphData = parseGitGraph(sampleGitLog, undefined, "main");
  const manyLines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);

  const panel = new DcGitGraphPanel({
    cwd: "/fake/repo",
    theme: dummyTheme,
    getGraphData: () => graphData,
    getCommitDetail: () => manyLines,
    requestRender: () => {},
  });

  assert.equal(panel.getSelectedIndex(), 0);
  assert.equal(panel.getDetailScrollOffset(), 0);

  // PageDown scrolls the detail pane
  panel.handleInput("\x1b[6~"); // PageDown
  assert.equal(panel.getSelectedIndex(), 0); // Selection UNCHANGED
  assert.ok(panel.getDetailScrollOffset() > 0);

  // PageUp scrolls back up
  panel.handleInput("\x1b[5~"); // PageUp
  assert.equal(panel.getSelectedIndex(), 0);
  assert.equal(panel.getDetailScrollOffset(), 0);
});

test("DcGitGraphPanel mouse interaction: click selects commit and wheel on right pane scrolls detail", () => {
  const graphData = parseGitGraph(sampleGitLog, undefined, "main");
  const manyLines = Array.from({ length: 40 }, (_, i) => `diff line ${i + 1}`);

  const panel = new DcGitGraphPanel({
    cwd: "/fake/repo",
    theme: dummyTheme,
    getGraphData: () => graphData,
    getCommitDetail: () => manyLines,
    requestRender: () => {},
  });

  panel.render(100);

  // Click on row in left pane (y=4 corresponding to commit 1, after header rows)
  panel.handleMouse({
    type: "click",
    button: "left",
    x: 5,
    y: 4,
  } as unknown as TuiMouseEvent);

  // Mouse wheel on right pane (x=80 > leftW) scrolls diff without altering selection
  const currentSel = panel.getSelectedIndex();
  panel.handleMouse({
    type: "wheel",
    wheelDelta: 1,
    x: 80,
    y: 10,
  } as unknown as TuiMouseEvent);

  assert.equal(panel.getSelectedIndex(), currentSel);
  assert.ok(panel.getDetailScrollOffset() > 0);
});

test("DcGitGraphPanel handles empty history and error state gracefully", () => {
  const emptyData: GitGraphData = {
    rows: [],
    commits: [],
    currentBranch: "main",
  };

  const panel = new DcGitGraphPanel({
    cwd: "/fake/repo",
    theme: dummyTheme,
    getGraphData: () => emptyData,
    getCommitDetail: () => ["(sin commits)"],
    requestRender: () => {},
  });

  assert.equal(panel.getSelectedIndex(), -1);
  assert.equal(panel.getSelectedCommit(), undefined);

  const lines = panel.render(80);
  assert.ok(lines.some((l) => l.includes("sin commits") || l.includes("vacío")));
});

test("DcGitGraphPanel respects initialSelectedHash and left pane mouse wheel", () => {
  const graphData = parseGitGraph(sampleGitLog, undefined, "main");
  let renders = 0;

  const panel = new DcGitGraphPanel({
    cwd: "/fake/repo",
    theme: dummyTheme,
    initialSelectedHash: "fa1b8c6",
    getGraphData: () => graphData,
    getCommitDetail: (_cwd, hash) => [`commit ${hash}`],
    requestRender: () => { renders++; },
  });

  // Selected index should be 2 (hash fa1b8c6)
  assert.equal(panel.getSelectedIndex(), 2);
  assert.equal(panel.getSelectedCommit()?.shortHash, "fa1b8c6");

  // Wheel down on left pane (x=10 <= leftW) moves selection to next commit
  panel.handleMouse({
    type: "wheel",
    wheelDelta: 1,
    x: 10,
    y: 5,
  } as unknown as TuiMouseEvent);

  assert.equal(panel.getSelectedIndex(), 3);
  assert.equal(panel.getSelectedCommit()?.shortHash, "5fa11ee");

  // Wheel up on left pane moves selection back
  panel.handleMouse({
    type: "wheel",
    wheelDelta: -1,
    x: 10,
    y: 5,
  } as unknown as TuiMouseEvent);

  assert.equal(panel.getSelectedIndex(), 2);
  assert.ok(renders >= 2);
});

test("dc-git helpers: getGitCommitDetail, getGitCommitGraph, getGitHeadHash, getGitCurrentBranch", () => {
  // Real repo read-only checks
  const headHash = getGitHeadHash(process.cwd());
  assert.ok(typeof headHash === "string" && headHash.length >= 7);

  const branch = getGitCurrentBranch(process.cwd());
  assert.ok(typeof branch === "string" && branch.length > 0);

  const graph = getGitCommitGraph(process.cwd(), 5);
  assert.ok(typeof graph === "string" && graph.includes("COMMIT_REC:"));

  const detail = getGitCommitDetail(process.cwd(), headHash, 10);
  assert.ok(Array.isArray(detail) && detail.length > 0);
  assert.ok(detail.some((l: string) => l.includes("commit ") || l.includes("Author:")));

  // Truncation check
  const truncated = getGitCommitDetail(process.cwd(), headHash, 2);
  assert.ok(truncated.length <= 4);
  assert.ok(truncated.some((l: string) => l.includes("diff truncado")));

  // Nonexistent commit or invalid hash
  const invalidDetail = getGitCommitDetail(process.cwd(), "invalid-nonexistent-sha");
  assert.ok(invalidDetail.some((l: string) => l.includes("error") || l.includes("falló")));

  // Empty commit hash
  const emptyDetail = getGitCommitDetail(process.cwd(), "");
  assert.ok(emptyDetail.some((l: string) => l.includes("no hay commit seleccionado")));

  // Invalid dir returns safe fallbacks
  assert.equal(getGitCommitGraph("/nonexistent-dc-path-12345"), "");
  assert.equal(getGitHeadHash("/nonexistent-dc-path-12345"), undefined);
});

test("openGitGraphViewer opens modal via openDcModal", async () => {
  let customCalls = 0;
  let capturedTitle = "";

  const mockCtx = {
    hasUI: true,
    mode: "tui",
    cwd: process.cwd(),
    ui: {
      custom: async (factory: any) => {
        customCalls++;
        const mockTui = {
          requestRender() {},
          terminal: { rows: 40, columns: 80 },
        };
        const done = (_val?: any) => {};
        const windowComp = factory(mockTui, dummyTheme, {}, done);
        const rendered = windowComp.render?.(80)?.join("\n") || "";
        capturedTitle = rendered;
        done(undefined);
        return undefined;
      },
      notify: () => {},
    },
  };

  await openGitGraphViewer(mockCtx as any);

  assert.equal(customCalls, 1);
  assert.ok(capturedTitle.includes("Git Graph") || capturedTitle.includes("Branch"));
});

test("dcGitGraphExtension registers dc-git-graph command and alt+h shortcut", () => {
  const registeredCommands: string[] = [];
  let registeredShortcut: string | undefined;

  const mockPi = {
    registerCommand(name: string) {
      registeredCommands.push(name);
    },
    registerShortcut(name: string) {
      registeredShortcut = name;
    },
  } as unknown as any;

  dcGitGraphExtension(mockPi);

  assert.ok(registeredCommands.includes("dc-git-graph"));
  assert.equal(registeredShortcut, "alt+h");
});

test("parseGitGraph classifies commit kinds (head, merge, remote-tip, commit) and parses workingTreeStatus", () => {
  const customLog = [
    "*   COMMIT_REC:1111111\x1f1111111\x1f (HEAD -> main)\x1fnormal head commit\x1fDev\x1f2026-09-28",
    "| * COMMIT_REC:2222222\x1f2222222\x1f (origin/feat-branch)\x1fremote tip commit\x1fDev\x1f2026-09-27",
    "* | COMMIT_REC:3333333\x1f3333333\x1f\x1fMerge pull request #10 from dev\x1fDev\x1f2026-09-26",
    "* COMMIT_REC:4444444\x1f4444444\x1f\x1fregular commit\x1fDev\x1f2026-09-25",
  ].join("\n");

  const wtStatus = {
    modifiedCount: 4,
    untrackedCount: 2,
    summaryText: "@ 4 mod » ?2 untracked",
    diffStat: "9 files · +662 -14",
  };

  const data = parseGitGraph(customLog, undefined, "feat/sidebar", wtStatus);

  assert.equal(data.currentBranch, "feat/sidebar");
  assert.deepEqual(data.workingTreeStatus, wtStatus);

  // 1. HEAD commit
  assert.equal(data.commits[0]!.commitKind, "head");
  assert.equal(data.commits[0]!.isHead, true);

  // 2. Remote tip commit (origin/...)
  assert.equal(data.commits[1]!.commitKind, "remote-tip");
  assert.equal(data.commits[1]!.isRemoteTip, true);

  // 3. Merge commit
  assert.equal(data.commits[2]!.commitKind, "merge");
  assert.equal(data.commits[2]!.isMerge, true);

  // 4. Regular commit
  assert.equal(data.commits[3]!.commitKind, "commit");
});

test("DcGitGraphPanel renders enriched status header, glyphs (M, o, *), #shortHash, and bottom summary line", () => {
  const customLog = [
    "*   COMMIT_REC:aaa1111\x1faaa1111\x1f (HEAD -> feat/sidebar)\x1fhead commit\x1fAlice\x1f2026-09-28",
    "| * COMMIT_REC:bbb2222\x1fbbb2222\x1f (origin/remote-branch)\x1fremote branch tip\x1fBob\x1f2026-09-27",
    "* | COMMIT_REC:ccc3333\x1fccc3333\x1f\x1fMerge pull request #85 from cinta\x1fCharlie\x1f2026-09-26",
  ].join("\n");

  const wtStatus = {
    modifiedCount: 4,
    untrackedCount: 2,
    summaryText: "@ 4 mod » ?2 untracked",
    diffStat: "9 files changed, 662 insertions(+)",
  };

  const graphData = parseGitGraph(customLog, undefined, "feat/sidebar", wtStatus);

  const panel = new DcGitGraphPanel({
    cwd: "/fake/repo",
    theme: dummyTheme,
    getGraphData: () => graphData,
    getCommitDetail: () => ["diff --git a/file b/file", "+hello"],
    requestRender: () => {},
  });

  const lines = panel.render(100);

  // Header must contain enriched branch and status (1/3 left)
  assert.ok(lines[0]?.includes("feat/sidebar"), "Header must include branch name");
  assert.ok(lines[0]?.includes("4 mod") || lines[0]?.includes("4m"), "Header must include modified count");
  assert.ok(lines[0]?.includes("?2 untracked") || lines[0]?.includes("?2u"), "Header must include untracked count");

  // Commits must be formatted with #shortHash
  assert.ok(lines.some((l) => l.includes("#aaa1111")), "Commit hash must have # prefix");
  assert.ok(lines.some((l) => l.includes("#bbb2222")), "Remote tip hash must have # prefix");
  assert.ok(lines.some((l) => l.includes("#ccc3333")), "Merge commit hash must have # prefix");

  // Merge commit must display M glyph
  assert.ok(lines.some((l) => l.includes("M") && l.includes("#ccc3333")), "Merge commit must have M node glyph");

  // Remote tip must display o glyph
  assert.ok(lines.some((l) => l.includes("o") && l.includes("#bbb2222")), "Remote tip must have o node glyph");

  // Refs must be wrapped in parentheses
  assert.ok(lines.some((l) => l.includes("(HEAD -> feat/sidebar)")), "Refs must be in parentheses");

  // Commit detail must render file info
  assert.ok(lines.some((l) => l.includes("file")), "Commit detail must render file info");
});

test("DcGitGraphPanel organizes diff body by file tabs and renders dc-code box with green/red shading", () => {
  const multiFileRaw = [
    "commit 84ea56e12345678",
    "Author: Developer <dev@test.com>",
    "Date:   Mon Sep 28 18:54:47 2026 -0500",
    "",
    "    feat: support file tabs and code block",
    "---",
    " src/fileA.ts | 4 ++--",
    " src/fileB.ts | 2 +-",
    " 2 files changed, 3 insertions(+), 3 deletions(-)",
    "",
    "diff --git a/src/fileA.ts b/src/fileA.ts",
    "index 111..222 100644",
    "--- a/src/fileA.ts",
    "+++ b/src/fileA.ts",
    "@@ -10,2 +10,2 @@",
    "-oldLineA",
    "+newLineA",
    "diff --git a/src/fileB.ts b/src/fileB.ts",
    "index 333..444 100644",
    "--- a/src/fileB.ts",
    "+++ b/src/fileB.ts",
    "@@ -20,2 +20,2 @@",
    "-oldLineB",
    "+newLineB",
  ];

  const graphData = parseGitGraph("* COMMIT_REC:84ea56e\x1f84ea56e\x1f (HEAD -> main)\x1ffeat: commit\x1fDev\x1f2026-09-28");

  const panel = new DcGitGraphPanel({
    cwd: "/fake/repo",
    theme: dummyTheme,
    getGraphData: () => graphData,
    getCommitDetail: () => multiFileRaw,
    requestRender: () => {},
  });

  // Initial render: active file is 0 (fileA.ts)
  assert.equal(panel.getActiveFileIndex(), 0);
  let lines = panel.render(120);

  // Must render header card
  assert.ok(lines.some((l) => l.includes("📌 Commit #84ea56e")));
  assert.ok(lines.some((l) => l.includes("👤 Developer")));

  // Must render file tabs in body
  assert.ok(lines.some((l) => l.includes("fileA.ts") && l.includes("fileB.ts")));

  // Must render dc-code box with fileA title and rounded corners
  assert.ok(lines.some((l) => l.includes("╭─") && l.includes("fileA.ts")));
  assert.ok(lines.some((l) => l.includes("╰─") && l.includes("📋")));

  // Switch to file tab 1 (fileB.ts) with ]
  panel.handleInput("]");
  assert.equal(panel.getActiveFileIndex(), 1);

  lines = panel.render(120);
  // Now dc-code box must display fileB.ts
  assert.ok(lines.some((l) => l.includes("╭─") && l.includes("fileB.ts")));

  // Switch back with [
  panel.handleInput("[");
  assert.equal(panel.getActiveFileIndex(), 0);

  // Switch to file tab 1 with Ctrl+Right (\x1b[1;5C)
  panel.handleInput("\x1b[1;5C");
  assert.equal(panel.getActiveFileIndex(), 1, "Ctrl+Right must switch to fileB.ts");

  // Switch back to file tab 0 with Ctrl+Left (\x1b[1;5D)
  panel.handleInput("\x1b[1;5D");
  assert.equal(panel.getActiveFileIndex(), 0, "Ctrl+Left must switch back to fileA.ts");

  // Test Ctrl+Down / Ctrl+Up diff scrolling
  assert.equal(panel.getDetailScrollOffset(), 0);
  panel.handleInput("\x1b[1;5B"); // Ctrl+Down
  // Offset increases
  panel.handleInput("\x1b[1;5A"); // Ctrl+Up
  assert.equal(panel.getDetailScrollOffset(), 0);
});

test("DcGitGraphPanel wordwraps long commit subjects and descriptions in header card without truncation", () => {
  const longRaw = [
    "commit a1b2c3d4e5f6789",
    "Author: Lead Architect <arch@dc.studio>",
    "Date:   Mon Sep 28 20:00:00 2026 -0500",
    "",
    "    feat(git-graph): redesign modal with 1/3 tree, 2/3 friendly detail card, and green/red shaded diff",
    "    This is an extended explanation of the architectural refactoring to wrap headers and increase window height.",
    "---",
    " src/file.ts | 2 +-",
    " 1 file changed, 1 insertion(+), 1 deletion(-)",
    "",
    "diff --git a/src/file.ts b/src/file.ts",
    "index 111..222 100644",
    "--- a/src/file.ts",
    "+++ b/src/file.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ];

  const graphData = parseGitGraph("* COMMIT_REC:a1b2c3d\x1fa1b2c3d\x1f (HEAD -> main)\x1ffeat: long\x1fDev\x1f2026-09-28");

  const panel = new DcGitGraphPanel({
    cwd: "/fake/repo",
    theme: dummyTheme,
    maxRows: 24,
    getGraphData: () => graphData,
    getCommitDetail: () => longRaw,
    requestRender: () => {},
  });

  const lines = panel.render(95);

  // Both parts of wrapped subject must be rendered
  assert.ok(lines.some((l) => l.includes("redesign modal with 1/3 tree")));
  assert.ok(lines.some((l) => l.includes("friendly detail card")));

  // Body paragraph must be rendered
  assert.ok(lines.some((l) => l.includes("extended explanation of the architectural")));
  assert.ok(lines.some((l) => l.includes("increase window")));
});

test("DcGitGraphPanel scrolls file tabs horizontally in a sliding window to keep active tab visible", () => {
  const raw8Files = [
    "commit c1c2c3c4",
    "Author: Dev <dev@test.com>",
    "Date:   Mon Sep 28 20:30:00 2026 -0500",
    "",
    "    feat: commit touching 8 files",
    "---",
    " file1.ts | 2 +-",
    " file2.ts | 2 +-",
    " file3.ts | 2 +-",
    " file4.ts | 2 +-",
    " file5.ts | 2 +-",
    " file6.ts | 2 +-",
    " file7.ts | 2 +-",
    " file8.ts | 2 +-",
    " 8 files changed, 8 insertions(+), 8 deletions(-)",
    "",
    "diff --git a/file1.ts b/file1.ts",
    "@@ -1 +1 @@",
    "+1",
    "diff --git a/file2.ts b/file2.ts",
    "@@ -1 +1 @@",
    "+2",
    "diff --git a/file3.ts b/file3.ts",
    "@@ -1 +1 @@",
    "+3",
    "diff --git a/file4.ts b/file4.ts",
    "@@ -1 +1 @@",
    "+4",
    "diff --git a/file5.ts b/file5.ts",
    "@@ -1 +1 @@",
    "+5",
    "diff --git a/file6.ts b/file6.ts",
    "@@ -1 +1 @@",
    "+6",
    "diff --git a/file7.ts b/file7.ts",
    "@@ -1 +1 @@",
    "+7",
    "diff --git a/file8.ts b/file8.ts",
    "@@ -1 +1 @@",
    "+8",
  ];

  const graphData = parseGitGraph("* COMMIT_REC:c1c2c3c\x1fc1c2c3c\x1f (HEAD -> main)\x1ffeat: 8 files\x1fDev\x1f2026-09-28");

  const panel = new DcGitGraphPanel({
    cwd: "/fake/repo",
    theme: dummyTheme,
    getGraphData: () => graphData,
    getCommitDetail: () => raw8Files,
    requestRender: () => {},
  });

  // At file 0: shows file1.ts, and right indicator ▶ +N
  let lines = panel.render(100);
  assert.ok(lines.some((l) => l.includes("file1.ts")));
  assert.ok(lines.some((l) => l.includes("▶")));

  // Navigate to file 7 (last)
  for (let i = 0; i < 7; i++) {
    panel.handleInput("]");
  }
  assert.equal(panel.getActiveFileIndex(), 7);

  // At file 7: shows left indicator +N ◀ and file8.ts
  lines = panel.render(100);
  assert.ok(lines.some((l) => l.includes("file8.ts")));
  assert.ok(lines.some((l) => l.includes("◀")));
});
