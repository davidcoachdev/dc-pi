/**
 * src/features/dc-ice/core/dc-ice-context-meter.ts — Desglose de Contexto y Límite de Atención Cognitiva.
 * Directivas: Google Cloud AI SDLC (Addy Osmani) & Triángulo de Hierro Agéntico (Kapil Viren Ahuja).
 */

export interface ContextSplitInput {
  systemPromptChars: number;
  toolsSchemaChars: number;
  chatHistoryChars: number;
  skillsChars?: number;
  contextWindowLimit?: number;
}

export interface ContextSplitMetrics {
  staticTokens: number;
  dynamicTokens: number;
  totalTokens: number;
  staticRatioPercent: number;
  dynamicRatioPercent: number;
  contextRotAlert: boolean;
  recommendations: string[];
}

export interface CognitiveLoadInput {
  activeSubagents: number;
  unreadInboxReports: number;
  maxConcurrentAttention?: number;
}

export interface CognitiveLoadStatus {
  ceilingReached: boolean;
  status: "optimal" | "approaching_limit" | "cognitive_overload";
  activeCount: number;
  unreadCount: number;
  maxAttention: number;
  warnings: string[];
}

/**
 * Estimador estándar de caracteres a tokens (aproximadamente 4 caracteres por token en inglés/código).
 */
function charsToTokens(chars: number): number {
  return Math.round(Math.max(0, chars) / 4);
}

/**
 * Analiza el balance entre Contexto Estático (facturado en cada turno individual)
 * y Contexto Dinámico (bajo demanda), alertando contra el fenómeno de Context Rot.
 */
export function analyzeContextSplit(input: ContextSplitInput): ContextSplitMetrics {
  const {
    systemPromptChars,
    toolsSchemaChars,
    chatHistoryChars,
    skillsChars = 0,
    contextWindowLimit = 200000,
  } = input;

  const staticTokens = charsToTokens(systemPromptChars + toolsSchemaChars);
  const dynamicTokens = charsToTokens(chatHistoryChars + skillsChars);
  const totalTokens = staticTokens + dynamicTokens;

  const staticRatioPercent = totalTokens > 0 ? Math.round((staticTokens / totalTokens) * 100) : 0;
  const dynamicRatioPercent = totalTokens > 0 ? Math.round((dynamicTokens / totalTokens) * 100) : 0;

  // Umbral de Context Rot: si el contexto dinámico acumulado supera el 60% de la ventana total del modelo
  const dynamicUtilizationOfLimit = dynamicTokens / contextWindowLimit;
  const contextRotAlert = dynamicUtilizationOfLimit >= 0.6;

  const recommendations: string[] = [];

  if (staticRatioPercent > 45 && totalTokens > 40000) {
    recommendations.push(
      "El contexto estático (instrucciones + tools) representa más del 45% del turno. Considera podar descripciones de herramientas o migrar directivas secundarias a Skills dinámicos (progressive disclosure).",
    );
  }

  if (contextRotAlert) {
    recommendations.push(
      `Alerta de Context Rot: El historial dinámico ocupa el ${(dynamicUtilizationOfLimit * 100).toFixed(1)}% de la ventana útil. Se recomienda ejecutar /dc-checkpoint o /dc-handoff para reiniciar la pizarra (fresh context) y evitar degradación en el razonamiento.`,
    );
  }

  return {
    staticTokens,
    dynamicTokens,
    totalTokens,
    staticRatioPercent,
    dynamicRatioPercent,
    contextRotAlert,
    recommendations,
  };
}

/**
 * Evalúa la saturación de atención humana según el Triángulo de Hierro Agéntico de Kapil Viren Ahuja.
 * Evita la ceguera de revisión y la degradación silenciosa cuando se lanzan demasiados agentes concurrentes.
 */
export function evaluateCognitiveLoad(input: CognitiveLoadInput): CognitiveLoadStatus {
  const { activeSubagents, unreadInboxReports, maxConcurrentAttention = 2 } = input;
  const warnings: string[] = [];

  const totalPendingAttention = activeSubagents + unreadInboxReports;
  const ceilingReached = totalPendingAttention > maxConcurrentAttention;

  let status: "optimal" | "approaching_limit" | "cognitive_overload" = "optimal";

  if (ceilingReached) {
    status = "cognitive_overload";
    warnings.push(
      `Techo Cognitivo alcanzado (${totalPendingAttention} tareas/reportes pendientes vs umbral de ${maxConcurrentAttention}). Revisa y liquida los reportes en /inbox antes de despachar nuevos subagentes para prevenir ceguera de revisión y fallos silenciosos.`,
    );
  } else if (totalPendingAttention === maxConcurrentAttention) {
    status = "approaching_limit";
  }

  return {
    ceilingReached,
    status,
    activeCount: activeSubagents,
    unreadCount: unreadInboxReports,
    maxAttention: maxConcurrentAttention,
    warnings,
  };
}
