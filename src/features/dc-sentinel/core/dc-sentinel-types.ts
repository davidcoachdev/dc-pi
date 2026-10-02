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
