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
  status: "done" | "in_progress" | "pending" | "failed";
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
          const isFailed = line.includes("[failed]") || line.includes("✖");
          items.push({
            id: match[1],
            title: match[2].replace(/\[.*?\]/g, "").trim(),
            status: isDone ? "done" : isInProgress ? "in_progress" : isFailed ? "failed" : "pending",
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

    // Navegación de pestañas: Ctrl+← / Ctrl+→ o ← / →
    const isCtrlLeft = data === "\x1b[1;5D" || data === "\x1b[5D";
    const isCtrlRight = data === "\x1b[1;5C" || data === "\x1b[5C";

    if (matchesKey(data, Key.left) || isCtrlLeft) {
      if (this.activeTab === "worktrees") this.activeTab = "audit";
      else if (this.activeTab === "collaborators") this.activeTab = "worktrees";
      else this.activeTab = "collaborators";
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.requestRender?.();
      return true;
    }
    if (matchesKey(data, Key.right) || isCtrlRight) {
      if (this.activeTab === "worktrees") this.activeTab = "collaborators";
      else if (this.activeTab === "collaborators") this.activeTab = "audit";
      else this.activeTab = "worktrees";
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.requestRender?.();
      return true;
    }

    // Scroll vertical rápido con Ctrl+↑ / Ctrl+↓ o PageUp / PageDown
    const isCtrlUp = data === "\x1b[1;5A" || data === "\x1b[5A";
    const isCtrlDown = data === "\x1b[1;5B" || data === "\x1b[5B";

    if (matchesKey(data, Key.pageUp) || isCtrlUp) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 5);
      this.requestRender?.();
      return true;
    }
    if (matchesKey(data, Key.pageDown) || isCtrlDown) {
      const total = this.getItemsCount();
      this.selectedIndex = Math.min(Math.max(0, total - 1), this.selectedIndex + 5);
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

    // Rellenar exactamente hasta 34 líneas interiores (altura fija constante igual a Sentinel)
    const targetInteriorRows = 34;
    while (lines.length < targetInteriorRows) {
      lines.push("");
    }

    return lines.slice(0, targetInteriorRows).map((l) => truncateToWidth(l, innerW, ""));
  }

  private renderWorktreesTab(lines: string[], width: number): void {
    const t = this.theme;
    const dispatches = dcIssueDispatcher.getActiveDispatches();

    const leftColW = Math.min(34, Math.max(26, Math.floor(width * 0.32)));
    const rightColW = Math.max(20, width - leftColW - 3);

    // Dividir en 2 paneles estilo Central de la imagen:
    // Panel Izquierdo: 1 DECISIONES, 2 TAREAS (subagentes en worktrees), 3 HECHO HOY
    // Panel Derecho: Inspección de decisión/tarea activa y acciones
    const leftLines: string[] = [];
    const rightLines: string[] = [];

    // --- Columna Izquierda ---
    leftLines.push(t.bold(t.fg("accent", "1 DECISIONES (0)")));
    leftLines.push(`  ${t.fg("dim", "Sin decisiones bloqueantes")}`);
    leftLines.push("");

    leftLines.push(t.bold(t.fg("warning", `2 TAREAS (${dispatches.length})`)));
    if (dispatches.length === 0) {
      leftLines.push(`  ${t.fg("dim", "Ningún subagente corriendo")}`);
    } else {
      dispatches.forEach((d, idx) => {
        const isSel = idx === this.selectedIndex;
        const icon = isSel ? t.bold(t.fg("accent", "▶")) : t.fg("dim", "○");
        const titleClipped = truncateToWidth(d.issueTitle, leftColW - 10, "");
        const label = ` #${d.issueNumber} ${titleClipped}`;
        leftLines.push(isSel ? t.bg("selectedBg", `${icon}${t.bold(label)}`) : `  ${icon}${label}`);
      });
    }
    leftLines.push("");

    leftLines.push(t.bold(t.fg("accent", "3 HECHO HOY (0)")));
    leftLines.push(`  ${t.fg("dim", "Esperando primera entrega...")}`);

    // --- Columna Derecha ---
    if (dispatches.length === 0) {
      rightLines.push(t.bold("Bienvenido al Centro de Control de DC Super-Agent"));
      rightLines.push(t.fg("dim", "─".repeat(rightColW)));
      rightLines.push("");
      rightLines.push(`• ${t.bold("1 Decisiones")}: Requerimientos que necesitan tu confirmación (s/n/d).`);
      rightLines.push(`• ${t.bold("2 Tareas")}: Subagentes autónomos trabajando en sus worktrees.`);
      rightLines.push(`• ${t.bold("3 Hecho Hoy")}: Tareas y Pull Requests entregadas exitosamente.`);
      rightLines.push("");
      rightLines.push(`  ${t.fg("dim", "Los issues que lleguen por GitHub Webhook se aislarán automáticamente aquí.")}`);
    } else {
      const current = dispatches[this.selectedIndex] || dispatches[0]!;
      rightLines.push(t.bold(t.fg("accent", `Issue #${current.issueNumber}`)) + `: ${t.bold(current.issueTitle)}`);
      rightLines.push(t.fg("dim", `Rama: ${current.branchName}  |  Worktree: ${current.worktreePath}`));
      rightLines.push(t.fg("border", "─".repeat(rightColW)));

      rightLines.push(t.bold("📋 Hoja de Ruta ODD en Vivo:"));
      const roadmap = parseOddTasksFromWorktree(current.worktreePath, current.taskSlug);

      for (const item of roadmap) {
        let icon = t.fg("dim", "○");
        let statusLabel = t.fg("dim", "[PENDIENTE]");
        if (item.status === "done") {
          icon = t.fg("accent", "✔");
          statusLabel = t.fg("accent", "[DONE]");
        } else if (item.status === "in_progress") {
          icon = t.bold(t.fg("warning", "▶"));
          statusLabel = t.bold(t.fg("warning", "[EN PROCESO]"));
        } else if (item.status === "failed") {
          icon = t.bold(t.fg("error", "✖"));
          statusLabel = t.bold(t.fg("error", "[FALLO]"));
        }
        rightLines.push(`  ${icon} ${t.bold(item.id)}: ${item.title}  ${statusLabel}`);
      }

      rightLines.push("");
      rightLines.push(t.fg("border", "─".repeat(rightColW)));
      rightLines.push(`Acciones:  ${t.bold(t.fg("accent", "[s]"))} Aprobar/Arreglar   ${t.bold(t.fg("accent", "[n]"))} Descartar   ${t.bold(t.fg("accent", "[o]"))} Abrir en GitHub`);
    }

    // Combinar en dos columnas visuales
    const maxRows = Math.max(leftLines.length, rightLines.length);
    for (let r = 0; r < maxRows; r++) {
      const leftPart = leftLines[r] ?? "";
      const rightPart = rightLines[r] ?? "";
      const leftPadded = truncateToWidth(leftPart, leftColW, "") + " ".repeat(Math.max(0, leftColW - visibleWidth(leftPart)));
      lines.push(`  ${leftPadded} ${t.fg("border", "│")} ${rightPart}`);
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
 * Adopta las dimensiones exactas y el alto fijo de 40 filas del Centinela (Alt+Shift+S)
 * rellenando siempre hasta 34 filas interiores constantes para evitar variaciones de altura.
 */
export async function openControlCenterModal(ctx: ExtensionContext): Promise<void> {
  let panelRef: DcControlCenterPanel | undefined;

  await openDcModal<void>(ctx, {
    title: "Dc Studio — Centro de Control Autónomo & Worktrees",
    glyph: "⛩ ",
    frame: "double",
    paddingX: 0,
    width: "92%",
    maxHeight: 40,
    scrollable: false,
    showScrollbar: false,
    footer: (theme) => ({
      left: ` [1..3/Tab/←→] Pestaña   [↑/↓] Navegar   [Ctrl+↑/↓] Salto rápido   [Espacio] Conmutar Toggle   [r] Refrescar`,
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
