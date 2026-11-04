import * as fs from "node:fs";
import * as path from "node:path";
import type { Theme, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Key, matchesKey, truncateToWidth, visibleWidth,
  type Component, type TUI, type TuiMouseEvent, type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { openDcModal } from "../../../ui/dc-modal.ts";
import {
  getCollaboratorsDatabase,
  type CollaboratorRecord,
  type AuditLogRecord,
} from "../daemon/dc-collaborators-db.ts";
import {
  dcIssueDispatcher,
  type DispatchedIssueTask,
} from "../daemon/dc-issue-dispatcher.ts";

export type ControlCenterTab = "worktrees" | "collaborators" | "audit";

interface OddRoadmapItem {
  id: string; // T1, T2
  title: string;
  status: "done" | "in_progress" | "pending";
}

function parseOddTasksFromWorktree(worktreePath: string, taskSlug: string): OddRoadmapItem[] {
  const specFile = path.join(worktreePath, "odd", "tasks", `${taskSlug}.md`);
  if (!fs.existsSync(specFile)) {
    return [
      { id: "T1", title: "Inicializar entorno y worktree", status: "done" },
      { id: "T2", title: "Analizar especificación del Issue", status: "in_progress" },
      { id: "T3", title: "Implementar solución con TDD", status: "pending" },
      { id: "T4", title: "Verificar y abrir Pull Request", status: "pending" },
    ];
  }

  try {
    const content = fs.readFileSync(specFile, "utf8");
    const lines = content.split("\n");
    const items: OddRoadmapItem[] = [];

    let inTasks = false;
    for (const line of lines) {
      if (line.startsWith("## Tasks")) {
        inTasks = true;
        continue;
      }
      if (inTasks && line.startsWith("## ")) {
        break;
      }
      if (inTasks && line.trim().startsWith("T")) {
        const match = line.match(/^(T\d+):\s*(.*)/);
        if (match && match[1] && match[2]) {
          const isDone = line.includes("[done]") || line.includes("✔");
          const isInProgress = line.includes("[in_progress]") || line.includes("▶");
          items.push({
            id: match[1],
            title: match[2].replace(/\[.*?\]/g, "").trim(),
            status: isDone ? "done" : isInProgress ? "in_progress" : "pending",
          });
        }
      }
    }

    if (items.length > 0) return items;
  } catch {
    /* fallback */
  }

  return [
    { id: "T1", title: "Inicializar entorno y worktree", status: "done" },
    { id: "T2", title: "Analizar requerimiento verbatim", status: "in_progress" },
    { id: "T3", title: "Escribir tests (RED)", status: "pending" },
    { id: "T4", title: "Implementar código (GREEN)", status: "pending" },
    { id: "T5", title: "Verificar con npm test y abrir PR", status: "pending" },
  ];
}

export class DcControlCenterPanel implements Component {
  private activeTab: ControlCenterTab = "worktrees";
  private selectedIndex = 0;
  private scrollOffset = 0;
  private readonly collabDb = getCollaboratorsDatabase();

  constructor(
    private readonly theme: Theme,
    private readonly onDone: () => void,
    private readonly requestRender?: () => void,
  ) {}

  invalidate(): void {}

  public getActiveTab(): ControlCenterTab {
    return this.activeTab;
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.escape) || data === "escape" || data === "q" || data === "Q") {
      this.onDone();
      return true;
    }

    if (data === "r" || data === "R") {
      this.requestRender?.();
      return true;
    }

    // Navegación de pestañas 1, 2, 3
    if (data === "1") {
      this.activeTab = "worktrees";
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.requestRender?.();
      return true;
    }
    if (data === "2") {
      this.activeTab = "collaborators";
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.requestRender?.();
      return true;
    }
    if (data === "3") {
      this.activeTab = "audit";
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.requestRender?.();
      return true;
    }

    if (matchesKey(data, Key.tab)) {
      if (this.activeTab === "worktrees") this.activeTab = "collaborators";
      else if (this.activeTab === "collaborators") this.activeTab = "audit";
      else this.activeTab = "worktrees";
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.requestRender?.();
      return true;
    }

    // Toggle de colaboradores con la barra espaciadora
    if (this.activeTab === "collaborators" && matchesKey(data, Key.space)) {
      const collabs = this.collabDb.listCollaborators();
      const target = collabs[this.selectedIndex];
      if (target) {
        this.collabDb.toggleCollaboratorStatus(target.login);
        this.requestRender?.();
        return true;
      }
    }

    // Navegación vertical
    if (matchesKey(data, Key.up) || data === "k") {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.requestRender?.();
      return true;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      const total = this.getItemsCount();
      this.selectedIndex = Math.min(Math.max(0, total - 1), this.selectedIndex + 1);
      this.requestRender?.();
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "click" && event.button === "left") {
      // Clic en barra de pestañas (fila 0)
      if (event.y === 0) {
        if (event.x < 24) this.activeTab = "worktrees";
        else if (event.x < 56) this.activeTab = "collaborators";
        else this.activeTab = "audit";
        this.selectedIndex = 0;
        this.requestRender?.();
        return { handled: true, render: true };
      }

      // Clic en lista de colaboradores para conmutar toggle
      if (this.activeTab === "collaborators" && event.y >= 3) {
        const clickedIdx = event.y - 3 + this.scrollOffset;
        const collabs = this.collabDb.listCollaborators();
        if (clickedIdx >= 0 && clickedIdx < collabs.length) {
          this.selectedIndex = clickedIdx;
          this.collabDb.toggleCollaboratorStatus(collabs[clickedIdx]!.login);
          this.requestRender?.();
          return { handled: true, render: true };
        }
      }
    }
    return undefined;
  }

  private getItemsCount(): number {
    if (this.activeTab === "worktrees") return Math.max(1, dcIssueDispatcher.getActiveDispatches().length);
    if (this.activeTab === "collaborators") return this.collabDb.listCollaborators().length;
    return this.collabDb.getRecentLogs(50).length;
  }

  render(width: number): string[] {
    const t = this.theme;
    const lines: string[] = [];
    const innerW = Math.max(40, width);

    // ── 1. Cabecera de Pestañas ──
    const tab1 = this.activeTab === "worktrees"
      ? t.bg("selectedBg", t.bold(t.fg("accent", " [1] Worktrees & ODD ")))
      : t.fg("dim", " [1] Worktrees & ODD ");
    const tab2 = this.activeTab === "collaborators"
      ? t.bg("selectedBg", t.bold(t.fg("accent", " [2] Colaboradores (Seguridad) ")))
      : t.fg("dim", " [2] Colaboradores (Seguridad) ");
    const tab3 = this.activeTab === "audit"
      ? t.bg("selectedBg", t.bold(t.fg("accent", " [3] Audit Log Forense ")))
      : t.fg("dim", " [3] Audit Log Forense ");

    lines.push(`${tab1} │ ${tab2} │ ${tab3}`);
    lines.push(t.fg("border", "─".repeat(innerW)));

    // ── 2. Contenido según pestaña activa ──
    if (this.activeTab === "worktrees") {
      this.renderWorktreesTab(lines, innerW);
    } else if (this.activeTab === "collaborators") {
      this.renderCollaboratorsTab(lines, innerW);
    } else {
      this.renderAuditLogTab(lines, innerW);
    }

    return lines.map((l) => truncateToWidth(l, innerW, ""));
  }

  private renderWorktreesTab(lines: string[], width: number): void {
    const t = this.theme;
    const dispatches = dcIssueDispatcher.getActiveDispatches();

    if (dispatches.length === 0) {
      lines.push("");
      lines.push(`  ${t.fg("dim", "No hay worktrees activos en este momento.")}`);
      lines.push(`  ${t.fg("dim", "Los issues que lleguen por GitHub Webhook se aislarán automáticamente aquí.")}`);
      lines.push("");
      lines.push(`  ${t.bold("Para simular o probar:")}`);
      lines.push(`  ${t.fg("accent", "• Crea un nuevo issue en GitHub o ejecuta '/dc-webhook status'")}`);
      return;
    }

    const currentDispatch = dispatches[this.selectedIndex] || dispatches[0]!;
    lines.push(
      `  ${t.bold(t.fg("accent", `▶ Issue #${currentDispatch.issueNumber}`))}: ${t.bold(currentDispatch.issueTitle)}`,
    );
    lines.push(`  ${t.fg("dim", "Rama:")} ${t.fg("warning", currentDispatch.branchName)}   ${t.fg("dim", "Worktree:")} ${t.fg("dim", currentDispatch.worktreePath)}`);
    lines.push(t.fg("border", "  " + "─".repeat(Math.max(10, width - 6))));
    lines.push(`  ${t.bold("📋 Hoja de Ruta ODD (Estado en Vivo):")}`);

    const roadmap = parseOddTasksFromWorktree(currentDispatch.worktreePath, currentDispatch.taskSlug);

    for (const item of roadmap) {
      let icon = t.fg("dim", "○");
      let statusLabel = t.fg("dim", "[PENDIENTE]");
      if (item.status === "done") {
        icon = t.fg("accent", "✔");
        statusLabel = t.fg("accent", "[DONE]");
      } else if (item.status === "in_progress") {
        icon = t.bold(t.fg("warning", "▶"));
        statusLabel = t.bold(t.fg("warning", "[EN PROCESO]"));
      }

      lines.push(`    ${icon} ${t.bold(item.id)}: ${item.title}  ${statusLabel}`);
    }
  }

  private renderCollaboratorsTab(lines: string[], width: number): void {
    const t = this.theme;
    const collabs = this.collabDb.listCollaborators();

    lines.push(`  ${t.bold("Permisos de Despacho Autónomo (Base de Datos Local SQLite):")}`);
    lines.push(`  ${t.fg("dim", "Solo los colaboradores en estado ALLOW pueden activar subagentes en worktrees.")}`);
    lines.push("");

    collabs.forEach((c, idx) => {
      const isSelected = idx === this.selectedIndex;
      const pointer = isSelected ? t.fg("accent", "▶ ") : "  ";

      let statusBadge = t.bold(t.fg("accent", "[✔ ALLOW]"));
      if (c.status === "BLOCK") {
        statusBadge = t.bold(t.fg("error", "[✖ BLOCK]"));
      } else if (c.status === "PENDING") {
        statusBadge = t.bold(t.fg("warning", "[? PENDING]"));
      }

      const roleBadge = t.fg("dim", `(${c.role})`);
      const row = `${pointer}@${c.login.padEnd(20)} ${statusBadge.padEnd(16)} ${roleBadge} ${c.notes ? t.fg("dim", "— " + c.notes) : ""}`;

      lines.push(isSelected ? t.bg("selectedBg", row) : row);
    });

    lines.push("");
    lines.push(`  ${t.fg("dim", "Presiona [Espacio] o haz Clic para alternar: ALLOW → BLOCK → PENDING")}`);
  }

  private renderAuditLogTab(lines: string[], width: number): void {
    const t = this.theme;
    const logs = this.collabDb.getRecentLogs(15);

    lines.push(`  ${t.bold("Registro Forense de Eventos de Seguridad y Despacho:")}`);
    lines.push("");

    if (logs.length === 0) {
      lines.push(`  ${t.fg("dim", "Sin eventos de auditoría registrados.")}`);
      return;
    }

    for (const log of logs) {
      const timeStr = new Date(log.timestamp).toLocaleTimeString();
      let lvl = t.fg("dim", `[${log.level}]`);
      if (log.level === "SECURITY") lvl = t.bold(t.fg("accent", `[${log.level}]`));
      else if (log.level === "WARN") lvl = t.fg("warning", `[${log.level}]`);
      else if (log.level === "ERROR") lvl = t.bold(t.fg("error", `[${log.level}]`));

      lines.push(`  ${t.fg("dim", timeStr)} ${lvl} ${t.bold(log.category)}: ${log.message}`);
    }
  }
}

/**
 * Abre el Centro de Control Autónomo, Worktrees y Seguridad.
 */
export async function openControlCenterModal(ctx: ExtensionContext): Promise<void> {
  let panelRef: DcControlCenterPanel | undefined;

  await openDcModal<void>(ctx, {
    title: "Dc Studio — Centro de Control Autónomo & Worktrees",
    glyph: "⛩ ",
    frame: "double",
    width: 82,
    maxHeight: 24,
    footer: (theme) => ({
      left: ` [1..3/Tab] Pestaña   [↑/↓] Navegar   [Espacio] Conmutar Toggle   [r] Refrescar`,
      right: `[Esc Salir] `,
    }),
    content: (done, theme, tui) => {
      panelRef = new DcControlCenterPanel(
        theme,
        () => done(undefined),
        () => tui.requestRender(),
      );
      return panelRef;
    },
  });
}
