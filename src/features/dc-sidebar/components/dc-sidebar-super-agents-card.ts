import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import { DcSidebarCard } from "../../../ui/dc-sidebar-card.ts";
import { DcVStack } from "../../../ui/dc-vstack.ts";
import { DcJustifiedRow } from "../views/dc-sidebar-body.ts";
import { renderProgressBar } from "../../../ui/dc-progress-bar.ts";
import { dcControlDaemonManager } from "../../dc-agents/daemon/dc-control-daemon-manager.ts";
import { openControlCenterModal } from "../../dc-agents/views/dc-control-center-modal.ts";
import { getSidebarContext } from "../dc-sidebar.ts";

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

export class DcSuperAgentsSidebarCard implements Component {
  private activeSubtab: "86" | "config" = "86";
  private requestRender?: () => void;
  private currentCard?: DcSidebarCard;

  constructor(requestRender?: () => void) {
    this.requestRender = requestRender;
    void checkGhBinary().then(() => this.requestRender?.());
  }

  invalidate(): void {
    this.currentCard?.invalidate?.();
  }

  private toggleSubtab(): void {
    this.activeSubtab = this.activeSubtab === "86" ? "config" : "86";
    this.requestRender?.();
  }

  render(width: number): string[] {
    const bloodBright = (s: string) => `\x1b[38;2;255;51;51m${s}\x1b[0m`;
    const bloodSoft = (s: string) => `\x1b[38;2;255;128;128m${s}\x1b[0m`;
    const bloodWhite = (s: string) => `\x1b[38;2;255;204;204m${s}\x1b[0m`;
    const greenBright = (s: string) => `\x1b[38;2;46;204;113m${s}\x1b[0m`;
    const yellowBright = (s: string) => `\x1b[38;2;250;204;21m${s}\x1b[0m`;
    const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
    const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

    const status = dcControlDaemonManager.getStatus();
    const dispatches = status.activeDispatches;
    const isDaemonRunning = status.running;
    const isTunnelRunning = status.tunnelActive;

    const rows: Component[] = [];

    // ── 1. Barra de Sub-Tabs Interactiva ──
    const tab86Style = this.activeSubtab === "86"
      ? `\x1b[48;2;60;15;20m\x1b[1;38;2;255;77;77m [1: AGENT #86] \x1b[0m`
      : ` ${dim("[1: #86]")} `;
    const tabCfgStyle = this.activeSubtab === "config"
      ? `\x1b[48;2;60;15;20m\x1b[1;38;2;255;77;77m [2: CONFIG & BIN] \x1b[0m`
      : ` ${dim("[2: CONFIG]")} `;

    rows.push(
      new DcJustifiedRow(
        ` ${tab86Style} ${tabCfgStyle}`,
        `${bloodBright("[cambiar ⇄]")} `,
        () => this.toggleSubtab()
      )
    );
    rows.push(new DcJustifiedRow(`  ${dim("─".repeat(Math.max(10, width - 8)))}`, ""));

    // ── 2. Contenido según la Sub-Tab activa ──
    if (this.activeSubtab === "86") {
      // Estado del Daemon y Túnel
      const daemonStatusStr = isDaemonRunning ? greenBright("● ACTIVO") : dim("○ DETENIDO");
      const tunnelStatusStr = isTunnelRunning ? greenBright("✓ GH TÚNEL") : dim("○ SIN TÚNEL");

      rows.push(
        new DcJustifiedRow(
          `  ${bloodSoft("Daemon:")} ${daemonStatusStr}`,
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

        // ODD Steps
        const oddTasks = parseOddTasksFromWorktree(active.worktreePath, active.taskSlug);
        if (oddTasks.length > 0) {
          const doneSteps = oddTasks.filter((t) => t.status === "done").length;
          const totalSteps = oddTasks.length;
          const pct = Math.round((doneSteps / totalSteps) * 100);
          const bar = renderProgressBar(pct, 10, "▰", "▱", "\x1b[38;2;255;77;77m");

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

      // Separador y Acciones
      rows.push(new DcJustifiedRow(`  ${dim("─".repeat(Math.max(10, width - 8)))}`, ""));
      rows.push(
        new DcJustifiedRow(
          `  ${bloodWhite(bold("🏢 OFICINA DC-CONTROL"))}`,
          `${bloodBright("[Abrir ↗]")} `,
          () => {
            const ctx = getSidebarContext();
            if (ctx) void openControlCenterModal(ctx);
          }
        )
      );
      rows.push(
        new DcJustifiedRow(
          `  ${dim("↻ Reiniciar Servicio")}`,
          `${bloodBright("[Reiniciar]")} `,
          () => {
            const ctx = getSidebarContext();
            if (ctx) {
              void dcControlDaemonManager.stop().then(async () => {
                await dcControlDaemonManager.start(ctx);
                this.requestRender?.();
              });
            }
          }
        )
      );
    } else {
      // ── Sub-Tab CONFIG & BINARIOS ──
      const gh = cachedGhStatus;
      const ghStr = gh?.ghInstalled ? greenBright("✓ INSTALADO") : bloodBright("✗ FALTANTE");
      rows.push(
        new DcJustifiedRow(
          `  ${bloodSoft("GitHub CLI (gh):")}`,
          `${ghStr} `
        )
      );

      const portStr = status.port ? `${status.port}` : "4545";
      const receiverStr = status.running ? greenBright(`✓ 127.0.0.1:${portStr}`) : dim("○ Inactivo");
      rows.push(
        new DcJustifiedRow(
          `  ${bloodSoft("Receptor Local:")}`,
          `${receiverStr} `
        )
      );

      const tunnelStr = status.tunnelActive ? greenBright("✓ CONECTADO") : dim("○ DESCONECTADO");
      rows.push(
        new DcJustifiedRow(
          `  ${bloodSoft("Túnel Webhook:")}`,
          `${tunnelStr} `
        )
      );

      rows.push(new DcJustifiedRow(`  ${dim("─".repeat(Math.max(10, width - 8)))}`, ""));
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

      rows.push(new DcJustifiedRow(`  ${dim("─".repeat(Math.max(10, width - 8)))}`, ""));
      if (isDaemonRunning) {
        rows.push(
          new DcJustifiedRow(
            `  ${bloodBright("■ Detener Daemon & Túnel")}`,
            `${bloodBright("[Detener]")} `,
            () => {
              void dcControlDaemonManager.stop().then(() => this.requestRender?.());
            }
          )
        );
      } else {
        rows.push(
          new DcJustifiedRow(
            `  ${greenBright("▶ Iniciar Daemon & Túnel")}`,
            `${greenBright("[Iniciar]")} `,
            () => {
              const ctx = getSidebarContext();
              if (ctx) void dcControlDaemonManager.start(ctx).then(() => this.requestRender?.());
            }
          )
        );
      }
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
    return this.currentCard?.handleMouse?.(event);
  }
}

export function createSuperAgentsSidebarCard(requestRender?: () => void): Component {
  return new DcSuperAgentsSidebarCard(requestRender);
}
