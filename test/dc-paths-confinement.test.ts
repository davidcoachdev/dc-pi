import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  isPathWithinRoot,
  resolveExistingAncestorRealpath,
  assertPathWithinRoots,
} from "../src/core/dc-path-confinement.ts";
import {
  ensureDirectory,
  ensureParentDirectory,
  getDcAgentsPaths,
  getDcControlPaths,
  getDcStudioDir,
  getDcTaxisPaths,
  resolveExistingAgentWorktreePath,
  resolveSettingsFilePath,
} from "../src/core/dc-paths.ts";
import { appendTaxiLog, readRecentTaxiLogs } from "../src/features/dc-agents/core/dc-taxi-logger.ts";
import { loadDcAgentsConfig, saveDcAgentsConfig } from "../src/features/dc-agents/core/dc-effort-policy.ts";
import { DEFAULT_DC_AGENTS_CONFIG } from "../src/features/dc-agents/core/dc-ephemeral-types.ts";
import { DcRemoteQuestionManager } from "../src/features/dc-agents/daemon/dc-remote-question.ts";
import { extractPdf } from "../src/features/dc-pdf/core/dc-pdf-extractor.ts";
import { capturePageScreenshot } from "../src/features/dc-browser/core/dc-browser-cdp.ts";

function withTempAgentDir<T>(fn: (tmpAgentDir: string) => T): T {
  const tmpAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-paths-test-"));
  const prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  const prevSocket = process.env.DC_SUPERVISOR_SOCKET;
  const prevPid = process.env.DC_SUPERVISOR_PID;
  process.env.PI_CODING_AGENT_DIR = tmpAgentDir;
  delete process.env.DC_SUPERVISOR_SOCKET;
  delete process.env.DC_SUPERVISOR_PID;
  try {
    return fn(tmpAgentDir);
  } finally {
    if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
    if (prevSocket === undefined) delete process.env.DC_SUPERVISOR_SOCKET;
    else process.env.DC_SUPERVISOR_SOCKET = prevSocket;
    if (prevPid === undefined) delete process.env.DC_SUPERVISOR_PID;
    else process.env.DC_SUPERVISOR_PID = prevPid;
    fs.rmSync(tmpAgentDir, { recursive: true, force: true });
  }
}

test("S4: isPathWithinRoot accepts in-root paths and rejects traversal/prefix tricks", () => {
  const base = path.resolve("/tmp/dc-confinement-root");
  assert.equal(isPathWithinRoot(base, base), true);
  assert.equal(isPathWithinRoot(base, path.join(base, "sub", "file.txt")), true);
  assert.equal(isPathWithinRoot(base, path.join(base, "..hidden-file")), true);

  assert.equal(isPathWithinRoot(base, path.join(base, "..", "escape.txt")), false);
  assert.equal(isPathWithinRoot(base, `${base}-sibling/file.txt`), false);
  assert.equal(isPathWithinRoot(base, "/etc/passwd"), false);
});

