/**
 * dc-ephemeral-types.ts — Contratos puros, tipos y presets para el Sistema de Agentes Efímeros
 * y Flota de Taxis (Libre / Ocupado) de DC Studio.
 *
 * Cumple estrictamente con la Directiva 1 de DC Studio (cero dependencias de Pi / pi-tui).
 */

export type DcTaxiStatus = "libre" | "ocupado" | "recargando";

export type DcPassengerType = "orchestrator" | "subagent" | "ephemeral_subagent";

export interface DcTaxiPassenger {
  type: DcPassengerType;
  sessionId: string;
  pid: number;
  taskId?: string;
  agentName?: string;
  model?: string;
  taskLabel?: string;
  startedAt: number;
  heartbeatAt: number;
}

export interface DcTaxiUnit {
  account: string;
  status: DcTaxiStatus;
  passenger: DcTaxiPassenger | null;
}

export interface DcTaxiFleetState {
  fleet: Record<string, DcTaxiUnit>;
  lastUpdated: number;
}

export type DcTripStatus = "completed" | "failed" | "cancelled" | "timeout";

export interface DcTaxiTripTokens {
  input?: number;
  output?: number;
  reasoning?: number;
  total?: number;
}

export interface DcTaxiTripRecord {
  tripId: string;
  account: string;
  passengerType: DcPassengerType;
  model: string;
  effort?: string;
  taskId?: string;
  agentName?: string;
  sessionId: string;
  taskLabel?: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  tokens?: DcTaxiTripTokens;
  costEstimated?: number;
  status: DcTripStatus;
  error?: string;
}

export interface DcTaxiUnitMetrics {
  account: string;
  totalTrips: number;
  completedTrips: number;
  failedTrips: number;
  cancelledTrips: number;
  timeoutTrips: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalDurationMs: number;
  avgDurationMs: number;
  successRate: number;
  lastError?: string;
  lastUsedAt?: number;
}

export interface DcAgentUsageMetrics {
  agentName: string;
  totalTrips: number;
  completedTrips: number;
  failedTrips: number;
  failureRate: number;
  successRate: number;
  totalTokens: number;
  totalDurationMs: number;
  lastUsedAt?: number;
  lastError?: string;
}

export type DcEphemeralToolPreset =
  | "youtube"
  | "browser"
  | "audio"
  | "api"
  | "services"
  | "codegraph"
  | "docs"
  | "research"
  | "scout"
  | "worker"
  | "verifier";

export const DC_TOOL_PRESETS: Record<DcEphemeralToolPreset, string[]> = {
  youtube: [
    "dc_youtube_search",
    "dc_youtube_video_get",
    "dc_youtube_transcript_get",
    "dc_youtube_channel_search",
  ],
  browser: [
    "dc_browser_status",
    "dc_browser_tabs",
    "dc_browser_navigate",
    "dc_browser_screenshot",
  ],
  audio: [
    "dc_markdown_to_audio",
    "dc_text_to_audio",
  ],
  api: [
    "dc_api_rest",
    "dc_api_swagger",
    "dc_api_graphql",
  ],
  services: [
    "dc_services_list",
    "dc_service_start",
    "dc_service_stop",
    "dc_service_restart",
    "dc_service_status",
    "dc_service_logs",
  ],
  codegraph: [
    "dc_codegraph_status",
    "dc_codegraph_node",
    "dc_codegraph_impact",
    "dc_codegraph_explore",
    "dc_codegraph_sync",
  ],
  docs: [
    "dc_pdf_extract",
    "dc_context7_search",
    "dc_context7_get_context",
  ],
  research: [
    "dc_web_search",
    "dc_discussion_search",
    "dc_github_code_search",
    "dc_research_search",
  ],
  scout: [
    "read",
    "find",
    "grep",
    "dc_codegraph_explore",
    "dc_codegraph_status",
  ],
  worker: [
    "read",
    "find",
    "grep",
    "edit",
    "write",
    "bash",
  ],
  verifier: [
    "read",
    "find",
    "grep",
    "bash",
  ],
};

// ============================================================================
// BLOQUES DE LEGO (LEGO BRICKS) & CATÁLOGO DE ARQUETIPOS CANÓNICOS
// ============================================================================

