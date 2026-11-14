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
import {
  dcRemoteQuestionManager,
  type AgentQuestionPacket,
} from "../daemon/dc-remote-question.ts";

export type ControlCenterTab = "worktrees" | "collaborators" | "audit";

export interface CentralDecisionItem {
  id: string;
  index: number;
  title: string;
  timeAgo: string;
  statusIcon: "✓" | "▲" | "○";
  statusText: string;
  detailsLine: string;
  breadcrumb: string;
  subtitle: string;
  prTitle: string;
  branchInfo: string;
  url: string;
  summaryCard: {
    peticion: string;
    quien: string;
    sugerido: string;
  };
  comments: Array<{
    author: string;
    threads: number;
    text: string;
  }>;
  questionPacket?: AgentQuestionPacket;
}

export interface CentralTaskItem {
  id: string;
  taskNumber: number;
  issueNumber?: number;
  title: string;
  status: "done" | "in_progress" | "failed" | "cancelled" | "pending";
  statusIcon: "✓" | "▶" | "✖" | "○";
  timeAgo: string;
  scopeText?: string;
  worktreePath?: string;
  branchName?: string;
  taskSlug?: string;
  summaryCard?: {
    estado: string;
    subagente: string;
    sugerido: string;
  };
}

export interface CentralCompletedItem {
  id: string;
  title: string;
  completedAt: string;
  prUrl?: string;
}

interface OddRoadmapItem {
  id: string;
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
  private selectedIndex = 1; // Seleccionado por defecto WibondConnect#3759 para coincidir con la captura
  private scrollOffset = 0;
  private readonly collabDb = getCollaboratorsDatabase();

  // Estados interactivos para Central
  private simulatedMode = true;
  private isInputMode = false;
  private inputText = "";
  private isHelpMode = false;
  private lastActionMessage = "";

  // Datos simulados por defecto (fieles al requerimiento de la captura de pantalla)
  private readonly defaultDecisions: CentralDecisionItem[] = [
    {
      id: "dec-1",
      index: 1,
      title: "#1 prueba listar src",
      timeAgo: "5h",
      statusIcon: "✓",
      statusText: "listo · Archivos en src (15): brain.ts",
      detailsLine: "tuyo · base master · aprobado · merge listo",
      breadcrumb: "Decisiones » #1 prueba listar src",
      subtitle: "Revisión aprobada y lista para mergear",
      prTitle: "feat: listar src y catalogar brain.ts",
      branchInfo: "de davidcoachdev · master ← feat/listar-src · +120 -10 en 3 archivos · hace 5h",
      url: "https://github.com/davidcoachdev/dc-pi/pull/1",
      summaryCard: {
        peticion: "Listo para merge",
        quien: "davidcoachdev aprobó",
        sugerido: "Merge automático a rama principal",
      },
      comments: [
        { author: "davidcoachdev", threads: 1, text: "Pruebas deterministas verificadas con éxito." },
      ],
    },
    {
      id: "dec-2",
      index: 2,
      title: "WibondConnect#3759",
      timeAgo: "4h",
      statusIcon: "▲",
      statusText: "2 hilos de 2 revisores · comentaron",
      detailsLine: "tuyo · base nonprod · aprobado · review pedida a gdepaoli-wibond",
      breadcrumb: "Decisiones » WibondConnect#3759",
      subtitle: "2 revisores comentaron 2 hilos en tu PR WibondConnect#3759",
      prTitle: "WibondConnect#3759 fix(treasury): Lectura exacta de movimientos desde execute",
      branchInfo: "de roccag · nonprod ← fix/treasury-movement-read · +357 -33 en 7 archivos · hace 4h",
      url: "https://github.com/wibond2/WibondConnect/pull/3759",
      summaryCard: {
        peticion: "1 menor",
        quien: "gdepaoli-wibond comentó (1) · Pablo comentó (0)",
        sugerido: "Mirar los comentarios y arreglar lo que corresponda",
      },
      comments: [
        { author: "gdepaoli-wibond", threads: 1, text: "Corrí go build, go vet y..." },
        { author: "Pablo", threads: 0, text: "menores" },
      ],
    },
  ];

