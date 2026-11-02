import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { performPreFlightRecall } from "../src/features/dc-sentinel/core/dc-sentinel-recall.ts";
import { resolveSentinelDbPath } from "../src/features/dc-sentinel/core/dc-sentinel-db.ts";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { SentinelDatabase, normalizeTextForHash } from "../src/features/dc-sentinel/core/dc-sentinel-db.ts";

it("T3: lexical root identity isolates equal basenames and leaves legacy destinations untouched", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "identity-"));
  const a = path.join(base, "a", "same");
  const b = path.join(base, "b", "same");
  const first = resolveSentinelDbPath("same", a);
  assert.notEqual(first, resolveSentinelDbPath("same", b));
  assert.equal(first, resolveSentinelDbPath("same", path.join(a, "child", "..")));
  assert.equal(first, resolveSentinelDbPath("same", path.relative(process.cwd(), a)));
  const legacyFallback = path.join(path.dirname(first), "sentinel-same.db");
  fs.mkdirSync(path.dirname(first), { recursive: true });
  fs.writeFileSync(legacyFallback, "fallback-important-unknown");
  const isolated = new SentinelDatabase("same", a);
  isolated.close();
  assert.equal(fs.readFileSync(legacyFallback, "utf8"), "fallback-important-unknown");
  fs.mkdirSync(a, { recursive: true });
  const alias = path.join(base, "alias");
  fs.symlinkSync(a, alias, "dir");
  assert.notEqual(resolveSentinelDbPath("same", alias), first, "identity is lexical, not realpath");
  fs.mkdirSync(path.join(a, "dc-sentinela", ".cache"), { recursive: true });
  const legacy = path.join(a, "dc-sentinela", ".cache", "sentinel.db");
  fs.writeFileSync(legacy, "legacy-important-unknown");
  const db = new SentinelDatabase("same", a);
  assert.notEqual(db.getDbPath(), legacy);
  db.saveNote({ project: "same", type: "decision", glyph: "!", title: "rootidentity", content: "rootidentity" });
  db.close();
  assert.equal(fs.readFileSync(legacy, "utf8"), "legacy-important-unknown");
  assert.equal(performPreFlightRecall("rootidentity", { cwd: a }).items.length, 1);
  assert.equal(performPreFlightRecall("rootidentity", { cwd: b }).items.length, 0);
});

it("T3: new writes map provenance and nullable schema upgrades are idempotent without backfill", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "provenance-"));
  let db = new SentinelDatabase("fixture", root);
  const file = db.getDbPath();
  const note = { project: "fixture", type: "decision" as const, glyph: "!", title: "old", content: "unknown" };
  db.saveNote(note);
  db.recordFrame({ sessionId: "s", turnId: "t", actor: "[USER]", eventType: "prompt", title: "old", content: "unknown" });
  db.saveProcedure({ project: "fixture", name: "old", title: "old", triggerPattern: "old", symptoms: "", preconditions: "", steps: [] });
  db.close();
  const raw = new DatabaseSync(file);
  for (const table of ["notes", "frames", "procedures"]) {
    const columns = raw.prepare(`PRAGMA table_info(${table})`).all() as any[];
    if (columns.some((c) => c.name === "project_path")) raw.exec(`ALTER TABLE ${table} DROP COLUMN project_path`);
  }
  raw.close();
  for (let i = 0; i < 2; i++) { db = new SentinelDatabase("fixture", root); db.close(); }
  db = new SentinelDatabase("fixture", root);
  assert.equal(db.listNotes()[0].project_path, undefined);
  assert.equal(db.saveNote(note).project_path, undefined, "duplicate writes must not invent historical provenance");
  assert.equal(db.listFrames()[0].project_path, undefined);
  assert.equal(db.listProcedures()[0].project_path, undefined);
  assert.equal(db.saveNote({ ...note, title: "new", content: "attributed" }).project_path, root);
  assert.equal(db.recordFrame({ sessionId: "s", turnId: "t", actor: "[USER]", eventType: "prompt", title: "new", content: "attributed" }).project_path, root);
  assert.equal(db.saveProcedure({ project: "fixture", name: "new", title: "new", triggerPattern: "new", symptoms: "", preconditions: "", steps: [] }).project_path, root);
  assert.equal(db.listNotes().find((n) => n.title === "new")?.project_path, root);
  assert.equal(db.listFrames()[1].project_path, root);
  assert.equal(db.listProcedures().find((p) => p.name === "new")?.project_path, root);
  db.close();
});

