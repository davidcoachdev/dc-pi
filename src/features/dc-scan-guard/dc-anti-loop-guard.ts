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

import { classifyNativeToolScan } from "./dc-scan-guard.ts";

export interface AntiLoopDecision {
  allow: boolean;
  repeatCount: number;
  warning?: string;
  blocked?: boolean;
}

export interface AntiLoopOptions {
  warnThreshold?: number;  // Default: 3
  blockThreshold?: number; // Default: 5
  windowSize?: number;     // Default: 12
}

function normalizeStringWhitespace(str: string): string {
  return str.trim().replace(/\s+/g, " ");
}

function sortJsonValue(value: unknown): unknown {
  if (typeof value === "string") return normalizeStringWhitespace(value);
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
    return normalizeStringWhitespace(String(args));
  }
}

export class DcAntiLoopGuard {
  private lastTool: string | null = null;
  private lastCanonicalArgs: string | null = null;
  private consecutiveCount = 0;
  private history: string[] = [];

  constructor(private readonly options: AntiLoopOptions = {}) {}

  /**
   * Detecta longitud de bucle alternante corto (ej. A->B->A->B) al final de la ventana.
   * Requiere que los elementos A y B sean idénticos en cada repetición (misma herramienta y mismos args canónicos),
   * por lo que ediciones multi-paso legítimas sobre distintos archivos/contenidos nunca disparan falsos positivos.
   */
  private detectAlternatingRunLength(): number {
    const n = this.history.length;
    if (n < 4) return 0;

    const last = this.history[n - 1]!;
    const prev = this.history[n - 2]!;
    if (last === prev) return 0;

    let length = 2;
    for (let i = n - 3; i >= 0; i--) {
      const expected = (n - 1 - i) % 2 === 0 ? last : prev;
      if (this.history[i] === expected) {
        length++;
      } else {
        break;
      }
    }

    return length >= 4 ? length : 0;
  }

  /**
   * Registra una invocación y evalúa si constituye un bucle repetido o alternante.
   */
  evaluate(toolName: string, args: unknown): AntiLoopDecision {
    if (toolName === "dc_ptc_run" && args && typeof args === "object") {
      const scanDecision = classifyNativeToolScan("dc_ptc_run", args as Record<string, unknown>);
      if (scanDecision.block && scanDecision.reason) {
        return {
          allow: false,
          repeatCount: 1,
          blocked: true,
          warning: scanDecision.reason,
        };
      }
    }

    const canonical = canonicalizeArguments(args);
    const signature = `${toolName}::${canonical}`;
    const warnLimit = this.options.warnThreshold ?? 3;
    const blockLimit = this.options.blockThreshold ?? 5;
    const maxWindow = this.options.windowSize ?? 12;

    this.history.push(signature);
    if (this.history.length > maxWindow) {
      this.history.shift();
    }

    if (this.lastTool === toolName && this.lastCanonicalArgs === canonical) {
      this.consecutiveCount++;
    } else {
      this.lastTool = toolName;
      this.lastCanonicalArgs = canonical;
      this.consecutiveCount = 1;
    }

    const alternatingLength = this.detectAlternatingRunLength();
    const effectiveRepeatCount = Math.max(this.consecutiveCount, alternatingLength);

    if (effectiveRepeatCount >= blockLimit) {
      return {
        allow: false,
        repeatCount: effectiveRepeatCount,
        blocked: true,
        warning: `dc-anti-loop-guard: Se bloqueó la ejecución de '${toolName}' tras ${effectiveRepeatCount} llamadas en bucle repetido/alternante. El modelo ha entrado en un bucle; detén la repetición y prueba otro enfoque.`,
      };
    }

    if (effectiveRepeatCount >= warnLimit) {
      return {
        allow: true,
        repeatCount: effectiveRepeatCount,
        warning: `dc-anti-loop-guard: Llamada repetida detectada (${effectiveRepeatCount} veces a '${toolName}'). Analiza el resultado previo antes de llamar de nuevo con los mismos argumentos.`,
      };
    }

    return { allow: true, repeatCount: effectiveRepeatCount };
  }

  reset(): void {
    this.lastTool = null;
    this.lastCanonicalArgs = null;
    this.consecutiveCount = 0;
    this.history = [];
  }

  getCurrentRepeatCount(): number {
    return Math.max(this.consecutiveCount, this.detectAlternatingRunLength());
  }
}

export const globalAntiLoopGuard = new DcAntiLoopGuard();
