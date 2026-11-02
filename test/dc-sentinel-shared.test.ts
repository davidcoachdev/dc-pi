import { it } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as fs from "node:fs";
import { SentinelDatabase, sentinelNoteFingerprint } from "../src/features/dc-sentinel/core/dc-sentinel-db.ts";
import { performPreFlightRecall, formatRecallPromptSection } from "../src/features/dc-sentinel/core/dc-sentinel-recall.ts";
import { SentinelPanel } from "../src/features/dc-sentinel/views/dc-sentinel-panel.ts";
import { SentinelRecorder } from "../src/features/dc-sentinel/core/dc-sentinel-recorder.ts";
import { SentinelSharedCatalogue } from "../src/features/dc-sentinel/core/dc-sentinel-shared.ts";
import { extractDeterministicNotes } from "../src/features/dc-sentinel/core/dc-sentinel-deterministic-extractor.ts";

const root = path.resolve(process.env.HOME!, "source", "same");
function captured(db: SentinelDatabase, source = root) {
  const notes = extractDeterministicNotes([{
    project_path: source, turnId: "turn", timestamp: "2026-10-31", userPrompt: "fix cache invalidation", errorsDetected: [], subagentsLaunched: [],
    assistantSummary: "Cache invalidation fixed with bounded lookup.",
    toolsExecuted: [
      { project_path: source, callId: "edit", toolName: "edit", args: { path: "src/cache.ts" }, startedAt: 1, endedAt: 2, isError: false },
      { project_path: source, callId: "test", toolName: "bash", args: { command: "npm test" }, startedAt: 3, endedAt: 4, isError: false, outputSnippet: "passed" },
    ],
  }], "same");
  assert.equal(notes.length, 1);
  return db.saveNote(notes[0]!);
}
function approve(note: ReturnType<typeof captured>) {
  return { approved: true as const, revision: note.revisionCount!, fingerprint: note.verification!.fingerprint, applicability: "Check cache lifecycle and rerun project tests." };
}

it("publication requires authoritative current structured evidence, approval and source identity; upsert is idempotent", () => {
  const db = new SentinelDatabase("same", root, true);
  const otherRoot = path.resolve(root, "../../other/same");
  const other = new SentinelDatabase("same", otherRoot, true);
  const catalogue = new SentinelSharedCatalogue(":memory:");
  try {
    const note = captured(db);
    assert.equal(note.verification?.projectPath, root);
    assert.equal(note.verification?.revision, note.revisionCount);
    assert.throws(() => catalogue.publish(db, note.id!, { ...approve(note), approved: false }));
    catalogue.publish(db, note.id!, approve(note));
    catalogue.publish(db, note.id!, approve(note));
    assert.equal(catalogue.search("cache").length, 1);
    const second = captured(other, otherRoot);
    catalogue.publish(other, second.id!, approve(second));
    assert.equal(catalogue.search("cache").length, 2, "same basename and note ID are distinct sources");
    const refreshed = captured(db);
    const nextPayload = { ...refreshed, normalizedHash: undefined, content: "cache verified newer revision" };
    const next = db.saveNote({ ...nextPayload, verification: { ...refreshed.verification!, revision: 0, fingerprint: sentinelNoteFingerprint(nextPayload) } });
    assert.equal(next.revisionCount, 2);
    assert.throws(() => catalogue.publish(db, next.id!, approve(note)), /evidence|revision/i);
    catalogue.publish(db, next.id!, approve(next));
    assert.equal(catalogue.search("cache").length, 2);
    assert.ok(catalogue.search("newer")[0]?.content.includes("newer"));
    const changed = db.saveNote({ ...next, normalizedHash: undefined, content: "replacement without new verification" });
    assert.throws(() => catalogue.publish(db, changed.id!, approve(note)), /evidence|revision/i);
    assert.throws(() => catalogue.publish(db, 999, approve(note)));
    const row = catalogue.search("cache")[0]!;
    assert.ok(row.sourceRoot && row.sourceId && row.sourceRevision && row.applicability);
  } finally { db.close(); other.close(); catalogue.close(); }
});

it("rejects legacy proof, private/security content, missing or forged evidence and failed writes truthfully", () => {
  const db = new SentinelDatabase("same", root, true);
  const catalogue = new SentinelSharedCatalogue(":memory:");
  try {
    const original = captured(db);
    for (const patch of [
      { verification: undefined }, { status: "proposal" as const }, { proofCount: 0 },
      { type: "sensitive" as const }, { type: "security_note" as const }, { type: "security_alert" as const },
      { content: "<private>internal</private>" }, { content: "[PRIVATE_CONTENT_REDACTED]" },
      { content: "sk-proj-abcdefghijklmnopqrstuvwxyz123456" },
      { verification: { ...original.verification!, projectPath: "/wrong" } },
    ]) {
      const payload = { ...original, ...patch, topicKey: undefined, normalizedHash: undefined, title: JSON.stringify(patch) };
      const verification = payload.verification ? { ...payload.verification, revision: 0, fingerprint: sentinelNoteFingerprint(payload) } : undefined;
      const note = db.saveNote({ ...payload, verification });
      assert.throws(() => catalogue.publish(db, note.id!, { ...approve(original), fingerprint: verification?.fingerprint ?? "", revision: note.revisionCount! }));
    }
    assert.equal(catalogue.search("cache").length, 0);
    catalogue.close();
    assert.throws(() => catalogue.publish(db, original.id!, approve(original)), /closed|open/i);
  } finally { db.close(); catalogue.close(); }
});

