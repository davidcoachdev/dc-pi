import { DcSuperAgentRegistry } from "./dc-super-agent-registry.ts";

export interface DcSuperAgentDefinition {
  agentNumber: number; // e.g. 86, 99, 0
  id: string;          // e.g. "super_agent_86", "super_agent_99"
  name: string;        // e.g. "DC Super-Agent #86 (Issue Resolver)"
  role: "issue_resolver" | "pr_inspector" | "supervisor" | string;
  description: string;
  eventTriggers: Array<"issue_opened" | "issue_comment" | "pull_request" | "pull_request_review" | "chat">;
  systemDirectives: string[];
  worktreeScope: "isolated_per_task" | "repo" | "none";
}
