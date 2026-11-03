/**
 * dc-spill-guard.ts — Interceptor y protector de desbordamiento de contexto (Output Spill Guard).
 *
 * Inspirado en el subsistema de spill y retención de DeepSeek Harness (packages/spill/):
 * - Monitorea las salidas de texto de herramientas antes de inyectarlas en el contexto del LLM.
 * - Si el contenido excede el presupuesto seguro (default: 60,000 caracteres / ~15k tokens),
 *   trunca de forma determinista preservando la cabecera, el pie y un marcador auditado.
 */

export interface SpillGuardOptions {
  maxChars?: number;
  headChars?: number;
  tailChars?: number;
}

export interface SpillGuardResult {
  text: string;
  truncated: boolean;
  originalLength: number;
  truncatedLength: number;
}

export const DEFAULT_SPILL_MAX_CHARS = 60000;
export const DEFAULT_SPILL_HEAD_CHARS = 35000;
export const DEFAULT_SPILL_TAIL_CHARS = 15000;

/**
 * Trunca de forma segura una cadena excesivamente larga para proteger el context window.
 */
export function guardOutputSpill(
  content: string,
  options: SpillGuardOptions = {},
): SpillGuardResult {
  if (typeof content !== "string") {
    return { text: String(content ?? ""), truncated: false, originalLength: 0, truncatedLength: 0 };
  }

  const max = options.maxChars ?? DEFAULT_SPILL_MAX_CHARS;
  const originalLength = content.length;

  if (originalLength <= max) {
    return { text: content, truncated: false, originalLength, truncatedLength: originalLength };
  }

  const head = options.headChars ?? DEFAULT_SPILL_HEAD_CHARS;
  const tail = options.tailChars ?? DEFAULT_SPILL_TAIL_CHARS;
  const omittedCount = originalLength - (head + tail);

  const headText = content.slice(0, head);
  const tailText = content.slice(originalLength - tail);

  const marker = `\n\n[... dc-spill-guard: se omitieron ${omittedCount} caracteres (${Math.round(omittedCount / 1024)} KB) para proteger la ventana de contexto ...]\n\n`;

  const truncatedText = headText + marker + tailText;

  return {
    text: truncatedText,
    truncated: true,
    originalLength,
    truncatedLength: truncatedText.length,
  };
}
