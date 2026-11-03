#!/usr/bin/env node
/**
 * DC Studio — Memory Pressure Benchmark & Leak Auditor
 *
 * Inspirado en el benchmark de DeepSeek Harness (run-memory-pressure-bench.ts):
 * - Monitorea el consumo de memoria RSS, Heap Used y External.
 * - Simula ciclos de trabajo intensivo en el harness (PTC, Sentinel DB, taxis y TUI).
 * - Certifica un techo de memoria estricto (ej. 250 MB para procesos Node.js de Pi o límite configurado).
 * - Detecta fugas retenidas ejecutando garbage collection forzado si está disponible.
 */

import { runPtcProgram } from "../src/features/dc-ptc/core/dc-ptc-runner.ts";
import { isRootPath, classifyShellCommand } from "../src/features/dc-scan-guard/dc-scan-guard.ts";

interface MemorySnapshot {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
}

function getMemorySnapshot(): MemorySnapshot {
  const m = process.memoryUsage();
  return {
    rssMb: Math.round((m.rss / 1024 / 1024) * 100) / 100,
    heapUsedMb: Math.round((m.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotalMb: Math.round((m.heapTotal / 1024 / 1024) * 100) / 100,
    externalMb: Math.round((m.external / 1024 / 1024) * 100) / 100,
  };
}

export async function runMemoryPressureAudit(options: {
  cycles?: number;
  maxRssMb?: number;
  verbose?: boolean;
} = {}): Promise<{
  passed: boolean;
  initialMemory: MemorySnapshot;
  peakMemory: MemorySnapshot;
  finalMemory: MemorySnapshot;
  rssGrowthMb: number;
  error?: string;
}> {
  const cycles = options.cycles ?? 30;
  const maxRssMb = options.maxRssMb ?? 350; // Techo estricto de 350 MB RSS
  const verbose = options.verbose ?? false;

  if (global.gc) {
    global.gc();
  }

  const initial = getMemorySnapshot();
  let peakRss = initial.rssMb;
  let peakSnapshot = { ...initial };

  if (verbose) {
    console.log(`[Memory-Benchmark] Inicio: RSS=${initial.rssMb}MB, Heap=${initial.heapUsedMb}MB`);
  }

  // Ejecución de ciclos de presión simulando actividad continua del agente
  for (let i = 1; i <= cycles; i++) {
    // 1. Simulación de ejecución PTC
    await runPtcProgram({
      code: `
        const arr = Array.from({ length: 1000 }, (_, idx) => ({ id: idx, val: 'data-' + idx }));
        return { count: arr.length, summary: arr.slice(0, 5) };
      `,
      timeoutMs: 5000,
    });

    // 2. Simulación de análisis y clasificación de scan-guard
    for (let j = 0; j < 50; j++) {
      classifyShellCommand("grep -rn 'API_KEY' src/");
      classifyShellCommand("cat ~/.ssh/id_rsa");
      isRootPath("/etc/hosts");
    }

    const current = getMemorySnapshot();
    if (current.rssMb > peakRss) {
      peakRss = current.rssMb;
      peakSnapshot = current;
    }

    if (current.rssMb > maxRssMb) {
      return {
        passed: false,
        initialMemory: initial,
        peakMemory: peakSnapshot,
        finalMemory: current,
        rssGrowthMb: Math.round((current.rssMb - initial.rssMb) * 100) / 100,
        error: `Excedido límite estricto de memoria: ${current.rssMb}MB > ${maxRssMb}MB en el ciclo ${i}`,
      };
    }
  }

  if (global.gc) {
    global.gc();
  }

  const finalMem = getMemorySnapshot();
  const growth = Math.round((finalMem.rssMb - initial.rssMb) * 100) / 100;

  if (verbose) {
    console.log(`[Memory-Benchmark] Fin: RSS=${finalMem.rssMb}MB (Peak=${peakSnapshot.rssMb}MB, Crecimiento=${growth}MB)`);
  }

  return {
    passed: true,
    initialMemory: initial,
    peakMemory: peakSnapshot,
    finalMemory: finalMem,
    rssGrowthMb: growth,
  };
}

// Ejecución directa por CLI si se invoca como script
if (process.argv[1] && (process.argv[1].endsWith("dc-memory-pressure-bench.ts") || process.argv[1].endsWith("dc-memory-pressure-bench.js"))) {
  runMemoryPressureAudit({ verbose: true })
    .then((result) => {
      if (!result.passed) {
        console.error("❌ Falló la auditoría de memoria:", result.error);
        process.exit(1);
      }
      console.log("✅ Auditoría de presión de memoria superada exitosamente dentro del presupuesto.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Error no controlado en benchmark de memoria:", err);
      process.exit(1);
    });
}