export type DcToolBrick =
  | "fs-read"
  | "fs-write"
  | "terminal"
  | "code-intel"
  | "web-search"
  | "browser"
  | "audio"
  | "services"
  | "docs"
  | "youtube";

export const DC_TOOL_BRICKS: Record<DcToolBrick, string[]> = {
  "fs-read": ["read", "find", "grep"],
  "fs-write": ["edit", "write"],
  "terminal": ["bash"],
  "code-intel": [
    "dc_codegraph_status",
    "dc_codegraph_node",
    "dc_codegraph_impact",
    "dc_codegraph_explore",
    "dc_codegraph_sync",
  ],
  "web-search": [
    "dc_web_search",
    "dc_discussion_search",
    "dc_github_code_search",
    "dc_research_search",
  ],
  "browser": [
    "dc_browser_status",
    "dc_browser_tabs",
    "dc_browser_navigate",
    "dc_browser_screenshot",
  ],
  "audio": [
    "dc_markdown_to_audio",
    "dc_text_to_audio",
  ],
  "services": [
    "dc_services_list",
    "dc_service_start",
    "dc_service_stop",
    "dc_service_restart",
    "dc_service_status",
    "dc_service_logs",
  ],
  "docs": [
    "dc_pdf_extract",
    "dc_context7_search",
    "dc_context7_get_context",
  ],
  "youtube": [
    "dc_youtube_search",
    "dc_youtube_video_get",
    "dc_youtube_transcript_get",
    "dc_youtube_channel_search",
  ],
};

export type DcBehaviorBrick =
  | "strict-tdd"
  | "read-only-analyst"
  | "artifact-contract"
  | "non-empty-response"
  | "source-verification"
  | "bounded-worker";

export const DC_BEHAVIOR_BRICKS: Record<DcBehaviorBrick, string> = {
  "strict-tdd":
    "Aplica desarrollo estricto guiado por pruebas (TDD): primero observa RED antes de implementar, GREEN tras la implementación mínima, y REFACTOR con verificaciones focalizadas. Nunca inventes evidencia de tests ni omitas checks.",
  "read-only-analyst":
    "Operas en modo de solo lectura. Inspecciona la estructura, cita evidencia concreta con formato 'archivo:línea' y no apliques mutaciones de código.",
  "artifact-contract":
    "Devuelve siempre un Contrato de Artefacto conciso al final: Resumen Ejecutivo (qué se hizo o encontró) + Archivos Creados/Modificados + Herramientas Usadas.",
  "non-empty-response":
    "Directiva de Salida Obligatoria: Es mandatorio que tu respuesta final contenga texto visible para el usuario. Nunca finalices tu turno únicamente con bloques de pensamiento interno sin texto.",
  "source-verification":
    "Atribuye cada afirmación técnica relevante a su fuente primaria (URLs oficiales de documentación o archivos y líneas del repositorio local).",
  "bounded-worker":
    "Respeta estrictamente las superficies de edición autorizadas en '## Allowed edit surfaces'. No toques ningún archivo fuera de ese alcance. No realices commits ni pushes.",
};

export type DcAgentArchetype =
  | "odd-scout"
  | "odd-worker"
  | "odd-verifier"
  | "dc-researcher"
  | "dc-media"
  | "dc-browser-inspector"
  | "dc-service-ops"
  | "dc-smoke";

export interface DcArchetypeDefinition {
  name: DcAgentArchetype;
  description: string;
  toolBricks: DcToolBrick[];
  extraTools?: string[];
  behaviorBricks: DcBehaviorBrick[];
  recommendedModel?: string;
  defaultEffort?: DcReasoningEffort;
}

