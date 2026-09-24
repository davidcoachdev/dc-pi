import test from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { syncDcAgents, getDcBundledAgentsDir } from "../src/features/dc-agents/core/dc-agents-sync.ts";

test("dc-agents: bundled agents directory exists and contains markdown agents", () => {
  const bundledDir = getDcBundledAgentsDir();
  assert.ok(fs.existsSync(bundledDir), `Bundled directory should exist at ${bundledDir}`);

  const files = fs.readdirSync(bundledDir);
  assert.ok(files.includes("pr-comment-analyst.md"), "Should contain pr-comment-analyst.md");
  assert.ok(files.includes("ui-visual-inspector.md"), "Should contain ui-visual-inspector.md");
});

test("dc-agents: syncDcAgents copies bundled agents idempotently to target directory", () => {
  const tmpTarget = fs.mkdtempSync(path.join(os.tmpdir(), "dc-agents-test-"));

  try {
    const bundledDir = getDcBundledAgentsDir();

    // 1st sync: should copy both
    const firstRun = syncDcAgents(bundledDir, tmpTarget);
    assert.equal(firstRun.errors.length, 0);
    assert.ok(firstRun.synced.includes("pr-comment-analyst.md"));
    assert.ok(firstRun.synced.includes("ui-visual-inspector.md"));

    // Check files exist in target
    assert.ok(fs.existsSync(path.join(tmpTarget, "pr-comment-analyst.md")));
    assert.ok(fs.existsSync(path.join(tmpTarget, "ui-visual-inspector.md")));

    // 2nd sync: should skip both (content identical)
    const secondRun = syncDcAgents(bundledDir, tmpTarget);
    assert.equal(secondRun.errors.length, 0);
    assert.equal(secondRun.synced.length, 0);
    assert.ok(secondRun.skipped.includes("pr-comment-analyst.md"));
    assert.ok(secondRun.skipped.includes("ui-visual-inspector.md"));
  } finally {
    fs.rmSync(tmpTarget, { recursive: true, force: true });
  }
});
