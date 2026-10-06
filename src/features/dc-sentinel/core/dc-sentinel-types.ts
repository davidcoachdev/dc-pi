export interface SentinelRecallItem {
  id: number;
  type: string;
  title: string;
  content: string;
  scope: string;
  score: number;
  createdAt?: string;
}

export interface SentinelRecallResult {
  prompt: string;
  keywords: string[];
  items: SentinelRecallItem[];
  formattedBlock?: string;
}

export interface SentinelToolExecution {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  startedAt: number;
  endedAt?: number;
  isError?: boolean;
  outputSnippet?: string;
}

export interface SentinelSubagentLaunch {
  agent: string;
  task: string;
  mode?: string;
  startedAt: number;
  endedAt?: number;
  isError?: boolean;
  resultSnippet?: string;
}

export interface SentinelTurnRecord {
  turnId: string;
  timestamp: string;
  userPrompt: string;
  recallInjected?: boolean;
  recalledTitles?: string[];
  toolsExecuted: SentinelToolExecution[];
  subagentsLaunched: SentinelSubagentLaunch[];
  assistantSummary?: string;
  errorsDetected: string[];
}

// ============================================================================
// Sentinel 2.0 Soberana Types (Zettelkasten, Memvid, Claude-Mem, Engram)
// ============================================================================

export type SentinelActor = "[USER]" | "[ORCHESTRATOR]" | "[SUBAGENT]" | "[TOOL]";

export type SentinelNoteType =
  | "decision"
  | "bugfix"
  | "feature"
  | "refactor"
  | "discovery"
  | "change"
  | "security_alert"
  | "security_note"
  | "sensitive"
  | "procedure";

export type SentinelConcept =
  | "how-it-works"
  | "why-it-exists"
  | "what-changed"
  | "problem-solution"
  | "gotcha"
  | "pattern"
  | "trade-off";

export const SENTINEL_TYPE_GLYPHS: Record<SentinelNoteType, string> = {
  decision: "⚖",
  bugfix: "●",
  feature: "◆",
  refactor: "↻",
  discovery: "○",
  change: "✓",
  security_alert: "⚠",
  security_note: "⚷",
  sensitive: "⊘",
  procedure: "⚒",
};

export interface SmartFrame {
  id?: number;
  frameSeq?: number;
  sessionId: string;
  turnId: string;
  actor: SentinelActor;
  eventType: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  checksum?: string;
  createdAt?: string;
}

export interface SentinelBlastRadius {
  filesCount: number;
  callCount: number;
  risk: "low" | "medium" | "high";
  summary?: string;
}

export interface SentinelNote {
  id?: number;
  project: string;
  scope?: "project" | "global" | string;
  type: SentinelNoteType;
  glyph: string;
  title: string;
  content: string;
  topicKey?: string;
  normalizedHash?: string;
  revisionCount?: number;
  duplicateCount?: number;
  lastSeenAt?: string;
  concepts?: SentinelConcept[];
  filesAffected?: string[];
  blastRadius?: SentinelBlastRadius;
  proofCount?: number;
  status?: "active" | "proposal" | "superseded" | "archived";
  pinned?: boolean;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

export interface SentinelProcedure {
  id?: number;
  project: string;
  name: string;
  title: string;
  triggerPattern: string;
  symptoms: string;
  preconditions: string;
  steps: string[];
  verificationCmd?: string;
  successRate?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SentinelRelation {
  id?: number;
  sourceId: number;
  targetId: number;
  relation: "supersedes" | "conflicts_with" | "depends_on" | "related_to";
  reason?: string;
  confidence?: number;
  createdAt?: string;
}

export interface MemoryChipItem {
  id: string | number;
  text: string;
  change: "added" | "updated" | "existing";
  type: SentinelNoteType;
  glyph: string;
}

export interface SentinelStats {
  framesCount: number;
  notesCount: number;
  proceduresCount: number;
  relationsCount: number;
  activeProjects: string[];
  dbPath: string;
}

