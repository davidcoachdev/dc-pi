import { DcGitHubGateway, type GitHubGatewayOptions } from "./dc-github-gateway.ts";

export type ControlReceiverOptions = GitHubGatewayOptions;
export type WebhookReceiverOptions = ControlReceiverOptions;

/**
 * Alias retrocompatible del receptor HTTP sobre el Gateway Ingress neutral (`DcGitHubGateway`).
 */
export class DcControlReceiver extends DcGitHubGateway {
  constructor(options: ControlReceiverOptions = {}) {
    super(options);
  }
}

export const DcWebhookReceiver = DcControlReceiver;
