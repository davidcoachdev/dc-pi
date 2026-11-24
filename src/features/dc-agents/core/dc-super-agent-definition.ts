export const DC_SUPER_AGENT_EVENT_TRIGGERS = [
  "issue_opened",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "chat",
] as const;

export type DcSuperAgentEventTrigger = (typeof DC_SUPER_AGENT_EVENT_TRIGGERS)[number];

export interface DcSuperAgentEventPayload {
  trigger: DcSuperAgentEventTrigger;
  githubEvent?: string;
  action?: string;
  payload: any;
}

export type DcSuperAgentEventHandler = (event: DcSuperAgentEventPayload) => void | Promise<void>;

export interface DcSuperAgentDefinition {
  agentNumber: number; // e.g. 86, 99, 0
  id: string;          // e.g. "super_agent_86", "super_agent_99"
  name: string;        // e.g. "DC Super-Agent #86 (Issue Resolver)"
  role: "issue_resolver" | "pr_inspector" | "supervisor" | string;
  description: string;
  eventTriggers: DcSuperAgentEventTrigger[];
  systemDirectives: string[];
  worktreeScope: "isolated_per_task" | "repo" | "none";
  icon?: string;
  handler?: DcSuperAgentEventHandler;
}
