import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { SentinelDatabase, normalizeTextForHash } from "../src/features/dc-sentinel/core/dc-sentinel-db.ts";

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
