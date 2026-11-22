import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DcSidebarCard } from "../../../ui/dc-sidebar-card.ts";
import { DcVStack } from "../../../ui/dc-vstack.ts";
import { DcJustifiedRow } from "../views/dc-sidebar-body.ts";
import { renderProgressBar } from "../../../ui/dc-progress-bar.ts";
import { dcControlDaemonManager } from "../../dc-agents/daemon/dc-control-daemon-manager.ts";
import { openControlCenterModal } from "../../dc-agents/views/dc-control-center-modal.ts";
import { openAgentChatMessengerModal } from "../../dc-agents/views/dc-chat-messenger-modal.ts";
import { checkPendingIssues } from "../../dc-agents/daemon/dc-pending-issues.ts";
import { getSidebarContext } from "../dc-sidebar.ts";
import { dcSupervisorBus } from "../../dc-control/core/dc-supervisor-bus.ts";
import { DcSupervisorLauncher } from "../../dc-control/core/dc-supervisor-launcher.ts";
import { getCanonicalDcSupervisorPaths } from "../../dc-control/core/dc-supervisor-paths.ts";
import { scanRunningPiProcesses } from "../../dc-control/core/dc-process-scanner.ts";

const execFileAsync = promisify(execFile);

interface BinaryCheckStatus {
  ghInstalled: boolean;
  ghVersion: string;
  checkedAt: number;
}

let cachedGhStatus: BinaryCheckStatus | null = null;

async function checkGhBinary(): Promise<BinaryCheckStatus> {
  const now = Date.now();
  if (cachedGhStatus && now - cachedGhStatus.checkedAt < 30_000) {
    return cachedGhStatus;
  }
  try {
    const { stdout } = await execFileAsync("gh", ["--version"]);
    const firstLine = stdout.split("\n")[0] || "gh instalado";
    cachedGhStatus = { ghInstalled: true, ghVersion: firstLine.trim(), checkedAt: now };
  } catch {
    cachedGhStatus = { ghInstalled: false, ghVersion: "No encontrado en PATH", checkedAt: now };
  }
  return cachedGhStatus;
}

function parseOddTasksFromWorktree(worktreePath: string, taskSlug?: string): Array<{ id: string; status: string; title: string }> {
  try {
    const tasksDir = path.join(worktreePath, "odd", "tasks");
    if (!fs.existsSync(tasksDir)) return [];
    const files = fs.readdirSync(tasksDir).filter(f => f.endsWith(".md"));
    const targetFile = taskSlug ? `${taskSlug}.md` : files[0];
    if (!targetFile) return [];
    const fullPath = path.join(tasksDir, targetFile);
    if (!fs.existsSync(fullPath)) return [];

    const content = fs.readFileSync(fullPath, "utf8");
    const tasks: Array<{ id: string; status: string; title: string }> = [];
    const lines = content.split("\n");
    for (const line of lines) {
      const match = line.match(/^-\s*\[([ xX~>!])\]\s*(T\d+):\s*(.+)$/);
      if (match) {
        const mark = match[1];
        let status = "pending";
        if (mark === "x" || mark === "X") status = "done";
        else if (mark === ">" || mark === "~") status = "in_progress";
        else if (mark === "!") status = "failed";
        tasks.push({ id: match[2], status, title: match[3] });
      }
    }
    return tasks;
  } catch {
    return [];
  }
}

/**
 * Tarjeta completa de la Torre de Control (dc-control):
 * Reúne la supervisión multisesión en vivo y la oficina completa de Super-Agentes
 * con máxima fidelidad técnica, sin amputar información.
 */
export class DcSuperAgentsSidebarCard implements Component {
  private requestRender?: () => void;
  private currentCard?: DcSidebarCard;
  private launcher = new DcSupervisorLauncher();

