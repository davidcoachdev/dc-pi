import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";
import { resolveCurrentRepoIdentity, type RepoIdentity } from "./dc-repo-resolver.ts";
import { DcControlReceiver } from "./dc-control-receiver.ts";
import { dcIssueDispatcher, type GitHubIssuePayload, type DispatchedIssueTask } from "./dc-issue-dispatcher.ts";
import { promptApprovalModal } from "../../dc-approval/views/dc-approval-modal.ts";
import { dcPrDelivery } from "./dc-pr-delivery.ts";
import { dcWorkerRunner, updateWorktreeOddRoadmap } from "./dc-worker-runner.ts";
import { dcIssueNotifier } from "./dc-issue-notifier.ts";
import { dcIssueCommentRouter } from "./dc-issue-comment-router.ts";
import { prepareEphemeralAgent, cleanupEphemeralAgent } from "../core/dc-ephemeral-manager.ts";

export interface DaemonStatus {
  running: boolean;
  port?: number;
  repo?: RepoIdentity;
  tunnelActive: boolean;
  activeDispatches: DispatchedIssueTask[];
}

/**
 * Supervisor del Daemon Autónomo de GitHub y Centro de Control para DC Studio.
 * - Detecta el repositorio activo dinámicamente (`owner/repo`).
 * - Levanta el receptor HTTP local en loopback (127.0.0.1:4545+).
 * - Spawnea el túnel oficial `gh webhook forward` en background sin bloquear la sesión.
 * - Al recibir un issue, dispara la notificación visual y el aislamiento en worktree.
 */
export class DcControlDaemonManager {
  private static instance?: DcControlDaemonManager;
  private receiver?: DcControlReceiver;
  private tunnelProcess?: ChildProcess;
  private currentRepo?: RepoIdentity;
  private isTunnelRunning = false;
  private inFlightWorkers = new Set<string>();
  private pendingReruns = new Map<string, { dispatched: DispatchedIssueTask; repo: RepoIdentity; instruction?: string; ctx?: ExtensionContext }>();

  public static getInstance(): DcControlDaemonManager {
    if (!DcControlDaemonManager.instance) {
      DcControlDaemonManager.instance = new DcControlDaemonManager();
    }
    return DcControlDaemonManager.instance;
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

    const capability = randomBytes(32).toString("hex");
    // 2. Iniciar el receptor HTTP local
      this.receiver = new DcControlReceiver({
        port: 4545,
        capability,
        expectedRepoNwo: repo.fullNwo,
        onIssueOpened: (payload) => this.executeIssue(payload, repo, ctx),
        onIssueCommentCreated: async (payload) => {
          await dcIssueCommentRouter.handleComment(payload);
        },
        onError: (err) => {
          if (ctx) {
            dcNotifier.notify(ctx, "DC Control Daemon", `Error receptor: ${err.message}`, "error");
          }
        },
      });

    const activePort = await this.receiver.start();
    this.startTunnel(repo.fullNwo, activePort, capability, ctx);
    return this.getStatus();
  }

