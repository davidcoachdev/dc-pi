import { spawn, type ChildProcess } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";
import { resolveCurrentRepoIdentity, type RepoIdentity } from "./dc-repo-resolver.ts";
import { DcWebhookReceiver } from "./dc-webhook-receiver.ts";
import { dcIssueDispatcher, type DispatchedIssueTask } from "./dc-issue-dispatcher.ts";
import { promptApprovalModal } from "../../dc-approval/views/dc-approval-modal.ts";

export interface DaemonStatus {
  running: boolean;
  port?: number;
  repo?: RepoIdentity;
  tunnelActive: boolean;
  activeDispatches: DispatchedIssueTask[];
}

/**
 * Supervisor del Daemon Autónomo de GitHub Webhooks para DC Studio.
 * - Detecta el repositorio activo dinámicamente (`owner/repo`).
 * - Levanta el receptor HTTP local en loopback (127.0.0.1:4545+).
 * - Spawnea el túnel oficial `gh webhook forward` en background sin bloquear la sesión.
 * - Al recibir un issue, dispara la notificación visual y el aislamiento en worktree.
 */
export class DcWebhookDaemonManager {
  private static instance?: DcWebhookDaemonManager;
  private receiver?: DcWebhookReceiver;
  private tunnelProcess?: ChildProcess;
  private currentRepo?: RepoIdentity;
  private isTunnelRunning = false;

  public static getInstance(): DcWebhookDaemonManager {
    if (!DcWebhookDaemonManager.instance) {
      DcWebhookDaemonManager.instance = new DcWebhookDaemonManager();
    }
    return DcWebhookDaemonManager.instance;
  }

  public async start(ctx?: ExtensionContext): Promise<DaemonStatus> {
    const cwd = ctx?.cwd ?? process.cwd();
    const repo = resolveCurrentRepoIdentity(cwd);

    if (!repo) {
      throw new Error("No se pudo detectar un repositorio Git de GitHub en el directorio actual.");
    }

    this.currentRepo = repo;

    // 1. Detener instancias previas si existían
    await this.stop();

    // 2. Iniciar el receptor HTTP local
      this.receiver = new DcWebhookReceiver({
        port: 4545,
        expectedRepoNwo: repo.fullNwo,
        onIssueOpened: async (payload) => {
          const issue = payload.issue;
          if (!issue) return;
          const userLogin = issue.user?.login ?? "anónimo";
          const msg = `🔔 [GitHub] Nuevo Issue #${issue.number}: ${issue.title} (@${userLogin})`;
          if (ctx) {
            dcNotifier.notify(ctx, "DC GitHub Sentinel", msg, "info");
          }

          try {
            const dispatched = await dcIssueDispatcher.dispatchIssue(
              payload,
              repo,
              (progress) => {
                if (ctx) {
                  dcNotifier.notify(ctx, "DC GitHub Sentinel", progress, "info");
                }
              },
              async (author, issueNum, title) => {
                // Si la terminal no tiene UI interactiva, fail-closed
                if (!ctx?.hasUI) return false;
                // Abre el modal interactivo de aprobación
                const outcome = await promptApprovalModal(ctx, {
                  id: `collab-${author}-${issueNum}`,
                  toolName: "GitHub Issue Webhook",
                  action: `Autorizar a @${author} para despacho autónomo en Issue #${issueNum}`,
                  target: title,
                  reason: `Usuario en estado PENDING abrió el Issue #${issueNum}. Requiere reconocimiento humano para lista blanca.`,
                  timestamp: Date.now(),
                });
                return outcome === "allowed-once";
              },
            );

            if (dispatched && ctx) {
              dcNotifier.notify(
                ctx,
                "DC GitHub Sentinel",
                `✔ Worktree preparado para Issue #${issue.number} en rama ${dispatched.branchName}`,
                "info",
              );
            }
          } catch (err: any) {
            if (ctx) {
              dcNotifier.notify(ctx, "DC GitHub Sentinel", `Error aislando Issue #${issue.number}: ${err.message}`, "error");
            }
          }
        },
        onError: (err) => {
          if (ctx) {
            dcNotifier.notify(ctx, "DC Webhook Daemon", `Error receptor: ${err.message}`, "error");
          }
        },
      });

    const activePort = await this.receiver.start();

    // 3. Iniciar el túnel oficial con gh webhook forward
    this.startTunnel(repo.fullNwo, activePort, ctx);

    return this.getStatus();
  }

  private startTunnel(repoNwo: string, port: number, ctx?: ExtensionContext): void {
    const url = `http://127.0.0.1:${port}/github-webhook`;
    const args = ["webhook", "forward", `--repo=${repoNwo}`, "--events=issues", `--url=${url}`];

    try {
      const child = spawn("gh", args, {
        stdio: ["ignore", "ignore", "ignore"],
      });
      this.tunnelProcess = child;
      this.isTunnelRunning = true;

      child.on("error", (err) => {
        if (this.tunnelProcess === child) {
          this.isTunnelRunning = false;
        }
        if (ctx) {
          dcNotifier.notify(ctx, "DC Webhook Tunnel", `Fallo túnel gh: ${err.message}`, "error");
        }
      });

      child.on("exit", (code) => {
        if (this.tunnelProcess === child) {
          this.isTunnelRunning = false;
        }
        if (code !== 0 && code !== null && ctx) {
          dcNotifier.notify(ctx, "DC Webhook Tunnel", `Túnel gh finalizado (código ${code})`, "warning");
        }
      });

      child.unref?.();
    } catch (err: any) {
      this.isTunnelRunning = false;
      if (ctx) {
        dcNotifier.notify(ctx, "DC Webhook Tunnel", `No se pudo iniciar gh webhook: ${err.message}`, "error");
      }
    }
  }

  public async stop(): Promise<void> {
    if (this.tunnelProcess) {
      const p = this.tunnelProcess;
      this.tunnelProcess = undefined;
      this.isTunnelRunning = false;
      try {
        p.kill("SIGTERM");
      } catch {
        /* noop */
      }
    }

    if (this.receiver) {
      await this.receiver.stop();
      this.receiver = undefined;
    }
  }

  public getStatus(): DaemonStatus {
    return {
      running: this.receiver?.isRunning() ?? false,
      port: this.receiver?.getPort(),
      repo: this.currentRepo,
      tunnelActive: this.isTunnelRunning,
      activeDispatches: dcIssueDispatcher.getActiveDispatches(),
    };
  }
}

export const dcWebhookDaemonManager = DcWebhookDaemonManager.getInstance();
