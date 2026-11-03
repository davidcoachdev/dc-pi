import test from "node:test";
import assert from "node:assert/strict";
import { runMemoryPressureAudit } from "../scripts/dc-memory-pressure-bench.ts";

test("dc-memory-pressure-bench: ejecuta ciclos de presión y mantiene el consumo bajo el presupuesto sin fugas", async () => {
  const audit = await runMemoryPressureAudit({
    cycles: 10,
    maxRssMb: 400,
    verbose: false,
  });

  assert.equal(audit.passed, true);
  assert.ok(audit.initialMemory.rssMb > 0);
  assert.ok(audit.peakMemory.rssMb <= 400);
  // Crecimiento acotado
  assert.ok(audit.rssGrowthMb < 150, `El crecimiento de memoria (${audit.rssGrowthMb}MB) no debe ser excesivo`);
});