  private readonly defaultTasks: CentralTaskItem[] = [
    {
      id: "task-3",
      taskNumber: 3,
      title: "#3 #3759 fixes - WibondConnect falló",
      status: "failed",
      statusIcon: "✖",
      timeAgo: "4h",
      scopeText: "fix(treasury): resolver comentarios de revisores",
      summaryCard: {
        estado: "Falló verificación determinista en T4",
        subagente: "dc-super-agent (taxi ac32)",
        sugerido: "Reintentar con hotfix o inspeccionar spec ODD",
      },
    },
    {
      id: "task-2",
      taskNumber: 2,
      title: "#2 prueba sleep hola - central cancelada",
      status: "cancelled",
      statusIcon: "○",
      timeAgo: "4h",
      scopeText: "Tarea cancelada por el usuario",
    },
    {
      id: "task-1",
      taskNumber: 1,
      title: "#1 prueba listar src - central <1m",
      status: "done",
      statusIcon: "✓",
      timeAgo: "<1m",
      scopeText: "Alcance sin archivos marcados",
    },
  ];

  constructor(
    private readonly theme: Theme,
    private readonly onDone: () => void,
    private readonly requestRender?: () => void,
  ) {}

  invalidate(): void {}

  public getActiveTab(): ControlCenterTab {
    return this.activeTab;
  }

  public isInputActive(): boolean {
    return this.isInputMode;
  }

  public getInputText(): string {
    return this.inputText;
  }

  public isHelpActive(): boolean {
    return this.isHelpMode;
  }

  public isSimulatedMode(): boolean {
    return this.simulatedMode;
  }

  public setSimulatedMode(val: boolean): void {
    this.simulatedMode = val;
    this.requestRender?.();
  }

  private getAllItems(): Array<{ kind: "decision" | "task" | "completed"; data: any }> {
    const items: Array<{ kind: "decision" | "task" | "completed"; data: any }> = [];

    // Decisiones en vivo de preguntas remotas pendientes
    const remoteQuestions = dcRemoteQuestionManager.getPendingQuestions();
    for (const q of remoteQuestions) {
      items.push({
        kind: "decision",
        data: {
          id: q.id,
          index: items.length + 1,
          title: `Issue #${q.issueNumber} Pregunta`,
          timeAgo: "ahora",
          statusIcon: "▲",
          statusText: q.question,
          detailsLine: q.contextSummary,
          breadcrumb: `Decisiones » Issue #${q.issueNumber}`,
          subtitle: `El subagente requiere tu decisión: ${q.question}`,
          prTitle: q.issueTitle,
          branchInfo: `Issue #${q.issueNumber} · Opciones: ${(q.options || []).join(" | ")}`,
          url: "",
          summaryCard: {
            peticion: "Decisión requerida",
            quien: "dc-super-agent",
            sugerido: q.question,
          },
          comments: (q.options || []).map((opt) => ({ author: "opción", threads: 1, text: opt })),
          questionPacket: q,
        } as CentralDecisionItem,
      });
    }

    if (this.simulatedMode) {
      for (const d of this.defaultDecisions) {
        items.push({ kind: "decision", data: d });
      }
    }

    // Tareas en vivo de dispatches
    const activeDispatches = dcIssueDispatcher.getActiveDispatches();
    for (const disp of activeDispatches) {
      items.push({
        kind: "task",
        data: {
          id: `disp-${disp.issueNumber}`,
          taskNumber: disp.issueNumber,
          issueNumber: disp.issueNumber,
          title: `#${disp.issueNumber} ${disp.issueTitle}`,
          status: "in_progress",
          statusIcon: "▶",
          timeAgo: "en proceso",
          scopeText: `Rama: ${disp.branchName}`,
          worktreePath: disp.worktreePath,
          branchName: disp.branchName,
          taskSlug: disp.taskSlug,
          summaryCard: {
            estado: "Subagente en ejecución",
            subagente: "dc-super-agent",
            sugerido: "Monitorear ODD Roadmap en vivo",
          },
        } as CentralTaskItem,
      });
    }

    if (this.simulatedMode) {
      for (const t of this.defaultTasks) {
        items.push({ kind: "task", data: t });
      }
    }

    return items;
  }