  /** Shared dispatch/Taxi/worker/delivery lifecycle; independent of listener state. */
  public async executeIssue(payload: GitHubIssuePayload, repo: RepoIdentity, ctx?: ExtensionContext): Promise<void> {
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
              void this.runAutonomousWorker(
                dispatched,
                repo,
                { number: issue.number, title: issue.title, body: issue.body || "" },
                ctx,
              );
            }
          } catch (err: any) {
            if (ctx) {
              dcNotifier.notify(ctx, "DC GitHub Sentinel", `Error aislando Issue #${issue.number}: ${err.message}`, "error");
            }
          }
  }

  /**
   * Ejecuta la sesión autónoma del LLM con cuenta arrendada de la Flota de Taxis,
   * verificación determinista estricta en worktree y entrega continua de PR.
   */
  public async runAutonomousWorker(
    dispatched: DispatchedIssueTask,
    repo: RepoIdentity,
    issueDetails: { number: number; title: string; body?: string },
    ctx?: ExtensionContext,
  ): Promise<void> {
    const lockKey = `${repo.fullNwo.toLowerCase()}:${issueDetails.number}`;
    if (this.inFlightWorkers.has(lockKey)) {
      const busyMsg = `🤖 **DC Super-Agent 86**: ⏳ Ya hay una sesión de trabajo activa en progreso para el Issue #${issueDetails.number}. Las nuevas directivas se incorporarán al ciclo actual.`;
      await dcIssueNotifier.notifyIssue(
        { repoRoot: dispatched.worktreePath, repoNwo: repo.fullNwo, issueNumber: issueDetails.number },
        busyMsg,
      );
      return;
    }
    this.inFlightWorkers.add(lockKey);

    let ephemeralPlan: ReturnType<typeof prepareEphemeralAgent> | undefined;
    const startedAt = Date.now();
    const workerSessionId = `dc-super-agent-issue-${issueDetails.number}-${startedAt}`;
    let status: "completed" | "failed" = "failed";
    let error: string | undefined;

    try {
      // 1. Arrendar Taxi en la Flota y preparar definición de DC Super-Agent con contrato estricto de Allowed edit surfaces
      ephemeralPlan = prepareEphemeralAgent(
        {
          task: [
            `Misión autónoma de DC Super-Agent 86: Resolver Issue #${issueDetails.number}: ${issueDetails.title}`,
            `Requerimiento: ${issueDetails.body || "(Sin descripción)"}`,
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
          role: "dc-super-agente-86",
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
      const workerMsg = `🚕 Taxi [${taxiAc}] asignado a dc-super-agente-86 para Issue #${issueDetails.number}`;
      dcNotifier.notifyHerdr(workerMsg);
      if (ctx) {
        dcNotifier.notify(ctx, "🚕 Flota de Taxis", workerMsg, "info");
      }

      // Notificar inmediatamente al Issue en GitHub la asignación del Taxi y el inicio de análisis
      await dcIssueNotifier.notifyIssue(
        { repoRoot: dispatched.worktreePath, repoNwo: repo.fullNwo, issueNumber: dispatched.issueNumber },
        `🤖 **DC Super-Agent 86**: Taxi [${taxiAc}] asignado. Iniciando análisis de especificación ODD y pruebas RED...`,
      );

      updateWorktreeOddRoadmap(dispatched.worktreePath, dispatched.taskSlug, "T2", "done", `Analizado por dc-super-agente-86 (${taxiAc})`);
      updateWorktreeOddRoadmap(dispatched.worktreePath, dispatched.taskSlug, "T3", "in_progress", `dc-super-agente-86 programando en worktree (${taxiAc})`);

      // Notificar inicio de implementación de código
      await dcIssueNotifier.notifyIssue(
        { repoRoot: dispatched.worktreePath, repoNwo: repo.fullNwo, issueNumber: dispatched.issueNumber },
        `🤖 **DC Super-Agent 86**: 🔨 Iniciando implementación de código de la solución en worktree...`,
      );

      // 2. Ejecución autónoma con LLM Real en worktree aislado
      const llmResult = await dcWorkerRunner.executeAutonomousLlmSession({
        worktreePath: dispatched.worktreePath,
        taskSlug: dispatched.taskSlug,
        issueNumber: dispatched.issueNumber,
        issueTitle: dispatched.issueTitle,
        issueBody: issueDetails.body || "",
        preparedAgent: ephemeralPlan,
      });

      if (!llmResult.ok) {
        if (!llmResult.verification.ok) {
          const failedCommand = llmResult.verification.commands.find(result => result.exitCode !== 0);
          const reason = failedCommand
            ? `${failedCommand.command} ${failedCommand.args.join(" ")}: exit ${failedCommand.exitCode}; ${failedCommand.stderr || failedCommand.stdout}`
            : llmResult.verification.error || "Sin verificación determinista aprobada";
          throw new Error(`Verificación fallida: ${reason}`);
        }
        throw new Error(`Pi exit ${llmResult.exitCode}: ${llmResult.stderr}`);
      }

      // Notificar que la verificación determinista fue superada
      await dcIssueNotifier.notifyIssue(
        { repoRoot: dispatched.worktreePath, repoNwo: repo.fullNwo, issueNumber: dispatched.issueNumber },
        `🤖 **DC Super-Agent 86**: ✅ Verificación determinista superada con éxito (exit code 0). Preparando entrega de Pull Request...`,
      );

      // 4. Entrega final a GitHub (Commit, Push, PR y comentario vinculante)
      const verificationEvidence = llmResult.verification?.commands.length
        ? llmResult.verification.commands.map(c => `- \`${c.command} ${c.args.join(" ")}\`: exit ${c.exitCode}`).join("\n")
        : undefined;

      const deliveryRes = await dcPrDelivery.deliverIssue({
        worktreePath: dispatched.worktreePath,
        taskSlug: dispatched.taskSlug,
        issueNumber: dispatched.issueNumber,
        issueTitle: dispatched.issueTitle,
        branchName: dispatched.branchName,
        baseBranch: dispatched.baseBranch,
        issueBody: issueDetails.body || "",
        verificationEvidence,
      });

      if (!deliveryRes.ok) throw new Error(deliveryRes.error || "Entrega de PR fallida");
      status = "completed";
      if (ctx) {
        dcNotifier.notify(
          ctx,
          "DC Super-Agent 86",
          `🎉 Pull Request lista para Issue #${issueDetails.number}: ${deliveryRes.prUrl}`,
          "info",
        );
      }
    } catch (workerErr: any) {
      const errorMsg = workerErr?.message || String(workerErr);
      status = "failed";
      error = errorMsg;
      updateWorktreeOddRoadmap(dispatched.worktreePath, dispatched.taskSlug, "T5", "failed", errorMsg);
      // Notificar el fallo en el Issue de GitHub
      await dcIssueNotifier.notifyIssue(
        { repoRoot: dispatched.worktreePath, repoNwo: repo.fullNwo, issueNumber: dispatched.issueNumber },
        `🤖 **DC Super-Agent 86**: ❌ Se detuvo la ejecución autónoma: ${errorMsg}. Se requiere intervención en el Centro de Control.`,
        "DISPATCH",
      );
      if (ctx) {
        dcNotifier.notify(ctx, "DC Super-Agent 86", `Error en superagente Issue #${issueDetails.number}: ${errorMsg}`, "error");
        // Elevación interactiva mediante modal visual si hay UI activa
        if (ctx.hasUI) {
          void promptApprovalModal(ctx, {
            id: `error-${issueDetails.number}-${Date.now()}`,
            toolName: "DC Super-Agent Runner",
            action: `Atender bloqueo/fallo en Issue #${issueDetails.number}`,
            target: issueDetails.title,
            reason: `El subagente se detuvo: ${errorMsg}. Continúa manualmente; este aviso no reintenta la ejecución.`,
            timestamp: Date.now(),
          }).catch(() => {});
        }
      }
    } finally {
      this.inFlightWorkers.delete(lockKey);
      // 5. Liberar Taxi y limpiar recursos efímeros del superagente
      if (ephemeralPlan) {
        cleanupEphemeralAgent(ephemeralPlan, {
          sessionId: workerSessionId,
          startedAt,
          endedAt: Date.now(),
          status,
          error,
        });
      }

      // Si llegaron directivas adicionales mientras el worker estaba en vuelo o entregando,
      // disparar automáticamente una segunda pasada para no dejarlas sin implementar.
      const nextRerun = this.pendingReruns.get(lockKey);
      if (nextRerun) {
        this.pendingReruns.delete(lockKey);
        void this.resumeIssue(nextRerun.dispatched, nextRerun.repo, nextRerun.instruction, nextRerun.ctx);
      }
    }
  }

  /** Reanuda la resolución autónoma de un issue existente con nuevas directivas. */
  public async resumeIssue(
    dispatched: DispatchedIssueTask,
    repo: RepoIdentity,
    newInstruction?: string,
    ctx?: ExtensionContext,
  ): Promise<void> {
    const lockKey = `${repo.fullNwo.toLowerCase()}:${dispatched.issueNumber}`;
    const specFile = path.join(dispatched.worktreePath, "odd", "tasks", `${dispatched.taskSlug}.md`);

    if (newInstruction && fs.existsSync(specFile)) {
      const specContent = fs.readFileSync(specFile, "utf8");
      // Evitar doble escritura si la directiva ya fue asentada
      if (!specContent.includes(`"${newInstruction}"`)) {
        fs.appendFileSync(specFile, `\n- Directiva adicional del OWNER: "${newInstruction}"\n`, "utf8");
      }
    }

    if (this.inFlightWorkers.has(lockKey)) {
      // Registrar re-ejecución pendiente para que al terminar el ciclo actual se procese la nueva directiva
      this.pendingReruns.set(lockKey, { dispatched, repo, instruction: newInstruction, ctx });
      return;
    }

    updateWorktreeOddRoadmap(dispatched.worktreePath, dispatched.taskSlug, "T3", "in_progress", "dc-super-agente-86 reanudando implementación con nuevas directivas");
    return this.runAutonomousWorker(
      dispatched,
      repo,
      {
        number: dispatched.issueNumber,
        title: dispatched.issueTitle,
        body: newInstruction ? `Nuevas directivas: ${newInstruction}` : dispatched.issueTitle,
      },
      ctx,
    );
  }

  private startTunnel(repoNwo: string, port: number, capability: string, ctx?: ExtensionContext): void {
    const url = `http://127.0.0.1:${port}/github-webhook?capability=${capability}`;
    const args = ["webhook", "forward", `--repo=${repoNwo}`, "--events=issues,issue_comment", `--url=${url}`];

    try {
      const child = spawn("gh", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.tunnelProcess = child;
      this.isTunnelRunning = true;

      child.stderr?.on("data", (data: Buffer) => {
        const errText = data.toString("utf8");
        // Log para depuración sin spam
        if (errText.includes("Error") || errText.includes("422")) {
          console.error(`[dc-control-tunnel] ${errText.trim()}`);
        }
      });

      child.on("error", (err) => {
        if (this.tunnelProcess === child) {
          this.isTunnelRunning = false;
        }
        if (ctx) {
          dcNotifier.notify(ctx, "DC Control Tunnel", "Fallo túnel gh", "error");
        }
      });

      child.on("exit", (code) => {
        if (this.tunnelProcess === child) {
          this.isTunnelRunning = false;
        }
        if (code !== 0 && code !== null && ctx) {
          dcNotifier.notify(ctx, "DC Control Tunnel", `Túnel gh finalizado (código ${code})`, "warning");
        }
      });

      child.unref?.();
    } catch (err: any) {
      this.isTunnelRunning = false;
      if (ctx) {
        dcNotifier.notify(ctx, "DC Control Tunnel", "No se pudo iniciar gh webhook", "error");
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

export const dcControlDaemonManager = DcControlDaemonManager.getInstance();
export const dcWebhookDaemonManager = dcControlDaemonManager;
export const DcWebhookDaemonManager = DcControlDaemonManager;
