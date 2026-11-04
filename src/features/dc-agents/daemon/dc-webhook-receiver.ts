import * as http from "node:http";
import type { GitHubIssuePayload } from "./dc-issue-dispatcher.ts";

export interface WebhookReceiverOptions {
  port?: number;
  host?: string;
  expectedRepoNwo?: string; // ej: "davidcoachdev/dc-pi"
  onIssueOpened?: (payload: GitHubIssuePayload) => void | Promise<void>;
  onError?: (err: Error) => void;
  onLog?: (msg: string) => void;
}

export class DcWebhookReceiver {
  private server?: http.Server;
  private port: number;
  private host: string;
  private expectedRepoNwo?: string;
  private processedDeliveries = new Set<string>(); // X-GitHub-Delivery deduplication
  private isListening = false;

  constructor(private options: WebhookReceiverOptions = {}) {
    this.port = options.port ?? 4545;
    this.host = options.host ?? "127.0.0.1";
    this.expectedRepoNwo = options.expectedRepoNwo?.toLowerCase();
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
          // Reintentar en siguiente puerto en loopback si 4545 está ocupado
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
        this.options.onLog?.(`Receptor de Webhooks escuchando en http://${this.host}:${this.port}/github-webhook`);
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

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Solo aceptamos POST a /github-webhook o /
    const url = req.url ?? "/";
    if (req.method !== "POST" || (url !== "/github-webhook" && url !== "/")) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const deliveryId = (req.headers["x-github-delivery"] as string) || "";
    if (deliveryId && this.processedDeliveries.has(deliveryId)) {
      // Idempotencia: Ya procesado
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ignored_duplicate" }));
      return;
    }

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

        if (deliveryId) {
          this.processedDeliveries.add(deliveryId);
          // Mantener tamaño de Set acotado a últimas 500 entregas
          if (this.processedDeliveries.size > 500) {
            const first = this.processedDeliveries.values().next().value;
            if (first) this.processedDeliveries.delete(first);
          }
        }

        // Validar repositorio si está restringido
        if (this.expectedRepoNwo) {
          const incomingRepo = payload.repository?.full_name ? String(payload.repository.full_name).toLowerCase() : "";
          if (incomingRepo && incomingRepo !== this.expectedRepoNwo) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ignored_foreign_repo", repo: incomingRepo }));
            return;
          }
        }

        // Ping de GitHub Webhook
        if (eventType === "ping") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "pong", zen: payload.zen }));
          return;
        }

        // Evento de Issues
        if (eventType === "issues" || payload.issue) {
          const action = payload.action;
          if (action === "opened") {
            try {
              const resCallback = this.options.onIssueOpened?.(payload as GitHubIssuePayload);
              if (resCallback && typeof (resCallback as any).catch === "function") {
                (resCallback as Promise<void>).catch((cbErr) => {
                  this.options.onError?.(cbErr);
                });
              }
            } catch (syncErr: any) {
              this.options.onError?.(syncErr);
            }

            res.writeHead(202, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              status: "accepted",
              issue: payload.issue?.number,
              title: payload.issue?.title,
            }));
            return;
          }
        }

        // Otros eventos no relevantes
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ignored_event", event: eventType }));
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(`Bad Request: ${err.message}`);
      }
    });
  }
}