it("T4a: unverified topic replacement clears current-revision proof", () => {
  const db = new SentinelDatabase("fixture", undefined, true);
  const base = { project: "fixture", type: "bugfix" as const, glyph: "!", topicKey: "auth", title: "fix" };
  const first = db.saveNote({ ...base, content: "verified revision", proofCount: 1, status: "active" });
  const next = db.saveNote({ ...base, content: "unverified revision", proofCount: 0, status: "proposal" });
  assert.equal(next.id, first.id);
  assert.equal(next.proofCount, 0);
  assert.equal(next.status, "proposal");
  assert.equal(db.getNoteById(first.id!)?.proofCount, 0);
  const verified = db.saveNote({ ...base, content: "third revision", proofCount: 1, status: "active" });
  assert.equal(verified.proofCount, 1);
  const duplicate = db.saveNote({ ...base, content: "third revision", proofCount: 0, status: "proposal" });
  assert.equal(duplicate.proofCount, 0, "dedup must not preserve stale proof either");
  assert.equal(db.getNoteById(first.id!)?.status, "proposal");
  db.close();
});

describe("dc-sentinel-db: Motor Local Soberano con node:sqlite", () => {
  it("normaliza texto para hash de forma determinista", () => {
    const h1 = normalizeTextForHash("Autenticación con JWT en Fastify!");
    const h2 = normalizeTextForHash("  autenticacion   con jwt en fastify   ");
    assert.equal(h1, h2);
    assert.equal(h1.length, 32);
  });

  it("registra y lista Smart Frames con actor y checksum append-only", () => {
    const db = new SentinelDatabase("test-project", undefined, true);

    const f1 = db.recordFrame({
      sessionId: "sess-1",
      turnId: "turn-1",
      actor: "[USER]",
      eventType: "prompt_submit",
      title: "Requerimiento de usuario",
      content: "Migrar middleware a Fastify",
    });

    const f2 = db.recordFrame({
      sessionId: "sess-1",
      turnId: "turn-1",
      actor: "[ORCHESTRATOR]",
      eventType: "decision_made",
      title: "Decisión técnica",
      content: "Elegido Fastify por baja latencia",
    });

    assert.equal(f1.frameSeq, 1);
    assert.equal(f2.frameSeq, 2);
    assert.ok(f1.checksum);
    assert.ok(f2.checksum);

    const frames = db.listFrames({ sessionId: "sess-1" });
    assert.equal(frames.length, 2);
    assert.equal(frames[0].actor, "[USER]");
    assert.equal(frames[1].actor, "[ORCHESTRATOR]");

    db.close();
  });

  it("guarda notas atómicas y realiza upsert evolutivo con topic_key (Engram pattern)", () => {
    const db = new SentinelDatabase("dc-pi", undefined, true);

    const n1 = db.saveNote({
      project: "dc-pi",
      type: "decision",
      glyph: "⚖",
      title: "Elegir Fastify",
      content: "Se selecciona Fastify como servidor de API",
      topicKey: "auth-server-framework",
    });

    assert.equal(n1.revisionCount, 1);
    assert.equal(n1.duplicateCount, 1);

    // Segunda actualización con el mismo topic_key debe incrementar revision_count
    const n2 = db.saveNote({
      project: "dc-pi",
      type: "decision",
      glyph: "⚖",
      title: "Fastify con plugins de cookies",
      content: "Se selecciona Fastify y se añade soporte de cookies",
      topicKey: "auth-server-framework",
    });

    assert.equal(n2.id, n1.id);
    assert.equal(n2.revisionCount, 2);
    assert.equal(n2.title, "Fastify con plugins de cookies");

    const allNotes = db.listNotes({ project: "dc-pi" });
    assert.equal(allNotes.length, 1);

    db.close();
  });

  it("deduplica notas idénticas por normalized_hash incrementando duplicate_count", () => {
    const db = new SentinelDatabase("dc-pi", undefined, true);

    const n1 = db.saveNote({
      project: "dc-pi",
      type: "bugfix",
      glyph: "●",
      title: "Fix de puerto colgado",
      content: "Matar procesos en puerto 4111 con fuser o pkill",
    });

    assert.equal(n1.duplicateCount, 1);

    // Mismo contenido sin topic_key
    const n2 = db.saveNote({
      project: "dc-pi",
      type: "bugfix",
      glyph: "●",
      title: "Fix de puerto colgado",
      content: "Matar procesos en puerto 4111 con fuser o pkill",
    });

    assert.equal(n2.id, n1.id);
    assert.equal(n2.duplicateCount, 2);

    db.close();
  });

  it("busca subcadenas en código y variables usando FTS5 trigram", () => {
    const db = new SentinelDatabase("dc-pi", undefined, true);

    db.saveNote({
      project: "dc-pi",
      type: "decision",
      glyph: "⚖",
      title: "Refactor AuthService",
      content: "La función verifySessionToken valida expiración antes de consultar la BD",
    });

    // Subcadena 'verifySession'
    const resultsSub = db.searchNotes("verifySession", { project: "dc-pi" });
    assert.equal(resultsSub.length, 1);
    assert.equal(resultsSub[0].title, "Refactor AuthService");

    // Subcadena 'Token'
    const resultsToken = db.searchNotes("Token", { project: "dc-pi" });
    assert.equal(resultsToken.length, 1);

    db.close();
  });

  it("gestiona procedimientos de fixes (ReMe + Tencent Auto-Skills)", () => {
    const db = new SentinelDatabase("dc-pi", undefined, true);

    const proc = db.saveProcedure({
      project: "dc-pi",
      name: "fix-vitest-hang",
      title: "Receta para descolgar tests en monorepo",
      triggerPattern: "port_collision_4111",
      symptoms: "Error EADDRINUSE en tests de Hono",
      preconditions: "Node.js activo con workers zombies",
      steps: [
        "Ejecutar pkill -f vitest",
        "Limpiar carpeta temporal .test-build",
        "Recompilar con npm run build",
      ],
      verificationCmd: "npm test",
    });

    assert.ok(proc.id);
    assert.equal(proc.steps.length, 3);

    const list = db.listProcedures("dc-pi");
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "fix-vitest-hang");

    db.close();
  });

  it("soporta soft-delete, restore y pin de notas", () => {
    const db = new SentinelDatabase("dc-pi", undefined, true);

    const n = db.saveNote({
      project: "dc-pi",
      type: "discovery",
      glyph: "○",
      title: "Descubrimiento de API",
      content: "El endpoint /health responde en 12ms",
    });

    assert.equal(db.listNotes({ project: "dc-pi" }).length, 1);

    // Soft delete
    const deleted = db.softDeleteNote(n.id!);
    assert.equal(deleted, true);
    assert.equal(db.listNotes({ project: "dc-pi" }).length, 0);

    // Restore
    const restored = db.restoreNote(n.id!);
    assert.equal(restored, true);
    assert.equal(db.listNotes({ project: "dc-pi" }).length, 1);

    // Pin
    db.pinNote(n.id!, true);
    const pinnedNote = db.getNoteById(n.id!);
    assert.equal(pinnedNote?.pinned, true);

    db.close();
  });
});
