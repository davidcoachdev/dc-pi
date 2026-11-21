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
import { checkPendingIssues } from "../../dc-agents/daemon/dc-pending-issues.ts";
import { getSidebarContext } from "../dc-sidebar.ts";
import { dcSupervisorBus } from "../../dc-control/core/dc-supervisor-bus.ts";
import { DcSupervisorLauncher } from "../../dc-control/core/dc-supervisor-launcher.ts";
import { getCanonicalDcSupervisorPaths } from "../../dc-control/core/dc-supervisor-paths.ts";

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
 * Tarjeta de la Torre de Control (dc-control):
 * Jerarquía limpia y unificada de un vistazo:
 * 1. Daemon Hub multisesión (Online/Offline, PID real, botón de aseguramiento).
 * 2. Labs y Orquestadores activos en tiempo real.
 * 3. Misión y pipeline ODD del Super-Agente #86.
 * 4. Botones de acción directa (Revisar issues, abrir oficina modal).
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
      : dim("○ APAGADO");

    rows.push(
      new DcJustifiedRow(
        `  ${bloodSoft(bold("Daemon Hub:"))}`,
        `${hubStatusBadge} `,
        () => {
          void this.launcher.ensureDaemonRunning().then(() => this.requestRender?.());
        }
      )
    );

    // ── 2. SESIONES Y LABS ACTIVOS EN TIEMPO REAL ──
    const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");
    let activeLabsCount = 0;
    const recentLabs: Array<{ name: string; ageStr: string }> = [];

    if (fs.existsSync(sessionsDir)) {
      try {
        const entries = fs.readdirSync(sessionsDir);
        const now = Date.now();
        for (const ent of entries) {
          if (ent.startsWith("--") && ent.endsWith("--")) {
            const fullDir = path.join(sessionsDir, ent);
            try {
              const stat = fs.statSync(fullDir);
              if (now - stat.mtimeMs < 10 * 60 * 1000) {
                activeLabsCount++;
                const cleanName = ent.replace(/^--home-[^-]+-/, "").replace(/--$/, "").replace(/-/g, "/");
                const minsAgo = Math.round((now - stat.mtimeMs) / 60000);
                recentLabs.push({ name: cleanName || ent, ageStr: minsAgo === 0 ? "activo" : `${minsAgo}m` });
              }
            } catch {}
          }
        }
      } catch {}
    }

    rows.push(
      new DcJustifiedRow(
        `  ${dim("Labs supervisados:")}`,
        `${bloodBright(`${activeLabsCount} vivos`)} `
      )
    );

    if (recentLabs.length > 0) {
      for (const lab of recentLabs.slice(0, 3)) {
        const shortName = lab.name.length > 20 ? lab.name.slice(0, 19) + "…" : lab.name;
        rows.push(
          new DcJustifiedRow(
            `    ${greenBright("●")} ${bloodWhite(shortName)}`,
            `${dim(lab.ageStr)} `
          )
        );
      }
    }

    rows.push(new DcJustifiedRow(sep, ""));

    // ── 3. SUPER-AGENTE #86 (MISIÓN & ODD) ──
    const status = dcControlDaemonManager.getStatus();
    const dispatches = status.activeDispatches;
    const isTunnelRunning = status.tunnelActive;

    const tunnelStr = isTunnelRunning ? greenBright("✓ GH TÚNEL") : dim("○ SIN TÚNEL");
    rows.push(
      new DcJustifiedRow(
        `  ${bloodSoft(bold("Super-Agente #86:"))}`,
        `${tunnelStr} `
      )
    );

    if (dispatches.length === 0) {
      rows.push(
        new DcJustifiedRow(
          `  ${dim("Misión actual:")}`,
          `${dim("en espera")} `
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

      const oddTasks = parseOddTasksFromWorktree(active.worktreePath, active.taskSlug);
      if (oddTasks.length > 0) {
        const doneSteps = oddTasks.filter((t) => t.status === "done").length;
        const totalSteps = oddTasks.length;
        const pct = Math.round((doneSteps / totalSteps) * 100);
        const bar = renderProgressBar(pct, 8, "▰", "▱", "\x1b[38;2;255;77;77m");

        rows.push(
          new DcJustifiedRow(
            `    ${bloodSoft("Pipeline:")} ${bar}`,
            `${bloodBright(`${doneSteps}/${totalSteps}`)} `
          )
        );
      }
    }

    rows.push(new DcJustifiedRow(sep, ""));

    // ── 4. ACCIONES Y BOTONES DE CONTROL ──
    rows.push(
      new DcJustifiedRow(
        `  ${bloodWhite(bold("🏢 ABRIR OFICINA MODAL"))}`,
        `${bloodBright("[Abrir ↗]")} `,
        () => {
          const ctx = getSidebarContext();
          if (ctx) void openControlCenterModal(ctx);
        }
      )
    );

    if (!hubRunning) {
      rows.push(
        new DcJustifiedRow(
          `  ${greenBright("▶ Iniciar Daemon Hub")}`,
          `${greenBright("[Iniciar]")} `,
          () => {
            void this.launcher.ensureDaemonRunning().then(() => this.requestRender?.());
          }
        )
      );
    } else {
      rows.push(
        new DcJustifiedRow(
          `  ${dim("⚡ Revisar Issues")}`,
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
