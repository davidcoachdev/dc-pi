import test from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "dc-agents-home-"));
const previousEnv = { ...process.env };
process.env.HOME = isolatedHome;
process.env.XDG_CONFIG_HOME = path.join(isolatedHome, ".config");
process.env.PI_CODING_AGENT_DIR = path.join(isolatedHome, ".pi", "agent");

const {
  syncDcAgents,
  syncDcSkills,
  getDcBundledAgentsDir,
  getDcBundledSkillsDir,
  getPiTargetSubagentsJson,
} = await import("../src/features/dc-agents/core/dc-agents-sync.ts");
const { loadSubagentsData } = await import("../src/features/dc-agents/core/dc-agents-tasks.ts");
const { DcAgentsPanel } = await import("../src/features/dc-agents/views/dc-agents-panel.ts");

test.after(() => {
  process.env = previousEnv;
  fs.rmSync(isolatedHome, { recursive: true, force: true });
});

test("dc-agents: bundled agents directory exists and contains markdown agents", () => {
  const bundledDir = getDcBundledAgentsDir();
  assert.ok(fs.existsSync(bundledDir), `Bundled directory should exist at ${bundledDir}`);

  const files = fs.readdirSync(bundledDir);
  const expectedAgents = [
    "dc-pr-comment-analyst.md",
    "dc-ui-visual-inspector.md",
    "dc-researcher.md",
    "dc-news-to-day.md",
    "dc-smoke-subagent.md",
    "dc-phase-discovery.md",
    "dc-phase-planning.md",
    "dc-phase-apply.md",
    "dc-phase-verify.md",
  ];

  for (const agent of expectedAgents) {
    assert.ok(files.includes(agent), `Should contain ${agent}`);
  }
});

test("dc-agents: fresh-home sync initializes global config with a separate agents target", (t) => {
  const targetConfig = getPiTargetSubagentsJson();
  const targetDir = path.join(isolatedHome, "custom-agents");
  assert.deepEqual(fs.readdirSync(isolatedHome), []);
  assert.equal(fs.existsSync(path.dirname(targetConfig)), false);

  const firstRun = syncDcAgents(getDcBundledAgentsDir(), targetDir);
  t.diagnostic(`fresh-home result.errors: ${JSON.stringify(firstRun.errors)}`);
  assert.deepEqual(firstRun.errors, [], `Fresh-home sync failed: ${firstRun.errors.join("; ")}`);
  assert.ok(firstRun.synced.includes("subagents.json"));
  const configContent = fs.readFileSync(targetConfig, "utf8");
  assert.equal(JSON.parse(configContent).default_model, undefined);
  assert.ok(fs.existsSync(path.join(targetDir, "dc-smoke-subagent.md")));

  const customAgent = path.join(targetDir, "user-custom.md");
  const settings = path.join(path.dirname(targetConfig), "settings.json");
  const customContent = "# User agent\nKeep my instructions.\n";
  const settingsContent = '{"theme":"user-custom","custom":{"enabled":true}}\n';
  fs.writeFileSync(customAgent, customContent);
  fs.writeFileSync(settings, settingsContent);

  const secondRun = syncDcAgents(getDcBundledAgentsDir(), targetDir);
  assert.deepEqual(secondRun.errors, []);
  assert.deepEqual(secondRun.synced, []);
  assert.ok(secondRun.skipped.includes("subagents.json"));
  assert.equal(fs.readFileSync(targetConfig, "utf8"), configContent);
  assert.equal(fs.readFileSync(customAgent, "utf8"), customContent);
  assert.equal(fs.readFileSync(settings, "utf8"), settingsContent);
});

