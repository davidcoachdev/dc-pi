import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  composeEphemeralMemoryPack,
  injectEphemeralMemory,
  MAX_MEMORY_PACK_BYTES,
} from "../src/features/dc-sentinel/core/dc-sentinel-ephemeral.ts";
import { SubagentLeaseManager } from "../src/features/dc-sentinel/core/dc-sentinel-lease.ts";
import type { SentinelNote } from "../src/features/dc-sentinel/core/dc-sentinel-types.ts";

describe("dc-sentinel-ephemeral-lease: Inyección Efímera y Protocolo de Lease", () => {
  it("compone un bloque efímero con marcadores y guarda de Tencent", () => {
    const notes: SentinelNote[] = [
      {
        project: "dc-pi",
        type: "decision",
        glyph: "⚖",
        title: "Arquitectura Hono",
        content: "El servidor HTTP se monta con Hono por velocidad y tipos.",
        proofCount: 2,
      },
    ];

    const pack = composeEphemeralMemoryPack(notes);

    assert.ok(pack.includes("<!-- dc:sentinel:memory-pack:start -->"));
    assert.ok(pack.includes("<SYSTEM_CUSTOM_STRATEGY_GUARD priority=\"highest\">"));
    assert.ok(pack.includes("⚖ [DECISION] **Arquitectura Hono** (Confirmado 2x)"));
    assert.ok(pack.includes("<!-- dc:sentinel:memory-pack:end -->"));
    assert.ok(Buffer.byteLength(pack, "utf8") <= MAX_MEMORY_PACK_BYTES);
  });

  it("respeta estrictamente el techo de 6 KiB recortando notas excedentes", () => {
    const manyNotes: SentinelNote[] = [];
    for (let i = 0; i < 50; i++) {
      manyNotes.push({
        project: "dc-pi",
        type: "bugfix",
        glyph: "●",
        title: `Nota larga número ${i}`,
        content: "X".repeat(300),
      });
    }

    const pack = composeEphemeralMemoryPack(manyNotes, { maxBytes: 2000 });
    const bytes = Buffer.byteLength(pack, "utf8");

    assert.ok(bytes <= 2000);
    assert.ok(pack.includes("Nota larga número 0"));
  });

  it("inyecta el Memory Pack de forma estrictamente idempotente", () => {
    const options = { appendSystemPrompt: "System Prompt Inicial" };
    const pack = "<!-- dc:sentinel:memory-pack:start -->\nBLOQUE_VIEJO\n<!-- dc:sentinel:memory-pack:end -->";

    // Primera inyección
    const in1 = injectEphemeralMemory(options, pack);
    assert.equal(in1, true);
    assert.ok(options.appendSystemPrompt.includes("System Prompt Inicial"));
    assert.ok(options.appendSystemPrompt.includes("BLOQUE_VIEJO"));

    // Segunda inyección con nuevo contenido: debe reemplazar sin duplicar
    const newPack = "<!-- dc:sentinel:memory-pack:start -->\nBLOQUE_NUEVO\n<!-- dc:sentinel:memory-pack:end -->";
    const in2 = injectEphemeralMemory(options, newPack);
    assert.equal(in2, true);
    assert.ok(!options.appendSystemPrompt.includes("BLOQUE_VIEJO"));
    assert.ok(options.appendSystemPrompt.includes("BLOQUE_NUEVO"));
    assert.equal(options.appendSystemPrompt.split("<!-- dc:sentinel:memory-pack:start -->").length - 1, 1);
  });

  it("gestiona el ciclo de vida de leases para subagentes con auto-limpieza", () => {
    const manager = new SubagentLeaseManager();

    // 1. Subagente vacío (debe marcarse para poda)
    const l1 = manager.createLease("parent-1", "dc-scout", "explorar rutas");
    assert.ok(l1.leaseId);
    assert.equal(manager.getActiveLeasesCount(), 1);

    const out1 = manager.releaseLease(l1.leaseId, false);
    assert.ok(out1);
    assert.equal(out1.shouldPrune, true);
    assert.equal(manager.getActiveLeasesCount(), 0);

    // 2. Subagente productivo que guardó notas (NO debe podarse)
    const l2 = manager.createLease("parent-1", "dc-worker", "implementar fix");
    manager.recordNoteProduced(l2.leaseId);

    const out2 = manager.releaseLease(l2.leaseId, false);
    assert.ok(out2);
    assert.equal(out2.shouldPrune, false);
    assert.equal(out2.lease.notesCreatedCount, 1);
  });
});
