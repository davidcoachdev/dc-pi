import { spawn, type ChildProcess } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";
import { resolveCurrentRepoIdentity, type RepoIdentity } from "./dc-repo-resolver.ts";
import { DcWebhookReceiver } from "./dc-webhook-receiver.ts";
import { dcIssueDispatcher, type DispatchedIssueTask } from "./dc-issue-dispatcher.ts";
import { promptApprovalModal } from "../../dc-approval/views/dc-approval-modal.ts";
import { dcPrDelivery } from "./dc-pr-delivery.ts";
import { dcWorkerRunner, updateWorktreeOddRoadmap } from "./dc-worker-runner.ts";
import { prepareEphemeralAgent, cleanupEphemeralAgent } from "../core/dc-ephemeral-manager.ts";

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

            if (dispatched) {
              if (ctx) {
                dcNotifier.notify(
                  ctx,
                  "DC GitHub Sentinel",
                  `✔ Worktree preparado para Issue #${issue.number} en rama ${dispatched.branchName}. Iniciando resolución autónoma...`,
                  "info",
                );
              }

              // Disparo autónomo en segundo plano del superagente con Taxi de Flota
              void (async () => {
                let ephemeralPlan: ReturnType<typeof prepareEphemeralAgent> | undefined;
                const workerSessionId = `dc-super-agent-issue-${issue.number}-${Date.now()}`;

                try {
                  // 1. Arrendar Taxi en la Flota y preparar definición de DC Super-Agent con contrato estricto de Allowed edit surfaces
                  ephemeralPlan = prepareEphemeralAgent(
                    {
                      task: [
                        `Misión autónoma de DC Super-Agent: Resolver Issue #${issue.number}: ${issue.title}`,
                        `Requerimiento: ${issue.body || "(Sin descripción)"}`,
                        `Directorio de trabajo asignado: ${dispatched.worktreePath}`,
                        `Rama de trabajo: ${dispatched.branchName}`,
                        "",
                        "## Allowed edit surfaces",
                        "src/**",
                        "test/**",
                        "odd/**",
                        "package.json",
                        "tsconfig.json",
                      ].join("\n"),
                      role: "dc-super-agente",
                      archetype: "dc-odd-worker",
                      mode: "background",
                      sessionId: workerSessionId,
                    },
                    {
                      sessionId: workerSessionId,
                      pid: process.pid,
                    },
                  );

                  const taxiAc = ephemeralPlan.leasedAccount.toUpperCase();
                  const workerMsg = `🚕 Taxi [${taxiAc}] asignado a dc-super-agente y sus becarios para Issue #${issue.number}`;
                  dcNotifier.notifyHerdr(workerMsg);
                  if (ctx) {
                    dcNotifier.notify(ctx, "🚕 Flota de Taxis", workerMsg, "info");
                  }

                  updateWorktreeOddRoadmap(dispatched.worktreePath, dispatched.taskSlug, "T2", "done", `Analizado por dc-super-agente (${taxiAc})`);
                  updateWorktreeOddRoadmap(dispatched.worktreePath, dispatched.taskSlug, "T3", "in_progress", `dc-super-agente programando en worktree (${taxiAc})`);

                  // 2. Ejecución autónoma con LLM Real en worktree aislado
                  const llmResult = await dcWorkerRunner.executeAutonomousLlmSession({
                    worktreePath: dispatched.worktreePath,
                    taskSlug: dispatched.taskSlug,
                    issueNumber: dispatched.issueNumber,
                    issueTitle: dispatched.issueTitle,
                    issueBody: issue.body || "",
                    model: ephemeralPlan.fullModelRef,
                  });

                  if (!llmResult.ok) {
                    throw new Error(`El superagente no pudo completar la resolución (exit code ${llmResult.exitCode}): ${llmResult.stderr}`);
                  }

                  // 3. Detectar la rama base por defecto del repositorio raíz (ej: origin/HEAD -> master o main)
                  let baseBranch = "master";
                  try {
                    const { execFile } = await import("node:child_process");
                    const { promisify } = await import("node:util");
                    const execAsync = promisify(execFile);
                    // 1. Intentar resolver la rama por defecto desde origin/HEAD
                    const { stdout: symRef } = await execAsync("git", ["-C", repo.repoRoot, "symbolic-ref", "refs/remotes/origin/HEAD"]).catch(() => ({ stdout: "" }));
                    const cleanRef = symRef.trim().replace(/^refs\/remotes\/origin\//, "");
                    if (cleanRef) {
                      baseBranch = cleanRef;
                    } else {
                      // 2. Fallback a la rama activa en el repo raíz
                      const { stdout: rootBranch } = await execAsync("git", ["-C", repo.repoRoot, "branch", "--show-current"]).catch(() => ({ stdout: "" }));
                      if (rootBranch.trim()) baseBranch = rootBranch.trim();
                    }
                  } catch {
                    /* fallback defensivo a master */
                  }

                  // 4. Entrega final a GitHub (Commit, Push, PR y comentario vinculante)
                  const deliveryRes = await dcPrDelivery.deliverIssue({
                    worktreePath: dispatched.worktreePath,
                    taskSlug: dispatched.taskSlug,
                    issueNumber: dispatched.issueNumber,
                    issueTitle: dispatched.issueTitle,
                    branchName: dispatched.branchName,
                    baseBranch,
                  });

                  if (deliveryRes.ok && ctx) {
                    dcNotifier.notify(
                      ctx,
                      "DC Super-Agent",
                      `🎉 Pull Request lista para Issue #${issue.number}: ${deliveryRes.prUrl}`,
                      "info",
                    );
                  } else if (!deliveryRes.ok && ctx) {
                    dcNotifier.notify(
                      ctx,
                      "DC Super-Agent",
                      `⚠️ Fallo en entrega de PR para Issue #${issue.number}: ${deliveryRes.error}`,
                      "warning",
                    );
                  }
                } catch (workerErr: any) {
                  const errorMsg = workerErr?.message || "Error en entrega";
                  updateWorktreeOddRoadmap(dispatched.worktreePath, dispatched.taskSlug, "T5", "failed", errorMsg);
                  if (ctx) {
                    dcNotifier.notify(ctx, "DC Super-Agent", `Error en superagente Issue #${issue.number}: ${errorMsg}`, "error");
                    // Elevación interactiva mediante modal visual si hay UI activa
                    if (ctx.hasUI) {
                      void promptApprovalModal(ctx, {
                        id: `error-${issue.number}-${Date.now()}`,
                        toolName: "DC Super-Agent Runner",
                        action: `Atender bloqueo/fallo en Issue #${issue.number}`,
                        target: issue.title,
                        reason: `El subagente se detuvo: ${errorMsg}. ¿Reintentar o continuar manualmente?`,
                        timestamp: Date.now(),
                      }).catch(() => {});
                    }
                  }
                } finally {
                  // 5. Liberar Taxi y limpiar recursos efímeros del superagente
                  if (ephemeralPlan) {
                    cleanupEphemeralAgent(ephemeralPlan, {
                      sessionId: workerSessionId,
                      startedAt: Date.now() - 3000,
                      endedAt: Date.now(),
                      status: "completed",
                    });
                  }
                }
              })();
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