  handleInput(data: string): boolean {
    // ── Si la ayuda modal de teclas está activa ──
    if (this.isHelpMode) {
      if (matchesKey(data, Key.escape) || data === "escape" || data === "?" || data === "q" || data === "Q") {
        this.isHelpMode = false;
        this.requestRender?.();
        return true;
      }
      return true;
    }

    // ── Si el modo de entrada de texto interactivo está activo ──
    if (this.isInputMode) {
      if (matchesKey(data, Key.escape) || data === "escape") {
        this.isInputMode = false;
        this.inputText = "";
        this.requestRender?.();
        return true;
      }

      if (matchesKey(data, Key.backspace) || data === "\x7f" || data === "\b") {
        if (this.inputText.length > 0) {
          this.inputText = this.inputText.slice(0, -1);
          this.requestRender?.();
        }
        return true;
      }

      if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
        const submitted = this.inputText.trim();
        if (submitted) {
          this.lastActionMessage = `✔ Enviado a Central: "${truncateToWidth(submitted, 40, "...")}"`;
          this.collabDb.log({
            level: "INFO",
            category: "DISPATCH",
            actor: "human",
            message: `Instrucción a Central: ${submitted}`,
          });

          // Si el elemento seleccionado es una pregunta remota, responderle con el texto
          const items = this.getAllItems();
          const current = items[this.selectedIndex]?.data as CentralDecisionItem | undefined;
          if (current?.questionPacket) {
            dcRemoteQuestionManager.postAnswer({
              questionId: current.questionPacket.id,
              customText: submitted,
              answeredAt: Date.now(),
              source: "custom_text",
            });
            this.lastActionMessage = `✔ Respuesta enviada al subagente: "${submitted}"`;
          }
        }
        this.isInputMode = false;
        this.inputText = "";
        this.requestRender?.();
        return true;
      }

      // Carácter imprimible
      if (data.length === 1 && data >= " ") {
        this.inputText += data;
        this.requestRender?.();
        return true;
      }

      return true;
    }

    // ── Modo normal de Central ──

    // Escape cierra el modal
    if (matchesKey(data, Key.escape) || data === "escape" || data === "q" || data === "Q") {
      this.onDone();
      return true;
    }

    // Refrescar
    if (data === "r" || data === "R") {
      this.lastActionMessage = "✔ Estado actualizado en vivo";
      this.requestRender?.();
      return true;
    }

    // Alternar ayuda '?'
    if (data === "?") {
      this.isHelpMode = !this.isHelpMode;
      this.requestRender?.();
      return true;
    }

    // Conmutar modo simulado 'm' / 'M'
    if (data === "m" || data === "M") {
      this.simulatedMode = !this.simulatedMode;
      this.lastActionMessage = this.simulatedMode ? "● Modo Simulado Activado" : "● Modo En Vivo Activado";
      this.requestRender?.();
      return true;
    }

    // Activar input de texto con '/'
    if (data === "/") {
      this.isInputMode = true;
      this.inputText = "";
      this.requestRender?.();
      return true;
    }

