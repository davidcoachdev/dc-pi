import * as http from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { GitHubIssuePayload } from "./dc-issue-dispatcher.ts";
import type { GitHubIssueCommentPayload } from "./dc-issue-comment-types.ts";
import {
  DC_SUPER_AGENT_EVENT_TRIGGERS,
  type DcSuperAgentDefinition,
  type DcSuperAgentEventHandler,
  type DcSuperAgentEventPayload,
  type DcSuperAgentEventTrigger,
} from "../core/dc-super-agent-definition.ts";
import { dcSuperAgentRegistry, type DcSuperAgentRegistry } from "../core/dc-super-agent-registry.ts";

export interface GitHubGatewayOptions {
  port?: number;
  capability?: string;
  host?: string;
  expectedRepoNwo?: string; // ej: "davidcoachdev/dc-pi"
  gatewayId?: string;
  gatewayName?: string;
  registry?: DcSuperAgentRegistry;
  agentHandlers?: Record<number, DcSuperAgentEventHandler>;
  onAgentRouted?: (agent: DcSuperAgentDefinition, event: DcSuperAgentEventPayload) => void;
  onIssueOpened?: (payload: GitHubIssuePayload) => void | Promise<void>;
  onIssueCommentCreated?: (payload: GitHubIssueCommentPayload) => void | Promise<void>;
  onPullRequest?: (payload: any) => void | Promise<void>;
  onPullRequestReview?: (payload: any) => void | Promise<void>;
  onError?: (err: Error) => void;
  onLog?: (msg: string) => void;
}

export interface GitHubGatewayMetadata {
  id: string;
  name: string;
  role: "ingress_gateway";
  host: string;
  port: number;
  running: boolean;
  expectedRepoNwo?: string;
  registeredAgents: number[];
  supportedTriggers: DcSuperAgentEventTrigger[];
}

const TRIGGER_TO_GITHUB_EVENT: Partial<Record<DcSuperAgentEventTrigger, string>> = {
  issue_opened: "issues",
  issue_comment: "issue_comment",
  pull_request: "pull_request",
  pull_request_review: "pull_request_review",
};

/**
 * Gateway Ingress Neutral para Webhooks de GitHub en DC Studio.
 * Actúa como la antena receptora central del sistema, desacoplada de la identidad
 * de cualquier agente específico (#86, #99, etc.), enrutando eventos dinámicamente
 * según los triggers registrados en DcSuperAgentRegistry.
 */
export class DcGitHubGateway {
  private server?: http.Server;
  private port: number;
  private host: string;
  private expectedRepoNwo?: string;
  private processedDeliveries = new Set<string>(); // X-GitHub-Delivery deduplication
  private isListening = false;
  private readonly gatewayId: string;
  private readonly gatewayName: string;
  private readonly registry: DcSuperAgentRegistry;
  private readonly agentHandlers = new Map<number, DcSuperAgentEventHandler>();

  constructor(private options: GitHubGatewayOptions = {}) {
    this.port = options.port ?? 4545;
    this.host = "127.0.0.1";
    this.expectedRepoNwo = options.expectedRepoNwo?.toLowerCase();
    this.gatewayId = options.gatewayId ?? "dc_github_gateway";
    this.gatewayName = options.gatewayName ?? "DC GitHub Ingress Gateway";
    this.registry = options.registry ?? dcSuperAgentRegistry;

    if (options.agentHandlers) {
      for (const [key, handler] of Object.entries(options.agentHandlers)) {
        const agentNum = Number(key);
        if (Number.isInteger(agentNum) && typeof handler === "function") {
          this.agentHandlers.set(agentNum, handler);
        }
      }
    }
  }

  public setExpectedRepo(repoNwo: string): void {
    this.expectedRepoNwo = repoNwo.toLowerCase();
  }

  public getPort(): number {
    return this.port;
  }

  public getHost(): string {
    return this.host;
  }

  public isRunning(): boolean {
    return this.isListening;
  }

  public getRegistry(): DcSuperAgentRegistry {
    return this.registry;
  }

  public registerAgentHandler(agentNumber: number, handler: DcSuperAgentEventHandler): void {
    this.agentHandlers.set(agentNumber, handler);
  }

  public unregisterAgentHandler(agentNumber: number): boolean {
    return this.agentHandlers.delete(agentNumber);
  }

  public getMetadata(): GitHubGatewayMetadata {
    return {
      id: this.gatewayId,
      name: this.gatewayName,
      role: "ingress_gateway",
      host: this.host,
      port: this.port,
      running: this.isListening,
      expectedRepoNwo: this.expectedRepoNwo,
      registeredAgents: this.registry.listAgents().map((a) => a.agentNumber),
      supportedTriggers: [...DC_SUPER_AGENT_EVENT_TRIGGERS],
    };
  }