test("S4: resolveExistingAncestorRealpath and assertPathWithinRoots accept in-root files and reject traversal & symlink escapes", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dc-confinement-"));
  const allowedRoot = path.join(sandbox, "allowed");
  const outsideRoot = path.join(sandbox, "outside");
  fs.mkdirSync(allowedRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });

  try {
    const insideFile = path.join(allowedRoot, "doc.pdf");
    fs.writeFileSync(insideFile, "ok", "utf8");
    const nonExistentInside = path.join(allowedRoot, "nested", "future", "out.png");

    // In-root existing & non-existent files are accepted
    assert.equal(assertPathWithinRoots(insideFile, [allowedRoot], "archivo"), path.resolve(insideFile));
    assert.equal(assertPathWithinRoots(nonExistentInside, [allowedRoot], "salida"), path.resolve(nonExistentInside));

    // Lexical traversal outside allowed root is rejected
    const traversalTarget = path.join(allowedRoot, "..", "outside", "secret.txt");
    assert.throws(
      () => assertPathWithinRoots(traversalTarget, [allowedRoot], "archivo"),
      /fuera de los directorios permitidos/i,
    );

    // Symlink pointing to existing outside file is rejected
    const outsideSecret = path.join(outsideRoot, "secret.txt");
    fs.writeFileSync(outsideSecret, "secret", "utf8");
    const symlinkFile = path.join(allowedRoot, "link-secret.txt");
    fs.symlinkSync(outsideSecret, symlinkFile);

    assert.equal(resolveExistingAncestorRealpath(symlinkFile), fs.realpathSync(outsideSecret));
    assert.throws(
      () => assertPathWithinRoots(symlinkFile, [allowedRoot], "archivo"),
      /symlinks/i,
    );

    // Symlink directory pointing outside with non-existent child is rejected
    const symlinkDir = path.join(allowedRoot, "link-dir");
    fs.symlinkSync(outsideRoot, symlinkDir);
    const childThroughSymlinkDir = path.join(symlinkDir, "new-dir", "escape.png");
    assert.equal(
      resolveExistingAncestorRealpath(childThroughSymlinkDir),
      path.join(fs.realpathSync(outsideRoot), "new-dir", "escape.png"),
    );
    assert.throws(
      () => assertPathWithinRoots(childThroughSymlinkDir, [allowedRoot], "salida"),
      /symlinks/i,
    );

    // Dangling symlink pointing to non-existent file outside allowed root is rejected
    const danglingLink = path.join(allowedRoot, "dangling-out.png");
    const outsideNonExistent = path.join(outsideRoot, "does-not-exist.png");
    fs.symlinkSync(outsideNonExistent, danglingLink);
    assert.equal(
      resolveExistingAncestorRealpath(danglingLink),
      path.join(fs.realpathSync(outsideRoot), "does-not-exist.png"),
    );
    assert.throws(
      () => assertPathWithinRoots(danglingLink, [allowedRoot], "salida"),
      /symlinks/i,
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("S4: relative dangling symlink under symlinked parent dir resolves against real parent and is rejected", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dc-confinement-rel-dangling-"));
  const allowed = path.join(sandbox, "allowed");
  const outsideAB = path.join(sandbox, "outside", "a", "b");
  fs.mkdirSync(allowed, { recursive: true });
  fs.mkdirSync(outsideAB, { recursive: true });

  try {
    // allowed/sub -> outside/a/b
    fs.symlinkSync(outsideAB, path.join(allowed, "sub"));
    // outside/a/b/dangling -> ../pwned (dangling relative symlink)
    fs.symlinkSync("../pwned", path.join(outsideAB, "dangling"));

    const target = path.join(allowed, "sub", "dangling");
    const expectedRealTarget = path.join(fs.realpathSync(path.join(sandbox, "outside", "a")), "pwned");
    assert.equal(resolveExistingAncestorRealpath(target), expectedRealTarget);
    assert.throws(
      () => assertPathWithinRoots(target, [allowed], "salida"),
      /symlinks/i,
    );

    // Dangling symlink cycle must fail safely with loop protection
    const cycleA = path.join(allowed, "cycle-a");
    const cycleB = path.join(allowed, "cycle-b");
    fs.symlinkSync("cycle-b", cycleA);
    fs.symlinkSync("cycle-a", cycleB);
    assert.throws(
      () => resolveExistingAncestorRealpath(cycleA),
      /enlaces simbólicos/i,
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("S4: dc-pdf and dc-browser enforce symlink escape confinement via shared dc-path-confinement", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dc-confinement-consumers-"));
  const workDir = path.join(sandbox, "work");
  fs.mkdirSync(workDir, { recursive: true });
  const linkToEtc = path.join(workDir, "etc-link");
  fs.symlinkSync("/etc", linkToEtc);

  try {
    await assert.rejects(
      async () => {
        await extractPdf({ path: path.join(linkToEtc, "hosts"), cwd: workDir });
      },
      /denegad|fuera|symlinks/i,
    );

    await assert.rejects(
      async () => {
        await capturePageScreenshot({ cwd: workDir, outputPath: path.join(linkToEtc, "evil.png") });
      },
      /denegad|fuera|symlinks/i,
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("S4: src/core/dc-path-confinement.ts has zero Pi or pi-tui imports (Dir #1)", () => {
  const source = fs.readFileSync(path.resolve("src/core/dc-path-confinement.ts"), "utf8");
  assert.doesNotMatch(source, /@earendil-works\/pi-|pi-coding-agent|pi-tui/);
});

test("S5: resolveSettingsFilePath honors PI_CODING_AGENT_DIR and feature callers delegate to dc-paths.ts", () => {
  withTempAgentDir((tmpAgentDir) => {
    const expected = path.join(tmpAgentDir, "settings.json");
    assert.equal(resolveSettingsFilePath(), expected);
  });

  const dcModelsSrc = fs.readFileSync(path.resolve("src/features/dc-models/dc-models.ts"), "utf8");
  assert.match(dcModelsSrc, /resolveSettingsFilePath.*from "\.\.\/\.\.\/core\/dc-paths\.ts"/);
  assert.doesNotMatch(dcModelsSrc, /\bSETTINGS_FILE\b/);

  const profileProviderSrc = fs.readFileSync(
    path.resolve("src/features/dc-sidebar/providers/dc-profile-provider.ts"),
    "utf8",
  );
  assert.match(profileProviderSrc, /resolveSettingsFilePath.*from "\.\.\/\.\.\/\.\.\/core\/dc-paths\.ts"/);
  assert.doesNotMatch(profileProviderSrc, /os\.homedir\(\),\s*"\.pi",\s*"agent",\s*"settings\.json"/);

  const noTelemetrySrc = fs.readFileSync(
    path.resolve("src/integrations/dc-no-telemetry/dc-no-telemetry.ts"),
    "utf8",
  );
  assert.match(noTelemetrySrc, /resolveSettingsFilePath.*from "\.\.\/\.\.\/core\/dc-paths\.ts"/);
  assert.doesNotMatch(noTelemetrySrc, /os\.homedir\(\)/);

  const quotaProviderSrc = fs.readFileSync(
    path.resolve("src/features/dc-sidebar/providers/dc-quota-provider.ts"),
    "utf8",
  );
  assert.match(quotaProviderSrc, /resolveSettingsFilePath.*from "\.\.\/\.\.\/\.\.\/core\/dc-paths\.ts"/);
  assert.doesNotMatch(quotaProviderSrc, /process\.env\.PI_CODING_AGENT_DIR/);

  const splitBrainFiles = [
    "src/features/dc-agents/dc-agents.ts",
    "src/features/dc-agents/core/dc-taxi-dispatcher.ts",
    "src/features/dc-agents/core/dc-taxi-supervisor.ts",
    "src/features/dc-agents/core/dc-taxi-workshop.ts",
    "src/features/dc-agents/core/dc-taxi-logger.ts",
    "src/features/dc-agents/core/dc-effort-policy.ts",
    "src/features/dc-agents/core/dc-worktree-manager.ts",
    "src/features/dc-agents/daemon/dc-remote-question.ts",
    "src/features/dc-agents/daemon/dc-pending-issues.ts",
    "src/features/dc-agents/daemon/dc-pr-conflict-resolver.ts",
    "src/features/dc-agents/daemon/dc-issue-comment-router.ts",
    "src/features/dc-agents/views/dc-control-center-modal.ts",
    "src/features/dc-control/core/dc-supervisor-launcher.ts",
  ];

  for (const relPath of splitBrainFiles) {
    const src = fs.readFileSync(path.resolve(relPath), "utf8");
    assert.doesNotMatch(
      src,
      /os\.homedir\(\)[^;\n]*dc-studio/,
      `${relPath} must not hardcode os.homedir()/.../dc-studio paths`,
    );
  }
});

test("S5: ensureDirectory and ensureParentDirectory create directories idempotently", () => {
  withTempAgentDir((tmpAgentDir) => {
    const nestedFile = path.join(tmpAgentDir, "a", "b", "c.json");
    const parent = ensureParentDirectory(nestedFile);
    assert.equal(parent, path.dirname(nestedFile));
    assert.equal(fs.existsSync(parent), true);

    const directDir = path.join(tmpAgentDir, "direct", "dir");
    const createdDir = ensureDirectory(directDir, false);
    assert.equal(createdDir, directDir);
    assert.equal(fs.existsSync(directDir), true);
  });
});

test("S5: canonical getDcTaxisPaths, getDcAgentsPaths and getDcControlPaths resolve under PI_CODING_AGENT_DIR/dc-studio with zero split-brain", () => {
  withTempAgentDir((tmpAgentDir) => {
    const studioDir = path.join(tmpAgentDir, "dc-studio");
    assert.equal(getDcStudioDir(), studioDir);

    const taxis = getDcTaxisPaths();
    assert.equal(taxis.dir, path.join(studioDir, "taxis"));
    assert.equal(taxis.fleetState, path.join(studioDir, "taxis", "fleet.json"));
    assert.equal(taxis.log, path.join(studioDir, "taxis", "taxis.log"));

    const agents = getDcAgentsPaths();
    assert.equal(agents.dir, path.join(studioDir, "agents"));
    assert.equal(agents.config, path.join(studioDir, "agents", "config.json"));
    assert.equal(agents.worktreesDir, path.join(studioDir, "agents", "worktrees"));
    assert.equal(agents.questionsDir, path.join(studioDir, "agents", "questions"));
    assert.equal(agents.answersDir, path.join(studioDir, "agents", "answers"));

    const control = getDcControlPaths();
    assert.equal(control.dir, path.join(studioDir, "control"));
    assert.equal(control.socket, path.join(studioDir, "control", "supervisor.sock"));
    assert.equal(control.pid, path.join(studioDir, "control", "supervisor.pid"));
    assert.equal(control.daemonEntry, path.join(studioDir, "control", "daemon-entry.js"));

    // Consumers write to the exact canonical paths (no legacy split-brain files created)
    appendTaxiLog("INFO", "CANONICAL_LOG_TEST", { ok: true });
    assert.equal(fs.existsSync(taxis.log), true);
    assert.equal(fs.existsSync(path.join(studioDir, "dc-taxis.log")), false);
    assert.ok(readRecentTaxiLogs(5).some((line) => line.includes("CANONICAL_LOG_TEST")));

    saveDcAgentsConfig(DEFAULT_DC_AGENTS_CONFIG);
    assert.equal(fs.existsSync(agents.config), true);
    assert.equal(fs.existsSync(path.join(studioDir, "dc-agents.json")), false);
    assert.deepEqual(loadDcAgentsConfig().routing, DEFAULT_DC_AGENTS_CONFIG.routing);

    const qm = new DcRemoteQuestionManager();
    const pkt = qm.postQuestion({
      id: "q-canonical-1",
      issueNumber: 77,
      issueTitle: "Canonical test",
      contextSummary: "ctx",
      question: "Proceed?",
    });
    assert.equal(fs.existsSync(path.join(agents.questionsDir, `${pkt.id}.json`)), true);
    assert.equal(fs.existsSync(path.join(studioDir, "questions", `${pkt.id}.json`)), false);
  });
});

test("S5: transparent migration preserves legacy dc-taxis.json, dc-taxis.log, dc-agents.json, questions/answers and worktree lookup", () => {
  withTempAgentDir((tmpAgentDir) => {
    const studioDir = path.join(tmpAgentDir, "dc-studio");
    fs.mkdirSync(path.join(studioDir, "questions"), { recursive: true });
    fs.mkdirSync(path.join(studioDir, "answers"), { recursive: true });
    fs.mkdirSync(path.join(studioDir, "worktrees", "dc-pi", "issue-42-ghissue1"), { recursive: true });

    fs.writeFileSync(path.join(studioDir, "dc-taxis.json"), JSON.stringify({ fleet: { ac01: { status: "libre" } } }), "utf8");
    fs.writeFileSync(path.join(studioDir, "dc-taxis.log"), "[2026] [INFO] LEGACY_LOG\n", "utf8");
    fs.writeFileSync(path.join(studioDir, "dc-agents.json"), JSON.stringify({ routing: { defaultSubagentModel: "gemini-legacy" } }), "utf8");
    fs.writeFileSync(path.join(studioDir, "questions", "q-legacy.json"), JSON.stringify({ id: "q-legacy" }), "utf8");
    fs.writeFileSync(path.join(studioDir, "answers", "q-legacy.json"), JSON.stringify({ questionId: "q-legacy" }), "utf8");

    const taxis = getDcTaxisPaths();
    assert.equal(fs.existsSync(taxis.fleetState), true);
    assert.ok(fs.readFileSync(taxis.fleetState, "utf8").includes("ac01"));
    assert.equal(fs.existsSync(taxis.log), true);
    assert.ok(fs.readFileSync(taxis.log, "utf8").includes("LEGACY_LOG"));

    const agents = getDcAgentsPaths();
    assert.equal(fs.existsSync(agents.config), true);
    assert.ok(fs.readFileSync(agents.config, "utf8").includes("gemini-legacy"));
    assert.equal(fs.existsSync(path.join(agents.questionsDir, "q-legacy.json")), true);
    assert.equal(fs.existsSync(path.join(agents.answersDir, "q-legacy.json")), true);

    // Legacy worktree fallback works when canonical does not exist yet
    const foundLegacy = resolveExistingAgentWorktreePath("dc-pi", "issue-42-ghissue1");
    assert.equal(foundLegacy, path.join(studioDir, "worktrees", "dc-pi", "issue-42-ghissue1"));

    // Canonical worktree takes precedence once present
    const canonicalWt = path.join(agents.worktreesDir, "dc-pi", "issue-42-ghissue1");
    fs.mkdirSync(canonicalWt, { recursive: true });
    const foundCanonical = resolveExistingAgentWorktreePath("dc-pi", "issue-42-ghissue1");
    assert.equal(foundCanonical, canonicalWt);
  });
});
