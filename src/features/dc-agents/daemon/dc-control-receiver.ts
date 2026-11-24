import { DcGitHubGateway, type GitHubGatewayOptions } from "./dc-github-gateway.ts";

export type ControlReceiverOptions = GitHubGatewayOptions;

/**
 * Receptor HTTP canónico sobre el Gateway Ingress neutral (`DcGitHubGateway`).
 */
export class DcControlReceiver extends DcGitHubGateway {
  constructor(options: ControlReceiverOptions = {}) {
    super(options);
  }
}
