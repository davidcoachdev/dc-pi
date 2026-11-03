/**
 * dc-anti-loop-guard.ts — Detector de bucles y llamadas repetidas a herramientas.
 *
 * Implementa el patrón `repeat-tool-reminder` de DeepSeek Harness (packages/guard/repeat-tool-reminder):
 * - Rastrea consecutivamente llamadas idénticas de herramientas con los mismos argumentos.
 * - Detecta cuando el modelo se traba llamando a la misma herramienta (ej: mismo comando bash o misma lectura)
 *   sin progresar.
 * - Tras alcanzar el umbral de advertencia (default: 3 consecutivas), devuelve una advertencia estructurada
 *   o bloquea el bucle si alcanza el umbral de corte duro (default: 5 consecutivas).
 */

export interface AntiLoopDecision {
  allow: boolean;
  repeatCount: number;
  warning?: string;
  blocked?: boolean;
}

export interface AntiLoopOptions {
  warnThreshold?: number;  // Default: 3
  blockThreshold?: number; // Default: 5
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalizeArguments(args: unknown): string {
  try {
    return JSON.stringify(sortJsonValue(args));
  } catch {
    return String(args);
  }
}

export class DcAntiLoopGuard {
  private lastTool: string | null = null;
  private lastCanonicalArgs: string | null = null;
  private consecutiveCount = 0;

  constructor(private readonly options: AntiLoopOptions = {}) {}

  /**
   * Registra una invocación y evalúa si constituye un bucle repetido.
   */
  evaluate(toolName: string, args: unknown): AntiLoopDecision {
    const canonical = canonicalizeArguments(args);
    const warnLimit = this.options.warnThreshold ?? 3;
    const blockLimit = this.options.blockThreshold ?? 5;

    if (this.lastTool === toolName && this.lastCanonicalArgs === canonical) {
      this.consecutiveCount++;
    } else {
      this.lastTool = toolName;
      this.lastCanonicalArgs = canonical;
      this.consecutiveCount = 1;
      return { allow: true, repeatCount: 1 };
    }

    if (this.consecutiveCount >= blockLimit) {
      return {
        allow: false,
        repeatCount: this.consecutiveCount,
        blocked: true,
        warning: `dc-anti-loop-guard: Se bloqueó la ejecución de '${toolName}' tras ${this.consecutiveCount} llamadas consecutivas idénticas. El modelo ha entrado en un bucle; detén la repetición y prueba otro enfoque.`,
      };
    }

    if (this.consecutiveCount >= warnLimit) {
      return {
        allow: true,
        repeatCount: this.consecutiveCount,
        warning: `dc-anti-loop-guard: Llamada repetida detectada (${this.consecutiveCount} veces a '${toolName}'). Analiza el resultado previo antes de llamar de nuevo con los mismos argumentos.`,
      };
    }

    return { allow: true, repeatCount: this.consecutiveCount };
  }

  reset(): void {
    this.lastTool = null;
    this.lastCanonicalArgs = null;
    this.consecutiveCount = 0;
  }

  getCurrentRepeatCount(): number {
    return this.consecutiveCount;
  }
}

export const globalAntiLoopGuard = new DcAntiLoopGuard();
