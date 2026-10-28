export interface SubagentQuery {
  taskId: string;
  requestId: string;
  message: string;
  kind: "technical_context" | "scope_clarification" | "product_decision" | "user_consent";
  timestamp: number;
}

export interface SubagentReplyDecision {
  destination: "parent_auto_reply" | "bubble_to_user";
  reason: string;
  suggestedReply?: string;
}

/**
 * Evalúa una consulta proveniente de un subagente hijo.
 * Directiva: la comunicación debe ser entre padre e hijo de forma autónoma,
 * salvo que requiera explícitamente aprobación humana o una decisión de producto/alcance.
 */
export function evaluateSubagentQueryRouting(query: SubagentQuery): SubagentReplyDecision {
  const text = query.message.toLowerCase();

  // Patrones que exigen consentimiento o decisión humana
  const requiresUserIntervention =
    query.kind === "product_decision" ||
    query.kind === "user_consent" ||
    /confirmar con el usuario|decision del usuario|autorizar borrado|publicar|deploy/i.test(text);

  if (requiresUserIntervention) {
    return {
      destination: "bubble_to_user",
      reason: "La consulta del subagente requiere decisión de producto o consentimiento explícito del usuario.",
    };
  }

  // Por defecto, consultas técnicas, rutas de archivo, especificaciones y dudas de código
  // son atendidas directamente en el canal padre-hijo sin interrumpir al usuario.
  return {
    destination: "parent_auto_reply",
    reason: "Consulta técnica de contexto o arquitectura que puede ser respondida directamente por el orquestador padre.",
    suggestedReply: `[Orquestador Padre]: Proceda respetando las especificaciones vigentes en odd/tasks/ sin modificar archivos fuera del alcance asignado.`,
  };
}