  constructor(requestRender?: () => void) {
    this.requestRender = requestRender;
    void checkGhBinary().then(() => this.requestRender?.());

    const onUpdate = () => {
      this.requestRender?.();
    };
    dcSupervisorBus.on("session:discovered", onUpdate);
    dcSupervisorBus.on("session:state_changed", onUpdate);
    dcSupervisorBus.on("session:hung", onUpdate);
    dcSupervisorBus.on("session:terminated", onUpdate);
  }

  invalidate(): void {
    this.currentCard?.invalidate?.();
  }

  render(width: number): string[] {
    const bloodBright = (s: string) => `\x1b[38;2;255;51;51m${s}\x1b[0m`;
    const bloodSoft = (s: string) => `\x1b[38;2;255;128;128m${s}\x1b[0m`;
    const bloodWhite = (s: string) => `\x1b[38;2;255;204;204m${s}\x1b[0m`;
    const greenBright = (s: string) => `\x1b[38;2;46;204;113m${s}\x1b[0m`;
    const yellowBright = (s: string) => `\x1b[38;2;250;204;21m${s}\x1b[0m`;
    const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
    const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

    const rows: Component[] = [];
    const sep = `  ${dim("─".repeat(Math.max(10, width - 8)))}`;

    // ── 1. ESTADO DEL DAEMON HUB MULTISESIÓN ──
    const { pidPath } = getCanonicalDcSupervisorPaths();
    let hubRunning = false;
    let hubPid: number | undefined;

    if (fs.existsSync(pidPath)) {
      try {
        const raw = fs.readFileSync(pidPath, "utf-8").trim();
        const p = parseInt(raw, 10);
        if (!isNaN(p)) {
          process.kill(p, 0);
          hubRunning = true;
          hubPid = p;
        }
      } catch {}
    }

    const hubStatusBadge = hubRunning
      ? greenBright(`● ONLINE (PID ${hubPid})`)
      : dim("○ INACTIVO");

    rows.push(
      new DcJustifiedRow(
        `  ${bloodSoft(bold("Daemon Hub:"))} ${hubStatusBadge}`,
        hubRunning ? `${greenBright("[Listo]")} ` : `${bloodBright("[Iniciar ▶]")} `,
        () => {
          void this.launcher.ensureDaemonRunning().then(() => this.requestRender?.());
        }
      )
    );

    // ── 2. SESIONES Y LABS ACTIVOS EN TIEMPO REAL ──
    const runningLabs = scanRunningPiProcesses();
    const activeLabsCount = runningLabs.length;

    rows.push(
      new DcJustifiedRow(
        `  ${dim("Labs supervisados:")}`,
        `${bloodBright(`${activeLabsCount} vivos`)}  ${bloodBright("[ ↻ ]")} `,
        () => {
          // Si el botón [ ↻ ] de Labs es presionado, regenerar cache de binarios y pedir re-render
          cachedGhStatus = null;
          void checkGhBinary().then(() => this.requestRender?.());
          this.requestRender?.();
        }
      )
    );

    if (runningLabs.length > 0) {
      for (const lab of runningLabs.slice(0, 5)) {
        const glyph = lab.role.startsWith("super_agent") || lab.role === "worker"
          ? yellowBright("🤖")
          : lab.osState === "stopped"
            ? dim("⏸")
            : greenBright("●");

        const statusTag = lab.osState === "stopped"
          ? dim("[suspendido]")
          : lab.role.startsWith("super_agent")
            ? yellowBright(`[${lab.role.replace("super_agent_", "#")}]`)
            : dim(`PID ${lab.pid}`);

        const nameDisplay = lab.displayLabel.length > 18
          ? lab.displayLabel.slice(0, 17) + "…"
          : lab.displayLabel;

        rows.push(
          new DcJustifiedRow(
            `    ${glyph} ${bloodWhite(nameDisplay)}`,
            `${statusTag} `
          )
        );
      }
    } else {
      rows.push(
        new DcJustifiedRow(
          `    ${dim("Sin otras sesiones detectadas")}`,
          `${dim("[idle]")} `
        )
      );
    }

    rows.push(new DcJustifiedRow(sep, ""));

    // ── 3. SUPER-AGENTE #86 (MISIÓN & ODD ROADMAP) ──
    const status = dcControlDaemonManager.getStatus();
    const dispatches = status.activeDispatches;
    const isDaemonRunning = status.running;
    const isTunnelRunning = status.tunnelActive;

    const daemonStatusStr = isDaemonRunning ? greenBright("● ACTIVO") : dim("○ DETENIDO");
    const tunnelStatusStr = isTunnelRunning ? greenBright("✓ GH TÚNEL") : dim("○ SIN TÚNEL");

    rows.push(
      new DcJustifiedRow(
        `  ${bloodSoft(bold("Daemon #86:"))} ${daemonStatusStr}`,
        `${tunnelStatusStr} `
      )
    );

    if (dispatches.length === 0) {
      rows.push(
        new DcJustifiedRow(
          `  ${dim("Misión actual:")}`,
          `${dim("en espera")} `
        )
      );
      rows.push(
        new DcJustifiedRow(
          `  ${dim("↳ Escuchando issues en GitHub...")}`,
          ""
        )
      );
    } else {
      const active = dispatches[0]!;
      const branchShort = active.branchName.length > 18 ? active.branchName.slice(0, 17) + "…" : active.branchName;
      rows.push(
        new DcJustifiedRow(
          `  ${yellowBright("▶")} ${bloodWhite(bold(`Issue #${active.issueNumber}`))}`,
          `${bloodSoft(branchShort)} `
        )
      );

      const worktreeName = path.basename(active.worktreePath);
      rows.push(
        new DcJustifiedRow(
          `    ${dim("Worktree:")} ${dim(worktreeName)}`,
          `${yellowBright("[en curso]")} `
        )
      );

      const oddTasks = parseOddTasksFromWorktree(active.worktreePath, active.taskSlug);
      if (oddTasks.length > 0) {
        const doneSteps = oddTasks.filter((t) => t.status === "done").length;
        const totalSteps = oddTasks.length;
        const pct = Math.round((doneSteps / totalSteps) * 100);
        const bar = renderProgressBar(pct, 8, "▰", "▱", "\x1b[38;2;255;77;77m");

        rows.push(
          new DcJustifiedRow(
            `    ${bloodSoft("Pipeline ODD:")} ${bar}`,
            `${bloodBright(`${doneSteps}/${totalSteps}`)} `
          )
        );

        for (const t of oddTasks.slice(0, 4)) {
          let glyph = dim("○");
          let badge = dim("[pend]");
          if (t.status === "done") {
            glyph = greenBright("✓");
            badge = greenBright("[done]");
          } else if (t.status === "in_progress") {
            glyph = yellowBright("▶");
            badge = yellowBright(bold("[work]"));
          } else if (t.status === "failed") {
            glyph = bloodBright("✗");
            badge = bloodBright("[fail]");
          }
          const taskLabel = t.title.length > 20 ? t.title.slice(0, 19) + "…" : t.title;
          rows.push(
            new DcJustifiedRow(
              `      ${glyph} ${dim(t.id + ":")} ${bloodWhite(taskLabel)}`,
              `${badge} `
            )
          );
        }
      }
    }

    rows.push(new DcJustifiedRow(sep, ""));

    // ── 4. DETALLES DE CONFIGURACIÓN & BINARIOS ──
    const gh = cachedGhStatus;
    const ghStr = gh?.ghInstalled ? greenBright("✓ INSTALADO") : bloodBright("✗ FALTANTE");
    rows.push(
      new DcJustifiedRow(
        `  ${dim("GitHub CLI:")}`,
        `${ghStr} `
      )
    );

    const portStr = status.port ? `${status.port}` : "4545";
    const receiverStr = status.running ? greenBright(`✓ 127.0.0.1:${portStr}`) : dim("○ Inactivo");
    rows.push(
      new DcJustifiedRow(
        `  ${dim("Receptor Local:")}`,
        `${receiverStr} `
      )
    );

    rows.push(
      new DcJustifiedRow(
        `  ${dim("Arquetipo:")} ${bloodWhite("dc-odd-worker")}`,
        `${dim("Thinking:")} ${yellowBright("High")} `
      )
    );
    rows.push(
      new DcJustifiedRow(
        `  ${dim("Herramientas:")} ${bloodWhite("fs, terminal, tdd")}`,
        `${dim("Flota:")} ${bloodBright("Taxis")} `
      )
    );

    rows.push(new DcJustifiedRow(sep, ""));

    // ── 5. BOTONES DE ACCIÓN DIRECTA ──
    rows.push(
      new DcJustifiedRow(
        `  ${bloodWhite(bold("🏢 OFICINA DC-CONTROL"))}`,
        `${bloodBright("[Abrir Oficina ↗]")} `,
        () => {
          const ctx = getSidebarContext();
          if (ctx) void openControlCenterModal(ctx);
        }
      )
    );

    rows.push(
      new DcJustifiedRow(
        `  ${bloodWhite("💬 Mensajes & Chats")}`,
        `${bloodBright("[Ver Chats ↗]")} `,
        () => {
          const ctx = getSidebarContext();
          if (ctx) void openAgentChatMessengerModal(ctx);
        }
      )
    );

    if (isTunnelRunning) {
      rows.push(
        new DcJustifiedRow(
          `  ${bloodWhite("⚡ Revisar Issues GitHub")}`,
          `${bloodBright("[Check Issues]")} `,
          () => {
            const ctx = getSidebarContext();
            if (ctx) {
              setTimeout(async () => {
                try {
                  const currentCtx = getSidebarContext() || ctx;
                  const pi = (globalThis as any)[Symbol.for("dc.sidebar.pi")] || (currentCtx as any).pi || currentCtx;
                  await checkPendingIssues(pi, currentCtx);
                } catch {}
              }, 50);
            }
          }
        )
      );
    }

    if (isDaemonRunning) {
      rows.push(
        new DcJustifiedRow(
          `  ${dim("↻ Reiniciar Daemon #86")}`,
          `${bloodBright("[Reiniciar]")}  `,
          () => {
            const ctx = getSidebarContext();
            void dcControlDaemonManager.stop().then(async () => {
              await dcControlDaemonManager.start(ctx);
              this.requestRender?.();
              dcSupervisorBus.emit("session:state_changed", null as any, null as any);
              setTimeout(() => this.requestRender?.(), 1000);
            });
          }
        )
      );
    } else {
      rows.push(
        new DcJustifiedRow(
          `  ${greenBright("▶ Iniciar Daemon #86 & Túnel")}`,
          `${greenBright("[Iniciar]")}  `,
          () => {
            const ctx = getSidebarContext();
            void dcControlDaemonManager.start(ctx).then(() => {
              this.requestRender?.();
              // Notificar en el bus para actualizar cualquier vista de supervisión
              dcSupervisorBus.emit("session:state_changed", null as any, null as any);
              // Si pasados unos instantes el worker ya inició proceso, refrescar de nuevo
              setTimeout(() => this.requestRender?.(), 1000);
            });
          }
        )
      );
    }

    this.currentCard = new DcSidebarCard({
      glyph: "🏢",
      title: "DC-Control",
      titleRight: "oficina [↗]",
      content: new DcVStack(rows),
      paddingX: 1,
      onTitleClick: () => {
        const ctx = getSidebarContext();
        if (ctx) void openControlCenterModal(ctx);
      },
      onRightClick: () => {
        const ctx = getSidebarContext();
        if (ctx) void openControlCenterModal(ctx);
      },
    });

    return this.currentCard.render(width);
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return (this.currentCard as any)?.handleMouse?.(event);
  }
}

export function createSuperAgentsSidebarCard(requestRender?: () => void): Component {
  return new DcSuperAgentsSidebarCard(requestRender);
}
