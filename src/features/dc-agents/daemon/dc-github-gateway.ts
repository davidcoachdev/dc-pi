import * as http from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { GitHubIssuePayload } from "./dc-issue-dispatcher.ts";
import type { GitHubIssueCommentPayload } from "./dc-issue-comment-types.ts";
import { DcControlReceiver, type ControlReceiverOptions } from "./dc-control-receiver.ts";

export interface GitHubGatewayOptions extends ControlReceiverOptions {
  onPullRequest?: (payload: any) => void | Promise<void>;
  onPullRequestReview?: (payload: any) => void | Promise<void>;
}

/**
 * Gateway Ingress Neutral para Webhooks de GitHub en DC Studio.
 * Actúa como la antena receptora central del sistema, desacoplada de la identidad
 * de cualquier agente específico (#86, #99, etc.).
 */
export class DcGitHubGateway extends DcControlReceiver {
  constructor(options: GitHubGatewayOptions = {}) {
    super(options);
  }
}