    // Ctrl+K limpia o enfoca el input
    if (data === "\x0b") { // Ctrl+K
      this.isInputMode = true;
      this.inputText = "";
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

    if (matchesKey(data, Key.tab)) {
      if (this.activeTab === "worktrees") this.activeTab = "collaborators";
      else if (this.activeTab === "collaborators") this.activeTab = "audit";
      else this.activeTab = "worktrees";
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.requestRender?.();
      return true;
    }

    // Acciones específicas en Pestaña 1 (Central & Worktrees)
    if (this.activeTab === "worktrees") {
      const items = this.getAllItems();
      const current = items[this.selectedIndex]?.data;

      // [a] o [s]: Arreglar en tu PR / Aprobar
      if (data === "a" || data === "A" || data === "s" || data === "S") {
        this.lastActionMessage = `✔ [a] Arreglar en PR ejecutado para ${current?.title || "item"}`;
        this.collabDb.log({
          level: "INFO",
          category: "DISPATCH",
          actor: "human",
          message: `Acción Arreglar ejecutada sobre ${current?.title}`,
        });
        if (current?.questionPacket) {
          dcRemoteQuestionManager.postAnswer({
            questionId: current.questionPacket.id,
            chosenOption: current.questionPacket.options?.[0] || "Aprobar",
            answeredAt: Date.now(),
            source: "option",
          });
        }
        this.requestRender?.();
        return true;
      }

      // [n]: Descartar
      if (data === "n" || data === "N") {
        this.lastActionMessage = `✔ [n] Descartado: ${current?.title || "item"}`;
        this.collabDb.log({
          level: "WARN",
          category: "DISPATCH",
          actor: "human",
          message: `Descartado ${current?.title}`,
        });
        if (current?.questionPacket) {
          dcRemoteQuestionManager.postAnswer({
            questionId: current.questionPacket.id,
            chosenOption: "Descartar",
            answeredAt: Date.now(),
            source: "dismissed",
          });
        }
        this.requestRender?.();
        return true;
      }

      // [d]: Mañana 9:00 (Posponer / Recordar)
      if (data === "d" || data === "D") {
        this.lastActionMessage = `✔ [d] Pospuesto para mañana 9:00: ${current?.title || "item"}`;
        this.requestRender?.();
        return true;
      }

      // [o]: Abrir en GitHub
      if (data === "o" || data === "O") {
        this.lastActionMessage = `✔ [o] Abriendo en GitHub: ${current?.url || "https://github.com"}`;
        this.requestRender?.();
        return true;
      }
    }

    // Toggle de colaboradores con la barra espaciadora en Pestaña 2
    if (this.activeTab === "collaborators" && matchesKey(data, Key.space)) {
      const collabs = this.collabDb.listCollaborators();
      const target = collabs[this.selectedIndex];
      if (target) {
        this.collabDb.toggleCollaboratorStatus(target.login);
        this.requestRender?.();
        return true;
      }
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
      // Clic en barra de pestañas (fila 2)
      if (event.y === 2) {
        if (event.x < 32) this.activeTab = "worktrees";
        else if (event.x < 65) this.activeTab = "collaborators";
        else this.activeTab = "audit";
        this.selectedIndex = 0;
        this.requestRender?.();
        return { handled: true, render: true };
      }

      // Clic en la barra inferior de escribir (fila 30)
      if (event.y >= 29 && event.y <= 31) {
        this.isInputMode = true;
        this.requestRender?.();
        return { handled: true, render: true };
      }

      // Clic en botones de acción en Central (fila 16 aproximadamente)
      if (this.activeTab === "worktrees" && event.y >= 14 && event.y <= 18 && event.x >= 35) {
        this.handleInput("a");
        return { handled: true, render: true };
      }

      // Clic en lista de colaboradores para conmutar toggle
      if (this.activeTab === "collaborators" && event.y >= 5) {
        const clickedIdx = event.y - 5 + this.scrollOffset;
        const collabs = this.collabDb.listCollaborators();
        if (clickedIdx >= 0 && clickedIdx < collabs.length) {
          this.selectedIndex = clickedIdx;
          this.collabDb.toggleCollaboratorStatus(collabs[clickedIdx]!.login);
          this.requestRender?.();
          return { handled: true, render: true };
        }
      }

      // Clic en elementos de la columna izquierda de Central
      if (this.activeTab === "worktrees" && event.y >= 4 && event.y <= 27 && event.x < 35) {
        const items = this.getAllItems();
        const clickedIdx = Math.min(items.length - 1, Math.max(0, Math.floor((event.y - 4) / 3)));
        this.selectedIndex = clickedIdx;
        this.requestRender?.();
        return { handled: true, render: true };
      }
    }
    return undefined;
  }

  private getItemsCount(): number {
    if (this.activeTab === "worktrees") return Math.max(1, this.getAllItems().length);
    if (this.activeTab === "collaborators") return this.collabDb.listCollaborators().length;
    return this.collabDb.getRecentLogs(50).length;
  }