it("structured evidence and catalogue survive reopen without backfilling legacy proof", () => {
  const sourceRoot = fs.mkdtempSync(path.join(process.env.TMPDIR!, "shared-source-"));
  const cataloguePath = path.join(sourceRoot, "catalogue.db");
  let source = new SentinelDatabase("same", sourceRoot);
  const file = source.getDbPath();
  const note = captured(source, sourceRoot);
  source.close();
  source = new SentinelDatabase("same", sourceRoot);
  let catalogue = new SentinelSharedCatalogue(cataloguePath);
  try {
    assert.deepEqual(source.getNoteById(note.id!)?.verification, note.verification);
    catalogue.publish(source, note.id!, approve(note));
    catalogue.close();
    catalogue = new SentinelSharedCatalogue(cataloguePath);
    assert.equal(catalogue.search("cache")[0]?.sourceRoot, sourceRoot);
    source.saveNote({ ...note, verification: undefined });
    assert.equal(source.getNoteById(note.id!)?.verification, undefined);
    assert.throws(() => catalogue.publish(source, note.id!, approve(note)));
  } finally {
    source.close(); catalogue.close();
    // Only files created by this fixture, all under isolated HOME/TMP.
    for (const own of [file, `${file}-wal`, `${file}-shm`, cataloguePath, `${cataloguePath}-wal`, `${cataloguePath}-shm`]) {
      if (fs.existsSync(own)) fs.unlinkSync(own);
    }
    fs.rmdirSync(sourceRoot);
  }
});

it("panel confirmation publishes A for recall B despite local hits; cancellation, stale approval and failure are truthful", () => {
  const a = fs.mkdtempSync(path.join(process.env.TMPDIR!, "publish-a-"));
  const b = fs.mkdtempSync(path.join(process.env.TMPDIR!, "recall-b-"));
  const source = new SentinelDatabase("same", a, true);
  const destination = new SentinelDatabase("destination", b);
  const catalogue = new SentinelSharedCatalogue(":memory:");
  const note = captured(source, a);
  const panel = new SentinelPanel({
    theme: { fg: (_c, s) => s, bg: (_c, s) => s, bold: s => s },
    projectRoot: a, projectName: "same", db: source, recorder: new SentinelRecorder("shared", a),
    initialMode: "metro", requestRender: () => {}, sharedCatalogueFactory: () => catalogue,
  });
  const screen = () => panel.render(200).join("\n");
  const prepare = () => { panel.handleInput("g"); for (const c of "Check cache lifecycle") panel.handleInput(c); panel.handleInput("\r"); };
  try {
    destination.saveNote({ project: "destination", type: "decision", glyph: "!", title: "cache local", content: "cache local" });
    assert.equal(catalogue.search("cache").length, 0, "construction never publishes");
    panel.handleInput("g"); panel.handleInput("\u001b");
    assert.equal(catalogue.search("cache").length, 0);
    prepare(); panel.handleInput("n");
    assert.equal(catalogue.search("cache").length, 0);
    assert.ok(!screen().includes("Publicada"));
    prepare(); source.saveNote({ ...note, verification: undefined }); panel.handleInput("y");
    assert.ok(screen().includes("No publicada"));
    assert.equal(catalogue.search("cache").length, 0);
    captured(source, a); prepare(); panel.handleInput("y");
    assert.ok(screen().includes("Publicada"));
    assert.equal(source.getNoteById(note.id!)?.scope, "project");
    const result = performPreFlightRecall("cache", { cwd: b, projectName: "destination", sharedCatalogueFactory: () => catalogue });
    assert.ok(result.items.some(i => i.scope === "project"));
    const shared = result.items.find(i => i.sourceRoot === a)!;
    assert.ok(shared && shared.score > 1, "foreign files do not imply staleness here");
    assert.ok(result.formattedBlock!.includes("cache local"));
    assert.ok(result.formattedBlock!.includes(a));
    assert.ok(result.formattedBlock!.includes("Check cache lifecycle"));
    assert.ok(result.formattedBlock!.length <= 800);
    for (const budget of [0, 20, 100, 400, 800]) assert.ok(formatRecallPromptSection([shared], budget).length <= budget);
    for (const patch of [{ status: "proposal" as const }, { expiresAt: "2000-01-01" }, { type: "sensitive" as const }, { content: "<private>cache private</private>" }]) {
      destination.saveNote({ project: "destination", type: "decision", glyph: "!", title: "cache excluded", content: "cache", ...patch });
    }
    const filtered = performPreFlightRecall("cache", { cwd: b, projectName: "destination", sharedCatalogueFactory: () => catalogue });
    assert.ok(!filtered.items.some(i => i.title === "cache excluded"));
    catalogue.close(); prepare(); panel.handleInput("y");
    assert.ok(screen().includes("No publicada"));
    assert.ok(!screen().includes("Publicada"));
  } finally { source.close(); destination.close(); catalogue.close(); }
});

it("explicit global filters exclude private notes in FTS, LIKE and listing", () => {
  const db = new SentinelDatabase("same", root, true);
  try {
    for (const scope of ["project", "global"]) db.saveNote({ project: "same", scope, type: "decision", glyph: "!", title: `${scope} cache xy`, content: scope });
    for (const query of ["cache", "xy", ""]) {
      assert.deepEqual(db.searchNotes(query, { scope: "global" }).map(n => n.scope), ["global"]);
    }
    assert.deepEqual(db.listNotes({ scope: "global" }).map(n => n.scope), ["global"]);
  } finally { db.close(); }
});
