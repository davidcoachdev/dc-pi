/**
 * dc-ephemeral-types.ts — Contratos puros, tipos y presets para el Sistema de Agentes Efímeros
 * y Flota de Taxis (Libre / Ocupado) de DC Studio.
 *
 * Cumple estrictamente con la Directiva 1 de DC Studio (cero dependencias de Pi / pi-tui).
 */

export type DcTaxiStatus = "libre" | "ocupado";

export type DcPassengerType = "orchestrator" | "subagent" | "ephemeral_subagent";

export interface DcTaxiPassenger {
  type: DcPassengerType;
  sessionId: string;
  pid: number;
  taskId?: string;
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

export type DcEphemeralToolPreset =
  | "youtube"
  | "browser"
  | "audio"
  | "api"
  | "services"
  | "codegraph"
  | "docs"
  | "research"
  | "scout";

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
};

export type DcReasoningEffort = "low" | "medium" | "high" | "off";

export interface DcEphemeralTaskOptions {
  task: string;
  role?: string;
  label?: string;
  seedContext?: string;
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