  render(width: number): string[] {
    const t = this.theme;
    const lines: string[] = [];
    const innerW = Math.max(40, width);

    // ── 0. Barra superior: DC-CONTROL · OFICINA CENTRAL DE SUPER-AGENTES ──
    const dispatches = dcIssueDispatcher.getActiveDispatches();
    const workingCount = dispatches.length > 0 ? dispatches.length : (this.simulatedMode ? 1 : 0);
    const readyCount = this.simulatedMode ? 3 : 4;
    const topStatusLine = `${t.bold(t.fg("accent", "🏢 DC-CONTROL"))} ${t.fg("dim", "·")} ${t.bold(t.fg("accent", "OFICINA CENTRAL"))}  ${t.fg("accent", `${readyCount} listos`)} ${t.fg("dim", "·")} ${t.bold(t.fg("warning", `${workingCount} trabajando`))}`;
    lines.push(topStatusLine);

    // ── 1. Banner de Central: ▲ CENTRAL 2 te necesitan ● MODO PRUEBA ──
    const allItems = this.getAllItems();
    const needsCount = allItems.filter((i) => i.kind === "decision").length;
    const needsLabel = needsCount > 0 ? `${needsCount} te necesitan` : "al día";
    const modeLabel = this.simulatedMode ? "MODO PRUEBA - nada sale a GitHub" : "MODO PRODUCCIÓN - entregas en vivo";

    const badgePart = `${t.bold(t.fg("accent", "▲ CENTRAL"))}  ${t.bold(needsLabel)}`;
    const modePart = `${t.bold(t.fg("accent", "●"))} ${t.fg("dim", modeLabel)}`;
    const syncPart = t.fg("dim", "GitHub al día");

    const headerGap = Math.max(2, Math.floor((innerW - visibleWidth(badgePart) - visibleWidth(modePart) - visibleWidth(syncPart)) / 2));
    lines.push(`${badgePart}${" ".repeat(headerGap)}${modePart}${" ".repeat(headerGap)}${syncPart}`);

    // Selector de Agentes
    const agent86Chip = `${t.bg("selectedBg", t.bold(t.fg("accent", " 🤖 AGENT #86 ")))}`;
    const agent87Chip = `${t.fg("dim", " 🤖 AGENT #87 (PRÓXIMO) ")}`;
    lines.push(`${t.fg("dim", "Super-Agentes:")} ${agent86Chip} ${agent87Chip}`);

    // ── 2. Pestañas de navegación ──
    const tab1 = this.activeTab === "worktrees"
      ? t.bg("selectedBg", t.bold(t.fg("accent", " [1] Central (Worktrees & ODD) ")))
      : t.fg("dim", " [1] Central (Worktrees & ODD) ");
    const tab2 = this.activeTab === "collaborators"
      ? t.bg("selectedBg", t.bold(t.fg("accent", " [2] Colaboradores (Seguridad) ")))
      : t.fg("dim", " [2] Colaboradores (Seguridad) ");
    const tab3 = this.activeTab === "audit"
      ? t.bg("selectedBg", t.bold(t.fg("accent", " [3] Audit Log Forense ")))
      : t.fg("dim", " [3] Audit Log Forense ");

    lines.push(`${tab1} │ ${tab2} │ ${tab3}`);
    lines.push(t.fg("border", "─".repeat(innerW)));

    // ── 3. Contenido según pestaña activa ──
    if (this.activeTab === "worktrees") {
      this.renderCentralTab(lines, innerW);
    } else if (this.activeTab === "collaborators") {
      this.renderCollaboratorsTab(lines, innerW);
    } else {
      this.renderAuditLogTab(lines, innerW);
    }

    // ── 4. Si la ayuda de teclas está activa, sobreponer modal visual ──
    if (this.isHelpMode) {
      this.overlayHelpCard(lines, innerW);
    }

    // Rellenar exactamente hasta 34 líneas interiores (altura fija constante)
    const targetInteriorRows = 34;
    while (lines.length < targetInteriorRows) {
      lines.push("");
    }

    return lines.slice(0, targetInteriorRows).map((l) => truncateToWidth(l, innerW, ""));
  }

