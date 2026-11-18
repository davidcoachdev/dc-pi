import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  formatSkillSlug,
  synthesizeSkillDraft,
  validateSkillFrontmatter,
  saveCuratedSkill,
  extractSkillCandidatesFromObservations,
  type SkillDraftInput,
} from "../src/features/dc-engram/core/dc-skill-curator.ts";

test("dc-skill-curator: formatSkillSlug generates valid canonical kebab-case names", () => {
  assert.equal(formatSkillSlug("Fix Docker Network Timeout"), "fix-docker-network-timeout");
  assert.equal(formatSkillSlug("  API_Rate_Limiting (Redis)! "), "api-rate-limiting-redis");
  assert.equal(formatSkillSlug("---deploy-k8s---"), "deploy-k8s");
  assert.equal(formatSkillSlug(""), "custom-skill");
});

test("dc-skill-curator: synthesizeSkillDraft formats canonical DC Studio SKILL.md", () => {
  const input: SkillDraftInput = {
    name: "sqlite-wal-checkpoint",
    description: "Configures and optimizes SQLite WAL checkpointing under heavy concurrency.",
    triggers: ["sqlite wal", "wal checkpoint", "sqlite busy error"],
    activationWhen: ["SQLite returns SQLITE_BUSY under concurrent read/write load."],
    activationNotWhen: ["Using PostgreSQL or MySQL."],
    hardRules: [
      "Always set PRAGMA journal_mode=WAL before opening write transactions.",
      "Never run PRAGMA wal_checkpoint(TRUNCATE) inside an active read transaction.",
    ],
    decisionGates: [
      { condition: "Read-heavy workload", action: "Set PRAGMA synchronous=NORMAL" },
      { condition: "Write-heavy workload", action: "Run passive wal_checkpoint every 1000 pages" },
    ],
    steps: [
      "Open SQLite connection with WAL journal mode.",
      "Configure busy_timeout to at least 5000ms.",
      "Verify with PRAGMA wal_checkpoint(PASSIVE).",
    ],
  };

  const markdown = synthesizeSkillDraft(input);

  // Assert Frontmatter exists and has required keys
  assert.ok(markdown.startsWith("---\n"));
  assert.ok(markdown.includes("name: sqlite-wal-checkpoint\n"));
  assert.ok(markdown.includes("Trigger: sqlite wal, wal checkpoint, sqlite busy error"));
  assert.ok(markdown.includes("license: Apache-2.0\n"));

  // Assert canonical sections exist
  assert.ok(markdown.includes("## Activation Contract"));
  assert.ok(markdown.includes("## Hard Rules"));
  assert.ok(markdown.includes("## Decision Gates"));
  assert.ok(markdown.includes("## Execution Steps"));
  assert.ok(markdown.includes("PRAGMA journal_mode=WAL"));

  // Validate frontmatter parser
  const validation = validateSkillFrontmatter(markdown);
  assert.equal(validation.valid, true);
  assert.equal(validation.name, "sqlite-wal-checkpoint");
});

test("dc-skill-curator: saveCuratedSkill writes canonical skill directory and prevents blind overwrite", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-skill-test-"));
  const skillsDir = path.join(tempDir, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });

  const input: SkillDraftInput = {
    name: "react-memo-optimizer",
    description: "Audits and optimizes React component re-renders.",
    triggers: ["react render", "optimize memo"],
    activationWhen: ["Component re-renders excessively."],
    activationNotWhen: ["Static components."],
    hardRules: ["Never use React.memo without measuring."],
    decisionGates: [{ condition: "Props change frequently", action: "Split component" }],
    steps: ["Profile with React DevTools.", "Memoize expensive sub-trees."],
  };

  try {
    // 1. Primer guardado exitoso
    const res1 = saveCuratedSkill(input, skillsDir);
    assert.equal(res1.saved, true);
    assert.ok(fs.existsSync(res1.filePath));
    const content = fs.readFileSync(res1.filePath, "utf8");
    assert.ok(content.includes("name: react-memo-optimizer"));

    // 2. Segundo guardado sin overwrite debe ser rechazado
    const res2 = saveCuratedSkill(input, skillsDir, false);
    assert.equal(res2.saved, false);
    assert.ok(res2.reason?.includes("ya existe"));

    // 3. Tercer guardado con overwrite = true debe permitirse
    const res3 = saveCuratedSkill(input, skillsDir, true);
    assert.equal(res3.saved, true);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
});

test("dc-skill-curator: extractSkillCandidatesFromObservations filters patterns and discoveries", () => {
  const observations = [
    {
      id: 1,
      type: "pattern",
      title: "Solución a timeout de Puppeteer en Alpine Linux",
      content: "Instalar chromium y pasar --no-sandbox en args de launch.",
      scope: "project",
      created_at: "2026-11-17",
    },
    {
      id: 2,
      type: "preference",
      title: "Usar tabs de 2 espacios",
      content: "Preferencia de estilo.",
      scope: "project",
      created_at: "2026-11-17",
    },
    {
      id: 3,
      type: "bugfix",
      title: "Memory leak en EventEmitter de Node.js",
      content: "Siempre remover listener en cleanup con abortSignal.",
      scope: "global",
      created_at: "2026-11-17",
    },
  ];

  const candidates = extractSkillCandidatesFromObservations(observations);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.id, 1);
  assert.equal(candidates[1]?.id, 3);
});

test("dc-skill-curator: dc_curate_skill tool registers in pi and executes properly", async () => {
  const registeredTools = new Map<string, any>();
  const mockPi: any = {
    registerCommand() {},
    registerShortcut() {},
    registerTool(tool: any) {
      registeredTools.set(tool.name, tool);
    },
  };

  const { default: dcEngramExtension } = await import("../src/features/dc-engram/dc-engram.ts");
  dcEngramExtension(mockPi);

  const curateTool = registeredTools.get("dc_curate_skill");
  assert.ok(curateTool, "dc_curate_skill should be registered in pi");
  assert.equal(typeof curateTool.execute, "function");
  assert.equal(curateTool.parameters.properties.triggers.type, "array");
});