export const DC_AGENT_ARCHETYPES: Record<DcAgentArchetype, DcArchetypeDefinition> = {
  "odd-scout": {
    name: "odd-scout",
    description: "Mapeo y exploración de blast radius en solo lectura para ODD.",
    toolBricks: ["fs-read", "code-intel"],
    behaviorBricks: ["read-only-analyst", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "high",
  },
  "odd-worker": {
    name: "odd-worker",
    description: "Implementación acotada con TDD estricto y verificación en primer plano para ODD.",
    toolBricks: ["fs-read", "fs-write", "terminal"],
    behaviorBricks: ["bounded-worker", "strict-tdd", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "high",
  },
  "odd-verifier": {
    name: "odd-verifier",
    description: "Verificación técnica independiente ejecutando comandos de test/build sin mutar código.",
    toolBricks: ["fs-read", "terminal"],
    behaviorBricks: ["read-only-analyst", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "high",
  },
  "dc-researcher": {
    name: "dc-researcher",
    description: "Investigación técnica profunda en documentación, repositorios y web con contraste de fuentes.",
    toolBricks: ["web-search", "docs", "fs-read"],
    behaviorBricks: ["source-verification", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "high",
  },
  "dc-media": {
    name: "dc-media",
    description: "Operaciones multimedia: búsqueda y transcripción en YouTube y síntesis de voz TTS.",
    toolBricks: ["youtube", "audio"],
    behaviorBricks: ["artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3-flash",
    defaultEffort: "low",
  },
  "dc-browser-inspector": {
    name: "dc-browser-inspector",
    description: "Inspección de UI y navegación en vivo con Chrome DevTools Protocol (CDP).",
    toolBricks: ["browser"],
    behaviorBricks: ["artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "medium",
  },
  "dc-service-ops": {
    name: "dc-service-ops",
    description: "Monitoreo, arranque, reinicio e inspección de logs de servicios en segundo plano.",
    toolBricks: ["services"],
    behaviorBricks: ["artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3-flash",
    defaultEffort: "low",
  },
  "dc-smoke": {
    name: "dc-smoke",
    description: "Smoke test rápido y diagnóstico de salud del entorno.",
    toolBricks: ["fs-read"],
    behaviorBricks: ["artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3-flash",
    defaultEffort: "low",
  },
};

export type DcReasoningEffort = "low" | "medium" | "high" | "off";

export interface DcEphemeralTaskOptions {
  task: string;
  role?: string;
  label?: string;
  seedContext?: string;
  // Catálogo canónico (Fast-path)
  archetype?: DcAgentArchetype;
  // Motor de Legos (Bloques componibles)
  toolBricks?: DcToolBrick[];
  behaviorBricks?: DcBehaviorBrick[];
  // Retrocompatibilidad con presets existentes
  toolPreset?: DcEphemeralToolPreset;
  tools?: string[];
  model?: string;
  effort?: DcReasoningEffort;
  mode?: "task" | "background";
  timeoutMs?: number;
  sessionId?: string;
  cwd?: string;
}

export type DcEnforceProviderPolicy = "force_gemini" | "inherit_or_fallback" | "custom";

export interface DcAgentsRoutingConfig {
  defaultSubagentProvider: string;
  defaultSubagentModel: string;
  enforceProviderPolicy: DcEnforceProviderPolicy;
  fallbackToParent: boolean;
}

export interface DcAgentsEphemeralConfig {
  defaultEffort: "auto" | DcReasoningEffort;
  maxTaskDurationMs: number;
  scoutTimeoutMs: number;
  queryGraceMs: number;
}

export interface DcAgentsAccountPoolConfig {
  provider: string;
  accounts: string[];
  leaseTtlMs: number;
}

export interface DcAgentsConfigFile {
  routing: DcAgentsRoutingConfig;
  ephemeral: DcAgentsEphemeralConfig;
  accountPool: DcAgentsAccountPoolConfig;
}

export const DEFAULT_DC_AGENTS_CONFIG: DcAgentsConfigFile = {
  routing: {
    defaultSubagentProvider: "cpam",
    defaultSubagentModel: "gemini-3.8-flash-high",
    enforceProviderPolicy: "force_gemini",
    fallbackToParent: false,
  },
  ephemeral: {
    defaultEffort: "auto",
    maxTaskDurationMs: 600000, // 10 minutos
    scoutTimeoutMs: 18000,     // 18 segundos para no colgar consultas
    queryGraceMs: 22000,       // 22 segundos para fallback elegante
  },
  accountPool: {
    provider: "cpam",
    accounts: [
      "ac01",
      "ac02",
      "ac03",
      "ac04",
      "ac05",
      "ac06",
      "ac07",
      "ac08",
      "ac09",
      "ac10",
    ],
    leaseTtlMs: 300000,        // 5 minutos
  },
};
