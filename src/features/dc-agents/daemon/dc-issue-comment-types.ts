import type { GitHubIssuePayload } from "./dc-issue-dispatcher.ts";

export interface GitHubIssueCommentPayload {
  action: "created" | "edited" | "deleted";
  issue: GitHubIssuePayload["issue"];
  comment: {
    id: number;
    body: string;
    user: {
      login: string;
    };
    html_url: string;
    created_at: string;
    updated_at: string;
  };
  repository: GitHubIssuePayload["repository"];
  sender: {
    login: string;
  };
}

export interface IssueCommentCommandResult {
  handled: boolean;
  response?: string;
  reason?: string;
}
