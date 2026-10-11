/**
 * dc-model-calibration.ts — Calibración defensiva de ventanas de contexto,
 * límites de tokens de salida y niveles de reasoning effort para CLIProxyAPI/CPAM.
 *
 * Directiva 1 de DC Studio: Código puro de TypeScript, sin dependencias de Pi UI.
 */

export const DEFAULT_MAX_TOKENS = 16_384;
export const MAX_SAFE_OUTPUT_TOKENS = 65_536;

/**
 * Techos máximos seguros de contexto por familia de modelo para prevenir
 * timeouts de red, desbordes de buffer y fallos de streaming en CLIProxyAPI.
 */
export const RECOMMENDED_CONTEXT_CAPS: Record<string, number> = {
  gemini: 370_000,
  gpt: 272_000,
  codex: 272_000,
  openai: 272_000,
  claude: 200_000,
  default: 128_000,
};

/**
 * Resuelve la ventana de contexto recomendada y segura para un modelo.
 * Si el backend reporta un contexto mayor al techo seguro, se recorta al techo defensivo.
 */
export function resolveRecommendedContextWindow(modelId: string, reportedContext?: number): number {
  if (!modelId) return RECOMMENDED_CONTEXT_CAPS.default;

  const id = modelId.toLowerCase();
  let recommendedCap = RECOMMENDED_CONTEXT_CAPS.default;

  if (id.includes("gemini")) {
    recommendedCap = RECOMMENDED_CONTEXT_CAPS.gemini;
  } else if (id.includes("gpt") || id.includes("codex") || id.includes("openai")) {
    recommendedCap = RECOMMENDED_CONTEXT_CAPS.gpt;
  } else if (id.includes("claude")) {
    recommendedCap = RECOMMENDED_CONTEXT_CAPS.claude;
  }

  if (typeof reportedContext === "number" && Number.isFinite(reportedContext) && reportedContext > 0) {
    return Math.min(Math.floor(reportedContext), recommendedCap);
  }

  return recommendedCap;
}

/**
 * Resuelve el límite seguro de tokens de salida (maxTokens) sin exceder el cap defensivo.
 */
export function resolveSafeMaxTokens(reportedMaxTokens?: number): number {
  if (typeof reportedMaxTokens === "number" && Number.isFinite(reportedMaxTokens) && reportedMaxTokens > 0) {
    return Math.min(Math.floor(reportedMaxTokens), MAX_SAFE_OUTPUT_TOKENS);
  }
  return DEFAULT_MAX_TOKENS;
}

/**
 * Construye un mapa estricto de niveles de razonamiento (thinkingLevelMap)
 * a partir de los niveles reportados por el modelo en CLIProxyAPI (/v1/models?client_version=1).
 * Si un nivel no está soportado por el modelo, se asigna a null para evitar HTTP 400.
 */
export function buildStrictThinkingLevelMap(levels: string[]): Record<string, string | null> {
  if (!levels || levels.length === 0) {
    return {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: null,
      max: null,
    };
  }

  const set = new Set(levels.map((lvl) => lvl.toLowerCase()));

  return {
    off: null,
    minimal: set.has("minimal") ? "minimal" : null,
    low: set.has("low") ? "low" : null,
    medium: set.has("medium") ? "medium" : null,
    high: set.has("high") ? "high" : null,
    xhigh: set.has("xhigh") ? "xhigh" : null,
    max: set.has("max") ? "max" : null,
  };
}
