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
    "dc_context7_status",
    "dc_context7_search",
    "dc_context7_get_context",
  ],
  research: [
    "dc_web_search",
    "dc_web_fetch",
    "dc_discussion_search",
    "dc_discussion_answers_get",
    "dc_github_code_search",
    "dc_github_get",
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
    "dc_web_fetch",
    "dc_discussion_search",
    "dc_discussion_answers_get",
    "dc_github_code_search",
    "dc_github_get",
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
    "dc_context7_status",
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
  | "bounded-worker"
  | "dag-planning"
  | "verify-independent";

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
  "dag-planning":
    "Diseña el plan como un Grafo Acíclico Dirigido (DAG) acíclico y topológicamente ejecutable. Define 'Allowed edit surfaces' explícitas sin '.' ni rutas absolutas. Asigna dependencias explícitas por tarea (T1, T2...) sin referencias circulares ni hacia adelante. Limita cada tarea a un presupuesto de revisión razonable (~150 líneas).",
  "verify-independent":
    "Opera como auditor independiente sin asumir que los reportes previos son ciertos. Ejecuta personalmente los tests y aserciones. Audita la disciplina TDD y rechaza tajantemente pruebas con tautologías (assert.ok(true)), tests que solo comprueben tipos sin comportamiento, o suites vacías.",
};

export type DcAgentArchetype =
  // DC Studio Mini SDD (Planned Workflow)
  | "dc-phase-discovery"
  | "dc-phase-planning"
  | "dc-phase-apply"
  | "dc-phase-verify"
  // DC Studio ODD Workflow
  | "dc-odd-scout"
  | "dc-odd-worker"
  | "dc-odd-verifier"
  | "dc-odd-planner"
  // DC Studio Specialized Auxiliaries
  | "dc-researcher"
  | "dc-news-to-day"
  | "dc-ui-visual-inspector"
  | "dc-browser-inspector"
  | "dc-pr-comment-analyst"
  | "dc-sentinel"
  | "dc-smoke"
  | "dc-media"
  | "dc-service-ops";

export const DC_ARCHETYPE_ALIASES: Record<string, DcAgentArchetype> = {
  "odd-scout": "dc-odd-scout",
  "odd-worker": "dc-odd-worker",
  "odd-verifier": "dc-odd-verifier",
  "odd-planner": "dc-odd-planner",
  "dc-smoke-subagent": "dc-smoke",
  "ui-visual-inspector": "dc-ui-visual-inspector",
  "pr-comment-analyst": "dc-pr-comment-analyst",
};

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
  // --- DC Studio Mini SDD (Planned Workflow) ---
  "dc-phase-discovery": {
    name: "dc-phase-discovery",
    description: "Fase 0 del Mini SDD de DC Studio: explora el problema en solo lectura y genera discovery.md.",
    toolBricks: ["fs-read", "code-intel", "docs"],
    behaviorBricks: ["read-only-analyst", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "high",
  },
  "dc-phase-planning": {
    name: "dc-phase-planning",
    description: "Fase 1 del Mini SDD de DC Studio: diseña solución técnica, superficies y tareas DAG en plan.md.",
    toolBricks: ["fs-read", "code-intel", "docs"],
    behaviorBricks: ["read-only-analyst", "dag-planning", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "high",
  },
  "dc-phase-apply": {
    name: "dc-phase-apply",
    description: "Fase 2 del Mini SDD de DC Studio: implementa código bajo TDD estricto y registra apply.md.",
    toolBricks: ["fs-read", "fs-write", "terminal", "code-intel"],
    behaviorBricks: ["bounded-worker", "strict-tdd", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "high",
  },
  "dc-phase-verify": {
    name: "dc-phase-verify",
    description: "Fase 3 del Mini SDD de DC Studio: auditoría independiente de tests y calidad TDD en verify.md.",
    toolBricks: ["fs-read", "terminal", "code-intel"],
    behaviorBricks: ["read-only-analyst", "verify-independent", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "high",
  },

  // --- DC Studio ODD Workflow ---
  "dc-odd-scout": {
    name: "dc-odd-scout",
    description: "Mapeo y exploración de blast radius en solo lectura para ODD.",
    toolBricks: ["fs-read", "code-intel"],
    behaviorBricks: ["read-only-analyst", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "high",
  },
  "dc-odd-worker": {
    name: "dc-odd-worker",
    description: "Implementación acotada con TDD estricto y verificación en primer plano para ODD.",
    toolBricks: ["fs-read", "fs-write", "terminal"],
    behaviorBricks: ["bounded-worker", "strict-tdd", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "high",
  },
  "dc-odd-verifier": {
    name: "dc-odd-verifier",
    description: "Verificación técnica independiente ejecutando comandos de test/build sin mutar código.",
    toolBricks: ["fs-read", "terminal"],
    behaviorBricks: ["read-only-analyst", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "high",
  },
  "dc-odd-planner": {
    name: "dc-odd-planner",
    description: "Planificación y descomposición de tareas ODD con superficies acotadas.",
    toolBricks: ["fs-read", "code-intel"],
    behaviorBricks: ["read-only-analyst", "dag-planning", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "high",
  },

  // --- DC Studio Specialized Auxiliaries ---
  "dc-researcher": {
    name: "dc-researcher",
    description: "Investigación técnica profunda en documentación, repositorios y web con contraste de fuentes.",
    toolBricks: ["web-search", "docs", "fs-read"],
    behaviorBricks: ["source-verification", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "high",
  },
  "dc-news-to-day": {
    name: "dc-news-to-day",
    description: "Investiga noticias tecnológicas, lanzamientos y genera informe narrativo y fuentes.",
    toolBricks: ["web-search", "youtube", "audio", "fs-read"],
    behaviorBricks: ["source-verification", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "high",
  },
  "dc-ui-visual-inspector": {
    name: "dc-ui-visual-inspector",
    description: "Auditoría visual de layout, DOM, CSS/Tailwind y breakpoints con Chrome CDP y lectura.",
    toolBricks: ["fs-read", "browser", "terminal"],
    behaviorBricks: ["read-only-analyst", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "medium",
  },
  "dc-browser-inspector": {
    name: "dc-browser-inspector",
    description: "Inspección de UI y navegación en vivo con Chrome DevTools Protocol (CDP).",
    toolBricks: ["browser"],
    behaviorBricks: ["artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "medium",
  },
  "dc-pr-comment-analyst": {
    name: "dc-pr-comment-analyst",
    description: "Triage y clasificación de comentarios de GitHub Pull Requests en solo lectura.",
    toolBricks: ["fs-read", "terminal"],
    behaviorBricks: ["read-only-analyst", "artifact-contract", "non-empty-response"],
    recommendedModel: "gemini-3.8-flash-high",
    defaultEffort: "medium",
  },
  "dc-sentinel": {
    name: "dc-sentinel",
    description: "Síntesis arquitectónica, bitácora y consolidación de memoria en Engram/SQLite.",
    toolBricks: ["fs-read"],
    behaviorBricks: ["read-only-analyst", "artifact-contract", "non-empty-response"],
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