test("dc-agents: syncDcAgents copies bundled agents idempotently to target directory", () => {
  const tmpTarget = fs.mkdtempSync(path.join(os.tmpdir(), "dc-agents-test-"));

  try {
    const bundledDir = getDcBundledAgentsDir();
    const expectedAgents = [
      "dc-pr-comment-analyst.md",
      "dc-ui-visual-inspector.md",
      "dc-researcher.md",
      "dc-news-to-day.md",
      "dc-smoke-subagent.md",
      "dc-phase-discovery.md",
      "dc-phase-planning.md",
      "dc-phase-apply.md",
      "dc-phase-verify.md",
    ];

    // 1st sync: should copy all expected agents
    const firstRun = syncDcAgents(bundledDir, tmpTarget);
    assert.equal(firstRun.errors.length, 0);
    for (const agent of expectedAgents) {
      assert.ok(firstRun.synced.includes(agent), `First run should sync ${agent}`);
      assert.ok(fs.existsSync(path.join(tmpTarget, agent)), `File should exist at target: ${agent}`);
    }

    // 2nd sync: should skip all (content identical)
    const secondRun = syncDcAgents(bundledDir, tmpTarget);
    assert.equal(secondRun.errors.length, 0);
    assert.equal(secondRun.synced.length, 0);
    for (const agent of expectedAgents) {
      assert.ok(secondRun.skipped.includes(agent), `Second run should skip ${agent}`);
    }
  } finally {
    fs.rmSync(tmpTarget, { recursive: true, force: true });
  }
});

test("dc-skills: syncDcSkills copies bundled skills recursively and idempotently", () => {
  const tmpTarget = fs.mkdtempSync(path.join(os.tmpdir(), "dc-skills-test-"));

  try {
    const bundledSkillsDir = getDcBundledSkillsDir();
    assert.ok(fs.existsSync(bundledSkillsDir), `Skills directory should exist at ${bundledSkillsDir}`);

    const expectedSkills = [
      "acceptance-contract",
      "dc-anti-overengineering",
      "dc-artifact-contracts",
      "dc-e2e-testing",
      "dc-pi-architecture",
      "dc-pi-extension-authoring",
      "dc-planned-workflow",
      "dc-project-documentation",
      "dc-tech-intel-briefing",
      "pr-review-triage",
      "qa-human-recipe",
      "ui-visual-inspector",
    ];

    // 1st sync: should copy all expected skill directories
    const firstRun = syncDcSkills(bundledSkillsDir, tmpTarget);
    assert.equal(firstRun.errors.length, 0);
    for (const skill of expectedSkills) {
      assert.ok(firstRun.synced.includes(skill), `First run should sync skill ${skill}`);
      assert.ok(fs.existsSync(path.join(tmpTarget, skill, "SKILL.md")), `SKILL.md should exist in ${skill}`);
    }

    // Verify recursive sync of subdirectories (e.g. references in dc-project-documentation)
    const docReferencesDir = path.join(tmpTarget, "dc-project-documentation", "references");
    assert.ok(fs.existsSync(docReferencesDir), `references subdirectory should exist in dc-project-documentation`);
    assert.ok(
      fs.existsSync(path.join(docReferencesDir, "document-contract.md")),
      `document-contract.md should exist inside references`,
    );

    // 2nd sync: should skip all (content identical)
    const secondRun = syncDcSkills(bundledSkillsDir, tmpTarget);
    assert.equal(secondRun.errors.length, 0);
    assert.equal(secondRun.synced.length, 0);
    for (const skill of expectedSkills) {
      assert.ok(secondRun.skipped.includes(skill), `Second run should skip skill ${skill}`);
    }
  } finally {
    fs.rmSync(tmpTarget, { recursive: true, force: true });
  }
});

test("dc-agents: loadSubagentsData loads available agents and execution tasks cleanly", () => {
  const data = loadSubagentsData();
  assert.ok(Array.isArray(data.availableAgents));
  assert.ok(Array.isArray(data.executionTasks));
  assert.ok(typeof data.runningCount === "number");
  assert.ok(typeof data.totalExecutions === "number");
});

test("dc-agents: DcAgentsPanel renders without crashing and navigates", () => {
  let doneCalled = false;
  const mockTheme = {
    fg: (_c: string, s: string) => s,
    bg: (_c: string, s: string) => s,
    bold: (s: string) => s,
  };

  const panel = new DcAgentsPanel(mockTheme as any, () => {
    doneCalled = true;
  });

  const lines = panel.render(80);
  assert.ok(lines.length > 0);
  assert.ok(lines[0]?.includes("EJECUCIONES & AGENTES"));

  // Navegación con Tab
  panel.handleInput("\t");
  const tabLines = panel.render(80);
  assert.ok(tabLines.length > 0);

  // Tecla 'r' recarga
  panel.handleInput("r");

  // Tecla 'q' sale
  panel.handleInput("q");
  assert.equal(doneCalled, true);
});
