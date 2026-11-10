import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import { DcSidebarCard } from "../../../ui/dc-sidebar-card.ts";
import { DcTabs, type DcTabItem } from "../../../ui/dc-tabs.ts";
import { dcControlDaemonManager } from "../../dc-agents/daemon/dc-control-daemon-manager.ts";
import { dcConflictGuard } from "../../dc-agents/daemon/dc-conflict-guard.ts";
import { dcIssueDispatcher, type DispatchedIssueTask } from "../../dc-agents/daemon/dc-issue-dispatcher.ts";
import { openControlCenterModal } from "../../dc-agents/views/dc-control-center-modal.ts";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";

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
  private activeSubtab = "86"; // "86" o "config"
  private requestRender?: () => void;
  private tabsComponent: DcTabs;
  private actionButtonRegions: Array<{ id: string; y: number; height: number; action: () => void }> = [];

  constructor(requestRender?: () => void) {
    this.requestRender = requestRender;

    const subtabs: DcTabItem[] = [
      { id: "86", key: "1", label: "AGENT #86" },
      { id: "config", key: "2", label: "CONFIG & BIN" },
    ];

    this.tabsComponent = new DcTabs({
      tabs: subtabs,
      activeId: this.activeSubtab,
      variant: "standard",
      fullWidthBorder: false,
      paddingX: 1,
      onSelect: (id) => {
        this.activeSubtab = id;
        this.requestRender?.();
      },
    });

    // Check binario en background
    void checkGhBinary().then(() => this.requestRender?.());
  }

  render(width: number): string[] {
    const lines: string[] = [];
    this.actionButtonRegions = [];

    // Header del Card
    lines.push(`\x1b[1;31m╔══ \x1b[1;37mDC-CONTROL: SUPER-AGENTS\x1b[0;31m ${"═".repeat(Math.max(0, width - 29))}╗\x1b[0m`);

    // Render Sub-tabs
    const tabLines = this.tabsComponent.render(width - 4);
    for (const tl of tabLines) {
      lines.push(`\x1b[31m║\x1b[0m  ${tl}${" ".repeat(Math.max(0, width - 4 - tl.replace(/\x1b\[[0-9;]*m/g, "").length))}\x1b[31m║\x1b[0m`);
    }
    lines.push(`\x1b[31m╟${"─".repeat(width - 2)}╢\x1b[0m`);

    if (this.activeSubtab === "86") {
      this.renderAgent86View(lines, width);
    } else {
      this.renderConfigView(lines, width);
    }

    lines.push(`\x1b[1;31m╚${"═".repeat(width - 2)}╝\x1b[0m`);
    return lines;
  }

  private renderAgent86View(lines: string[], width: number): void {
    const status = dcControlDaemonManager.getStatus();
    const dispatches = status.activeDispatches;
    const isDaemonRunning = status.running;
    const isTunnelRunning = status.tunnelActive;

    const daemonPill = isDaemonRunning ? "\x1b[32m● RUNNING\x1b[0m" : "\x1b[90m○ STOPPED\x1b[0m";
    const tunnelPill = isTunnelRunning ? "\x1b[32m● GH TUNNEL\x1b[0m" : "\x1b[90m○ NO TUNNEL\x1b[0m";

    lines.push(`\x1b[31m║\x1b[0m \x1b[1mEstado Daemon:\x1b[0m ${daemonPill}  ${tunnelPill}${" ".repeat(Math.max(0, width - 36))}\x1b[31m║\x1b[0m`);

    if (dispatches.length === 0) {
      lines.push(`\x1b[31m║\x1b[0m \x1b[90mNo hay misiones autónomas activas para #86\x1b[0m${" ".repeat(Math.max(0, width - 45))}\x1b[31m║\x1b[0m`);
      lines.push(`\x1b[31m║\x1b[0m \x1b[90mEsperando issues en GitHub o despacho manual...\x1b[0m${" ".repeat(Math.max(0, width - 50))}\x1b[31m║\x1b[0m`);
    } else {
      const active = dispatches[0];
      lines.push(`\x1b[31m║\x1b[0m \x1b[1;33m▶ Misión:\x1b[0m Issue #${active.issueNumber} \x1b[37m${active.branchName}\x1b[0m${" ".repeat(Math.max(0, width - 28 - active.branchName.length))}\x1b[31m║\x1b[0m`);
      lines.push(`\x1b[31m║\x1b[0m   \x1b[90mWorktree:\x1b[0m \x1b[36m${path.basename(active.worktreePath)}\x1b[0m${" ".repeat(Math.max(0, width - 15 - path.basename(active.worktreePath).length))}\x1b[31m║\x1b[0m`);

      // ODD Tasks
      const oddTasks = parseOddTasksFromWorktree(active.worktreePath, active.taskSlug);
      if (oddTasks.length > 0) {
        lines.push(`\x1b[31m║\x1b[0m   \x1b[1mPipeline ODD:\x1b[0m${" ".repeat(Math.max(0, width - 19))}\x1b[31m║\x1b[0m`);
        for (const t of oddTasks.slice(0, 4)) {
          let glyph = "\x1b[90m○\x1b[0m";
          if (t.status === "done") glyph = "\x1b[32m✓\x1b[0m";
          else if (t.status === "in_progress") glyph = "\x1b[33m▶\x1b[0m";
          else if (t.status === "failed") glyph = "\x1b[31m✗\x1b[0m";
          const shortTitle = t.title.length > width - 18 ? t.title.slice(0, width - 21) + "..." : t.title;
          lines.push(`\x1b[31m║\x1b[0m    ${glyph} \x1b[1m${t.id}:\x1b[0m ${shortTitle}${" ".repeat(Math.max(0, width - 12 - t.id.length - shortTitle.length))}\x1b[31m║\x1b[0m`);
        }
      }
    }

    lines.push(`\x1b[31m╟${"─".repeat(width - 2)}╢\x1b[0m`);
    lines.push(`\x1b[31m║\x1b[0m \x1b[1;37mAcciones Rápidas:\x1b[0m${" ".repeat(Math.max(0, width - 20))}\x1b[31m║\x1b[0m`);

    // Botones de acción interactivos
    const startY = lines.length;
    lines.push(`\x1b[31m║\x1b[0m   \x1b[1;41;37m [🏢 OFICINA DC-CONTROL] \x1b[0m  \x1b[1;40;37m [↻ REINICIAR] \x1b[0m${" ".repeat(Math.max(0, width - 46))}\x1b[31m║\x1b[0m`);
    this.actionButtonRegions.push({
      id: "btn-open-modal",
      y: startY,
      height: 1,
      action: () => {
        const ctx = (globalThis as any)[Symbol.for("dc.sidebar.ctx")];
        if (ctx) void openControlCenterModal(ctx);
      },
    });

    lines.push(`\x1b[31m║\x1b[0m   \x1b[1;40;37m [⚡ TEST ISSUE] \x1b[0m          \x1b[1;40;37m [■ DETENER] \x1b[0m${" ".repeat(Math.max(0, width - 46))}\x1b[31m║\x1b[0m`);
  }

  private renderConfigView(lines: string[], width: number): void {
    const gh = cachedGhStatus;
    const ghColor = gh?.ghInstalled ? "\x1b[32m✓ ACTIVO\x1b[0m" : "\x1b[31m✗ NO DETECTADO\x1b[0m";
    const status = dcControlDaemonManager.getStatus();

    lines.push(`\x1b[31m║\x1b[0m \x1b[1mBinarios & Servicios:\x1b[0m${" ".repeat(Math.max(0, width - 24))}\x1b[31m║\x1b[0m`);
    lines.push(`\x1b[31m║\x1b[0m   gh CLI:       ${ghColor} \x1b[90m(${gh?.ghVersion ? gh.ghVersion.slice(0, 16) : "verificando"})\x1b[0m${" ".repeat(Math.max(0, width - 40))}\x1b[31m║\x1b[0m`);
    lines.push(`\x1b[31m║\x1b[0m   Receptor:     ${status.running ? `\x1b[32m✓ 127.0.0.1:${status.port}\x1b[0m` : "\x1b[90m○ Inactivo\x1b[0m"}${" ".repeat(Math.max(0, width - 36))}\x1b[31m║\x1b[0m`);
    lines.push(`\x1b[31m║\x1b[0m   Túnel GitHub: ${status.tunnelActive ? "\x1b[32m✓ Conectado\x1b[0m" : "\x1b[90m○ Desconectado\x1b[0m"}${" ".repeat(Math.max(0, width - 34))}\x1b[31m║\x1b[0m`);

    lines.push(`\x1b[31m╟${"─".repeat(width - 2)}╢\x1b[0m`);
    lines.push(`\x1b[31m║\x1b[0m \x1b[1mConfiguración Super-Agente #86:\x1b[0m${" ".repeat(Math.max(0, width - 34))}\x1b[31m║\x1b[0m`);
    lines.push(`\x1b[31m║\x1b[0m   Arquetipo:    \x1b[33mdc-odd-worker\x1b[0m (TDD estricto)${" ".repeat(Math.max(0, width - 46))}\x1b[31m║\x1b[0m`);
    lines.push(`\x1b[31m║\x1b[0m   Herramientas: \x1b[36mfs-read, fs-write, terminal\x1b[0m${" ".repeat(Math.max(0, width - 45))}\x1b[31m║\x1b[0m`);
    lines.push(`\x1b[31m║\x1b[0m   Thinking:     \x1b[35mHigh\x1b[0m (Lease de Taxi de Flota)${" ".repeat(Math.max(0, width - 43))}\x1b[31m║\x1b[0m`);

    lines.push(`\x1b[31m╟${"─".repeat(width - 2)}╢\x1b[0m`);
    const startY = lines.length;
    lines.push(`\x1b[31m║\x1b[0m   \x1b[1;42;30m [▶ INICIAR DAEMON] \x1b[0m     \x1b[1;41;37m [■ DETENER TÚNEL] \x1b[0m${" ".repeat(Math.max(0, width - 46))}\x1b[31m║\x1b[0m`);
    this.actionButtonRegions.push({
      id: "btn-start-daemon",
      y: startY,
      height: 1,
      action: () => {
        const ctx = (globalThis as any)[Symbol.for("dc.sidebar.ctx")];
        if (ctx) void dcControlDaemonManager.start(ctx).then(() => this.requestRender?.());
      },
    });
  }

  invalidate(): void {
    this.tabsComponent.invalidate?.();
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult {
    // Pasar evento a las subtabs primero
    const tabRes = this.tabsComponent.handleMouse?.(event);
    if (tabRes?.handled) return tabRes;

    if (event.type === "click" && event.button === "left") {
      for (const btn of this.actionButtonRegions) {
        if (event.y === btn.y) {
          btn.action();
          return { handled: true };
        }
      }
    }
    return { handled: false };
  }
}

export function createSuperAgentsSidebarCard(requestRender?: () => void): Component {
  return new DcSuperAgentsSidebarCard(requestRender);
}