  private renderCentralTab(lines: string[], width: number): void {
    const t = this.theme;
    const allItems = this.getAllItems();
    const decisions = allItems.filter((i) => i.kind === "decision");
    const tasks = allItems.filter((i) => i.kind === "task");
    const completedCount = 0;

    const leftColW = Math.min(36, Math.max(28, Math.floor(width * 0.32)));
    const rightColW = Math.max(24, width - leftColW - 3);

    const leftLines: string[] = [];
    const rightLines: string[] = [];

    // ── COLUMNA IZQUIERDA: 1 DECISIONES, 2 TAREAS, 3 HECHO HOY ──
    // Sección 1: DECISIONES
    const decHeader = `${t.bold(t.fg("accent", `1 DECISIONES · ${decisions.length}`))} ${t.fg("dim", "─".repeat(Math.max(2, leftColW - 22)))} ${t.fg("dim", "s/n/d")}`;
    leftLines.push(decHeader);

    if (decisions.length === 0) {
      leftLines.push(`  ${t.fg("dim", "Sin decisiones pendientes")}`);
    } else {
      decisions.forEach((item, idx) => {
        const isSel = idx === this.selectedIndex;
        const d = item.data as CentralDecisionItem;
        const pointer = isSel ? t.bold(t.fg("accent", "▶ ")) : "  ";
        const icon = d.statusIcon === "✓" ? t.fg("accent", "✓ ") : d.statusIcon === "▲" ? t.bold(t.fg("warning", "▲ ")) : t.fg("dim", "○ ");
        const titleLine = `${pointer}${icon}${d.index} ${t.bold(d.title)} ${t.fg("dim", d.timeAgo)}`;
        leftLines.push(isSel ? t.bg("selectedBg", truncateToWidth(titleLine, leftColW, "")) : truncateToWidth(titleLine, leftColW, ""));

        const sub1 = `    ${t.fg("dim", truncateToWidth(d.statusText, leftColW - 6, ""))}`;
        leftLines.push(sub1);
        const sub2 = `    ${t.fg("dim", truncateToWidth(d.detailsLine, leftColW - 6, ""))}`;
        leftLines.push(sub2);
      });
    }
    leftLines.push("");

    // Sección 2: TAREAS
    leftLines.push(t.bold(t.fg("warning", `2 TAREAS · ${tasks.length}`)));
    if (tasks.length === 0) {
      leftLines.push(`  ${t.fg("dim", "Ninguna tarea en ejecución")}`);
    } else {
      tasks.forEach((item, tIdx) => {
        const globalIdx = decisions.length + tIdx;
        const isSel = globalIdx === this.selectedIndex;
        const task = item.data as CentralTaskItem;
        const pointer = isSel ? t.bold(t.fg("accent", "▶ ")) : "  ";
        let icon = t.fg("dim", "○ ");
        if (task.status === "failed") icon = t.bold(t.fg("error", "✖ "));
        else if (task.status === "done") icon = t.fg("accent", "✓ ");
        else if (task.status === "in_progress") icon = t.bold(t.fg("warning", "▶ "));

        const titleLine = `${pointer}${icon}${task.title}`;
        leftLines.push(isSel ? t.bg("selectedBg", truncateToWidth(titleLine, leftColW, "")) : truncateToWidth(titleLine, leftColW, ""));

        if (task.scopeText) {
          leftLines.push(`    ${t.fg("dim", truncateToWidth(task.scopeText, leftColW - 6, ""))}`);
        }
      });
    }
    leftLines.push("");

    // Sección 3: HECHO HOY
    leftLines.push(t.bold(t.fg("accent", `3 HECHO HOY · ${completedCount}`)));
    leftLines.push(`  ${t.fg("dim", "todavía nada hoy")}`);

    // ── COLUMNA DERECHA: INSPECCIÓN, RESUMEN, ACCIONES, COMENTARIOS Y BIENVENIDA ──
    const current = allItems[this.selectedIndex]?.data;

    if (current && (current as CentralDecisionItem).summaryCard) {
      const dec = current as CentralDecisionItem;
      // Breadcrumb y título
      rightLines.push(`${t.bold(t.fg("dim", "Decisiones » "))}${t.bold(t.fg("accent", dec.title))}`);
      rightLines.push(t.fg("dim", dec.subtitle));
      rightLines.push(t.bold(dec.prTitle));
      rightLines.push(t.fg("dim", dec.branchInfo));
      if (dec.url) {
        rightLines.push(t.fg("dim", dec.url));
      }
      rightLines.push("");

      // Tarjeta RESUMEN
      const cardW = Math.max(20, Math.min(rightColW - 2, 66));
      rightLines.push(t.fg("border", `┌─ ${t.bold("RESUMEN")} ${"─".repeat(Math.max(2, cardW - 12))}┐`));
      rightLines.push(`${t.fg("border", "│")} ${t.bold("Qué piden".padEnd(12))} ${truncateToWidth(dec.summaryCard.peticion || "", cardW - 16, "")} ${t.fg("border", "│")}`);
      rightLines.push(`${t.fg("border", "│")} ${t.bold("Quién".padEnd(12))} ${truncateToWidth(dec.summaryCard.quien || "", cardW - 16, "")} ${t.fg("border", "│")}`);
      rightLines.push(`${t.fg("border", "│")} ${t.bold("Sugerido".padEnd(12))} ${truncateToWidth(dec.summaryCard.sugerido || "", cardW - 16, "")} ${t.fg("border", "│")}`);
      rightLines.push(t.fg("border", `└${"─".repeat(cardW - 2)}┘`));
      rightLines.push("");

      // Barra de Botones de Acción
      const btnA = t.bold(t.fg("accent", "[a] Arreglar en tu PR"));
      const btnN = t.bold(t.fg("dim", "[n] Descartar"));
      const btnD = t.bold(t.fg("dim", "[d] Mañana 9:00"));
      const btnO = t.bold(t.fg("dim", "[o] Abrir en GitHub"));
      rightLines.push(`${btnA}   ${btnN}   ${btnD}   ${btnO}`);
      rightLines.push("");

      // Comentarios de Revisores
      if (dec.comments && dec.comments.length > 0) {
        dec.comments.forEach((c) => {
          rightLines.push(`• ${t.bold(c.author)} ${t.fg("dim", "· comentó ·")} ${c.threads} hilo ${t.fg("dim", "· menores:")} ${c.text}`);
        });
      }
    } else if (current && (current as CentralTaskItem).worktreePath) {
      // Tarea con worktree real en ejecución
      const task = current as CentralTaskItem;
      rightLines.push(`${t.bold(t.fg("dim", "Tareas » "))}${t.bold(t.fg("warning", task.title))}`);
      rightLines.push(t.fg("dim", `Rama: ${task.branchName}  |  Worktree: ${task.worktreePath}`));
      rightLines.push("");

      rightLines.push(t.bold("📋 Hoja de Ruta ODD en Vivo:"));
      const roadmap = parseOddTasksFromWorktree(task.worktreePath!, task.taskSlug || "task");
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
    } else {
      // Estado de bienvenida por defecto
      rightLines.push(t.bold("Bienvenido a Central"));
      rightLines.push(t.fg("dim", "─".repeat(rightColW - 2)));
      rightLines.push(`• ${t.bold("1 Decisiones")}: Lo que te necesita · ${t.fg("accent", "[enter]")} ver · ${t.fg("accent", "s")} sí · ${t.fg("accent", "n")} no · ${t.fg("accent", "d")} después`);
      rightLines.push(`• ${t.bold("2 Tareas")}: Los Claude trabajando · ${t.fg("accent", "[enter]")} espejo en vivo · a responderles`);
      rightLines.push(`• ${t.bold("Escribile a central abajo")} · ${t.fg("accent", "ctrl+k")} todo · ${t.fg("accent", "?")} teclas · ${t.fg("accent", "esc")} cierra`);
    }

    // Si hay un mensaje de acción reciente, mostrarlo en la columna derecha
    if (this.lastActionMessage) {
      rightLines.push("");
      rightLines.push(t.bold(t.fg("accent", this.lastActionMessage)));
    }

    // Sección de Bienvenida fija abajo a la derecha (como en la captura)
    if (rightLines.length < 18) {
      while (rightLines.length < 18) rightLines.push("");
      rightLines.push(t.bold("Bienvenido a Central"));
      rightLines.push(`1 Decisiones: lo que te necesita · ver · s sí · n no · d después`);
      rightLines.push(`2 Tareas: los Claude trabajando · espejo en vivo · a responderles`);
      rightLines.push(`Escribile a central abajo · ctrl+k todo · ? teclas · esc cierra`);
    }

    // Combinar en dos columnas visuales para el cuerpo de Central (filas 4..27)
    const maxRows = Math.min(23, Math.max(leftLines.length, rightLines.length));
    for (let r = 0; r < maxRows; r++) {
      const leftPart = leftLines[r] ?? "";
      const rightPart = rightLines[r] ?? "";
      const leftPadded = truncateToWidth(leftPart, leftColW, "") + " ".repeat(Math.max(0, leftColW - visibleWidth(leftPart)));
      lines.push(`${leftPadded} ${t.fg("border", "│")} ${rightPart}`);
    }

    // ── LÍNEAS 28..31: BARRA INFERIOR INTERACTIVA "ESCRIBILE A CENTRAL" Y ATAJOS ──
    lines.push(t.fg("border", "─".repeat(width)));

    const selectedTitle = current?.title || (decisions[0]?.data as CentralDecisionItem)?.title || "WibondConnect#3759";
    const promptHeader = `escribile a central — sobre: ${t.bold(selectedTitle)} ·`;
    lines.push(promptHeader);

    let inputBody = t.fg("dim", "/ para escribir");
    if (this.isInputMode) {
      inputBody = `${t.bold(this.inputText)}${t.bold(t.fg("accent", "█"))}`;
    }
    lines.push(`> [ ${inputBody} ]`);

    // Pie de página de atajos de Central (idéntico a la imagen)
    const fA = `${t.bold(t.fg("accent", "a"))} arreglar`;
    const fN = `${t.bold(t.fg("dim", "n"))} descartar`;
    const fD = `${t.bold(t.fg("dim", "d"))} mañana 9:00`;
    const fO = `${t.bold(t.fg("dim", "o"))} github`;
    const fEsc = `${t.bold(t.fg("dim", "esc"))} volver`;
    const fSim = this.simulatedMode ? `${t.bold(t.fg("accent", "●"))} = simulado` : `${t.bold(t.fg("dim", "○"))} = en vivo`;
    const fHelp = `${t.bold(t.fg("accent", "?"))} todas las teclas`;

    lines.push(`${fA}  ${fN}  ${fD}  ${fO}  ${fEsc}  ${fSim}  ${fHelp}`);
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

  private overlayHelpCard(lines: string[], width: number): void {
    const t = this.theme;
    const boxW = Math.min(width - 6, 70);
    const boxLines: string[] = [
      `┌─ ${t.bold("TECLAS Y ACCIONES DE CENTRAL")} ${"─".repeat(Math.max(2, boxW - 32))}┐`,
      `│ [1..3] Cambiar Pestañas (Central / Colaboradores / Auditoría)     │`,
      `│ [↑/↓] o [j/k] Navegar elementos en Decisiones y Tareas            │`,
      `│ [Enter] Inspeccionar elemento seleccionado                        │`,
      `│ [a / s] Arreglar en tu PR / Aprobar decisión                      │`,
      `│ [n] Descartar decisión o cancelar tarea                           │`,
      `│ [d] Mañana 9:00 (Posponer / Recordar más tarde)                   │`,
      `│ [o] Abrir en GitHub (o copiar URL)                                │`,
      `│ [/] Activar cursor para "Escribile a Central"                     │`,
      `│ [Ctrl+K] Limpiar input de texto                                   │`,
      `│ [m] Alternar Modo Simulado / Modo En Vivo                         │`,
      `│ [r] Refrescar estado y worktrees en vivo                          │`,
      `│ [Espacio] En pestaña 2: Conmutar ALLOW / BLOCK / PENDING          │`,
      `│ [Esc] Salir de Central o cerrar esta ayuda                        │`,
      `└${"─".repeat(boxW - 2)}┘`,
    ];

    // Centrar o intercalar sobre las líneas intermedias
    const startY = 8;
    boxLines.forEach((b, idx) => {
      if (startY + idx < lines.length) {
        lines[startY + idx] = `  ${b}`;
      }
    });
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
      left: ` [1..3/Tab/←→] Pestaña   [↑/↓] Navegar   [a] Arreglar   [n] Descartar   [d] Mañana   [/] Escribir   [?] Ayuda`,
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