  /**
   * Deriva la lista de eventos GitHub a suscribir en `gh webhook forward`
   * a partir de los triggers de los Super-Agentes registrados.
   */
  public getSubscribedGitHubEvents(): string[] {
    const events = new Set<string>();
    for (const agent of this.registry.listAgents()) {
      for (const trigger of agent.eventTriggers) {
        const ghEvent = TRIGGER_TO_GITHUB_EVENT[trigger];
        if (ghEvent) {
          events.add(ghEvent);
        }
      }
    }
    if (events.size === 0) {
      return ["issues", "issue_comment", "pull_request"];
    }
    return Array.from(events);
  }

  /**
   * Enruta un evento al conjunto de Super-Agentes suscritos al trigger en el Registry.
   * Preserva compatibilidad con callbacks directos (`onIssueOpened`, `onIssueCommentCreated`,
   * `onPullRequest`, `onPullRequestReview`) para los agentes canónicos #86 y #99.
   */
  public routeEvent(
    trigger: DcSuperAgentEventTrigger,
    payload: any,
    meta?: { githubEvent?: string; action?: string },
  ): DcSuperAgentDefinition[] {
    const matchedAgents = this.registry.getAgentsForTrigger(trigger);
    const eventPayload: DcSuperAgentEventPayload = {
      trigger,
      githubEvent: meta?.githubEvent,
      action: meta?.action,
      payload,
    };

    for (const agent of matchedAgents) {
      const customHandler =
        this.agentHandlers.get(agent.agentNumber) ??
        this.registry.getHandler(agent.agentNumber);

      if (customHandler) {
        this.invokeCallback(() => customHandler(eventPayload));
      } else {
        this.invokeLegacyCallbackForAgent(trigger, agent, payload);
      }

      if (this.options.onAgentRouted) {
        this.invokeCallback(() => this.options.onAgentRouted!(agent, eventPayload));
      }
    }

    return matchedAgents;
  }

