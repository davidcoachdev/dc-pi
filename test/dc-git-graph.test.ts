import test from "node:test";
import assert from "node:assert/strict";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import {
  parseGitGraph,
  DcGitGraphPanel,
  openGitGraphViewer,
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

  // Render output contains two columns separated by vertical divider
  const lines = panel.render(100);
  assert.ok(lines.length > 5);
  assert.ok(lines.some((l) => l.includes("│"))); // divider
  assert.ok(lines.some((l) => l.includes("Branch:") || l.includes("main")));
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
