export type CommentRiskCategory =
  | "BENIGN"
  | "OFFENSIVE"
  | "PROMPT_INJECTION"
  | "DESTRUCTIVE_COMMAND"
  | "SPAM";

export type RecommendedAction = "ALLOW" | "IGNORE" | "DELETE_AND_STRIKE" | "BLOCK";

export interface CommentAnalysisResult {
  category: CommentRiskCategory;
  riskLevel: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  confidence: number;
  recommendedAction: RecommendedAction;
  reason: string;
  matchedPatterns: string[];
}

/**
 * Analizador Inteligente de Comentarios de GitHub en DC Studio.
 * Evalúa el contenido del comentario bajo 3 capas de análisis:
 * 1. Heurística de patrones de inyección de prompt y jailbreaks.
 * 2. Detección de comandos destructivos y extracción de secretos.
 * 3. Detección de toxicidad, hostilidad y lenguaje fuera de tono.
 */
export class DcCommentAnalyzer {
  private static instance?: DcCommentAnalyzer;

  // Patrones de inyección de prompt
  private promptInjectionPatterns = [
    /ignore (?:all )?(?:previous|prior) (?:instructions|prompts)/i,
    /ignora (?:todas )?(?:las )?instrucciones (?:previas|anteriores)/i,
    /you are now|ahora eres/i,
    /system prompt/i,
    /developer mode/i,
    /jailbreak/i,
    /override (?:safety|guardrails)/i,
    /act as (?:dan|unrestricted)/i,
  ];

  // Patrones de comandos destructivos / sabotaje
  private destructivePatterns = [
    /\b(?:rm\s+-rf|rmdir\s+\/s)\b/i,
    /\bdrop\s+(?:table|database|schema)\b/i,
    /\bdelete\s+from\s+[a-zA-Z0-9_]+\s*;?\b/i,
    /\btruncate\s+table\b/i,
    /\bformat\s+[c-z]:/i,
    /\bcat\s+\.env\b/i,
    /\bcurl\s+.*\|\s*bash\b/i,
    /\b(?:wget|curl).*-(?:O|o)\s+.*&&\s*(?:chmod|bash)\b/i,
  ];

  // Patrones de toxicidad y agresividad en comunidad
  private offensivePatterns = [
    /\b(?:basura|porquer[ií]a|est[uú]pido|idiota|imb[eé]cil|incompetente|mierda)\b/i,
    /\b(?:aprendan a programar|no sirven para nada|proyecto de mierda)\b/i,
    /\b(?:fuck(?:ing)?|shit|asshole|bitch|useless developers|trash project)\b/i,
  ];

  public static getInstance(): DcCommentAnalyzer {
    if (!DcCommentAnalyzer.instance) {
      DcCommentAnalyzer.instance = new DcCommentAnalyzer();
    }
    return DcCommentAnalyzer.instance;
  }

  public analyze(commentBody: string): CommentAnalysisResult {
    const text = commentBody.trim();
    const matchedPatterns: string[] = [];

    // 1. Verificar comandos destructivos (Riesgo Crítico / HIGH)
    for (const pat of this.destructivePatterns) {
      if (pat.test(text)) {
        matchedPatterns.push(pat.source);
      }
    }
    if (matchedPatterns.length > 0) {
      return {
        category: "DESTRUCTIVE_COMMAND",
        riskLevel: "HIGH",
        confidence: 0.98,
        recommendedAction: "BLOCK",
        reason: "Comando destructivo o intento de sabotaje de datos detectado.",
        matchedPatterns,
      };
    }

    // 2. Verificar inyecciones de prompt / manipulación (Riesgo Alto / HIGH)
    for (const pat of this.promptInjectionPatterns) {
      if (pat.test(text)) {
        matchedPatterns.push(pat.source);
      }
    }
    if (matchedPatterns.length > 0) {
      return {
        category: "PROMPT_INJECTION",
        riskLevel: "HIGH",
        confidence: 0.92,
        recommendedAction: "DELETE_AND_STRIKE",
        reason: "Intento de elusión de directivas o inyección de prompt contra el agente.",
        matchedPatterns,
      };
    }

    // 3. Verificar toxicidad / lenguaje ofensivo (Riesgo Medio / MEDIUM)
    for (const pat of this.offensivePatterns) {
      if (pat.test(text)) {
        matchedPatterns.push(pat.source);
      }
    }
    if (matchedPatterns.length > 0) {
      return {
        category: "OFFENSIVE",
        riskLevel: "MEDIUM",
        confidence: 0.88,
        recommendedAction: "DELETE_AND_STRIKE",
        reason: "Lenguaje hostil, ofensivo o degradante que incumple las normas de la comunidad.",
        matchedPatterns,
      };
    }

    // 4. Comentario seguro (BENIGN)
    return {
      category: "BENIGN",
      riskLevel: "NONE",
      confidence: 0.99,
      recommendedAction: "ALLOW",
      reason: "Comentario técnico regular sin patrones de riesgo identificados.",
      matchedPatterns: [],
    };
  }
}

export const dcCommentAnalyzer = DcCommentAnalyzer.getInstance();