  public start(): Promise<number> {
    if (this.isListening && this.server) {
      return Promise.resolve(this.port);
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          // Reintentar en siguiente puerto en loopback si el puerto está ocupado
          this.port += 1;
          this.options.onLog?.(`Puerto ocupado, reintentando en ${this.port}...`);
          this.server?.listen(this.port, this.host);
        } else {
          this.isListening = false;
          this.options.onError?.(err);
          reject(err);
        }
      });

      this.server.listen(this.port, this.host, () => {
        this.isListening = true;
        this.port = (this.server!.address() as import("node:net").AddressInfo).port;
        this.options.onLog?.(`${this.gatewayName} escuchando en http://${this.host}:${this.port}/github-webhook`);
        resolve(this.port);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server && this.isListening) {
        this.server.close(() => {
          this.isListening = false;
          this.server = undefined;
          resolve();
        });
      } else {
        this.isListening = false;
        this.server = undefined;
        resolve();
      }
    });
  }

  private invokeCallback(fn: () => void | Promise<void>): void {
    try {
      const result = fn();
      if (result && typeof (result as any).catch === "function") {
        (result as Promise<void>).catch((cbErr) => {
          this.options.onError?.(cbErr);
        });
      }
    } catch (syncErr: any) {
      this.options.onError?.(syncErr);
    }
  }

  private invokeLegacyCallbackForAgent(
    trigger: DcSuperAgentEventTrigger,
    agent: DcSuperAgentDefinition,
    payload: any,
  ): void {
    if (trigger === "issue_opened" && (agent.agentNumber === 86 || agent.role === "issue_resolver")) {
      if (this.options.onIssueOpened) {
        this.invokeCallback(() => this.options.onIssueOpened!(payload as GitHubIssuePayload));
      }
      return;
    }

    if (trigger === "issue_comment" && (agent.agentNumber === 86 || agent.role === "issue_resolver")) {
      if (this.options.onIssueCommentCreated) {
        this.invokeCallback(() => this.options.onIssueCommentCreated!(payload as GitHubIssueCommentPayload));
      }
      return;
    }

    if (trigger === "pull_request" && (agent.agentNumber === 99 || agent.role === "pr_inspector")) {
      if (this.options.onPullRequest) {
        this.invokeCallback(() => this.options.onPullRequest!(payload));
      }
      return;
    }

    if (trigger === "pull_request_review" && (agent.agentNumber === 99 || agent.role === "pr_inspector")) {
      if (this.options.onPullRequestReview) {
        this.invokeCallback(() => this.options.onPullRequestReview!(payload));
      }
    }
  }

  private recordDeliveryOrDetectDuplicate(deliveryId: string): boolean {
    if (!deliveryId) return false;
    if (this.processedDeliveries.has(deliveryId)) {
      return true;
    }
    this.processedDeliveries.add(deliveryId);
    if (this.processedDeliveries.size > 500) {
      this.processedDeliveries.delete(this.processedDeliveries.values().next().value!);
    }
    return false;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Solo aceptamos POST a /github-webhook o /
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }
    if (req.method !== "POST" || (url.pathname !== "/github-webhook" && url.pathname !== "/")) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const supplied = Buffer.from(url.searchParams.get("capability") ?? "");
    const expected = Buffer.from(this.options.capability ?? "");
    if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.writeHead(401);
      res.end("Unauthorized");
      return;
    }

    const deliveryId = (req.headers["x-github-delivery"] as string) || "";
    const eventType = req.headers["x-github-event"] as string;

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      // Protección de tamaño: 5 MB máx
      if (body.length > 5 * 1024 * 1024) {
        res.writeHead(413, { "Content-Type": "text/plain" });
        res.end("Payload Too Large");
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        const payload = JSON.parse(body);

        // Validar repositorio si está restringido
        const incomingRepo = typeof payload?.repository?.full_name === "string" ? payload.repository.full_name.toLowerCase() : "";
        if (!this.expectedRepoNwo || incomingRepo !== this.expectedRepoNwo) {
          res.writeHead(403);
          res.end("Repository mismatch");
          return;
        }

        // Ping de GitHub Webhook
        if (eventType === "ping") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "pong", gateway: this.gatewayId, zen: payload.zen }));
          return;
        }

        // Evento de Issues (enrutado dinámicamente por Registry para trigger "issue_opened")
        if (eventType === "issues" && payload.issue && payload.action === "opened") {
          if (this.recordDeliveryOrDetectDuplicate(deliveryId)) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ignored_duplicate" }));
            return;
          }

          const routed = this.routeEvent("issue_opened", payload, {
            githubEvent: eventType,
            action: payload.action,
          });

          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            status: "accepted",
            issue: payload.issue?.number,
            title: payload.issue?.title,
            routedAgents: routed.map((a) => a.agentNumber),
          }));
          return;
        }

        // Evento de Pull Requests (enrutado dinámicamente por Registry para trigger "pull_request")
        if (
          eventType === "pull_request" &&
          payload.pull_request &&
          ["opened", "synchronize", "reopened", "ready_for_review"].includes(payload.action)
        ) {
          if (this.recordDeliveryOrDetectDuplicate(deliveryId)) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ignored_duplicate" }));
            return;
          }

          const routed = this.routeEvent("pull_request", payload, {
            githubEvent: eventType,
            action: payload.action,
          });

          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            status: "accepted_pr",
            prNumber: payload.pull_request?.number,
            action: payload.action,
            routedAgents: routed.map((a) => a.agentNumber),
          }));
          return;
        }

        // Evento de Pull Request Reviews (trigger "pull_request_review")
        if (
          eventType === "pull_request_review" &&
          payload.review &&
          payload.pull_request &&
          ["submitted", "edited"].includes(payload.action)
        ) {
          if (this.recordDeliveryOrDetectDuplicate(deliveryId)) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ignored_duplicate" }));
            return;
          }

          const routed = this.routeEvent("pull_request_review", payload, {
            githubEvent: eventType,
            action: payload.action,
          });

          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            status: "accepted_pr_review",
            prNumber: payload.pull_request?.number,
            action: payload.action,
            routedAgents: routed.map((a) => a.agentNumber),
          }));
          return;
        }

        // Evento de Comentarios en Issues (enrutado dinámicamente por Registry para trigger "issue_comment")
        if (eventType === "issue_comment" && payload.comment && payload.issue && payload.action === "created") {
          if (this.recordDeliveryOrDetectDuplicate(deliveryId)) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ignored_duplicate" }));
            return;
          }

          const routed = this.routeEvent("issue_comment", payload, {
            githubEvent: eventType,
            action: payload.action,
          });

          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            status: "accepted_comment",
            issue: payload.issue?.number,
            commentId: payload.comment?.id,
            routedAgents: routed.map((a) => a.agentNumber),
          }));
          return;
        }

        // Otros eventos no relevantes
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ignored_event", event: eventType }));
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request");
      }
    });
  }
}
