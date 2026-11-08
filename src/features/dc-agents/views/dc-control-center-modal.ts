import * as fs from "node:fs";
import * as path from "node:path";
import type { Theme, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Key, matchesKey, decodeKittyPrintable, truncateToWidth, visibleWidth,
  type Component, type TuiMouseEvent, type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { openDcModal } from "../../../ui/dc-modal.ts";
import {
  getCollaboratorsDatabase,
} from "../daemon/dc-collaborators-db.ts";
import {
  dcIssueDispatcher,
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
  if (!fs.existsSync(specFile)) return [];

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
      if (inTasks) {
        const match = line.trim().match(/^(?:[✔✓▶✖○]\s*)?(T\d+):\s*(.*)/);
        if (match && match[1] && match[2]) {
          const isDone = line.includes("[done]") || line.includes("✔");
          const isInProgress = line.includes("[in_progress]") || line.includes("▶");
          const isFailed = line.includes("[failed]") || line.includes("✖");
          items.push({
            id: match[1],
            title: match[2].replace(/\[(?:done|in_progress|failed|pending)\]/g, "").trim(),
            status: isDone ? "done" : isInProgress ? "in_progress" : isFailed ? "failed" : "pending",
          });
        }
      }
    }

    if (items.length > 0) return items;
  } catch {
    /* fallback */
  }

  return [];
}

type CentralItem =
  | { kind: "decision"; data: CentralDecisionItem }
  | { kind: "task"; data: CentralTaskItem };

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export class DcControlCenterPanel implements Component {
  private activeTab: ControlCenterTab = "worktrees";
  private selectedIndex = 0;
  private scrollOffset = 0;
  private readonly collabDb = getCollaboratorsDatabase();

  // Estados interactivos para Central
  private simulatedMode = false;
  private isInputMode = false;
  private inputText = "";
  private inputQuestionId?: string;
  private optionQuestionId?: string;
  private selectedOption = 0;
  private isHelpMode = false;
  private lastActionMessage = "";
  private tabHitboxes: Array<{ start: number; end: number; tab: ControlCenterTab }> = [];
  private itemHitboxes = new Map<number, number>();
  private listWidth = 0;
  private inputRow = -1;

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
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.selectedOption = 0;
    this.optionQuestionId = undefined;
    this.isInputMode = false;
    this.inputText = "";
    this.inputQuestionId = undefined;
    this.lastActionMessage = "";
    this.requestRender?.();
  }

  private getAllItems(): CentralItem[] {
    if (this.simulatedMode) {
      return [
        ...this.defaultDecisions.map((data): CentralItem => ({ kind: "decision", data })),
        ...this.defaultTasks.map((data): CentralItem => ({ kind: "task", data })),
      ];
    }
    const items: CentralItem[] = [];

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

    if (this.activeTab === "worktrees") {
      this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, items.length - 1));
    }
    return items;
  }

  private currentQuestion(): AgentQuestionPacket | undefined {
    if (this.simulatedMode || this.activeTab !== "worktrees") return undefined;
    const item = this.getAllItems()[this.selectedIndex];
    const question = item?.kind === "decision" ? item.data.questionPacket : undefined;
    if (this.optionQuestionId !== question?.id) {
      this.optionQuestionId = question?.id;
      this.selectedOption = 0;
    }
    return question;
  }

  private startInput(): void {
    const question = this.currentQuestion();
    if (!this.simulatedMode && (!question || question.allowCustomText === false)) {
      this.lastActionMessage = "Texto no disponible: selecciona una pregunta que admita respuesta libre.";
    } else {
      this.isInputMode = true;
      this.inputQuestionId = question?.id;
      this.inputText = "";
    }
    this.requestRender?.();
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
          const last = graphemes.segment(this.inputText).containing(this.inputText.length - 1);
          this.inputText = this.inputText.slice(0, last?.index ?? 0);
          this.requestRender?.();
        }
        return true;
      }

      if (matchesKey(data, Key.enter) || data === "\r" || data === "\n") {
        const submitted = this.inputText.trim();
        if (submitted) {
          const question = dcRemoteQuestionManager.getPendingQuestions().find((q) => q.id === this.inputQuestionId);
          if (this.simulatedMode) {
            this.lastActionMessage = "Demostración: texto no enviado.";
          } else if (question && question.allowCustomText !== false) {
            dcRemoteQuestionManager.postAnswer({
              questionId: question.id,
              customText: submitted,
              answeredAt: Date.now(),
              source: "custom_text",
            });
            this.lastActionMessage = "✔ Respuesta enviada al subagente.";
          } else {
            this.lastActionMessage = "No enviado: la pregunta ya no está disponible.";
          }
        }
        this.isInputMode = false;
        this.inputText = "";
        this.requestRender?.();
        return true;
      }

      const printable = data.startsWith("\x1b[200~") && data.endsWith("\x1b[201~")
        ? data.slice(6, -6) : decodeKittyPrintable(data) ?? data;
      if (printable && !/[\x00-\x1f\x7f-\x9f]/u.test(printable)) {
        this.inputText += printable;
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
      this.setSimulatedMode(!this.simulatedMode);
      return true;
    }

    // Activar input de texto con '/'
    if (data === "/") {
      this.startInput();
      return true;
    }

    // Ctrl+K enfoca la respuesta a la pregunta seleccionada.
    if (data === "\x0b") {
      this.startInput();
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

    if (this.activeTab === "worktrees") {
      const question = this.currentQuestion();
      const options = question?.options ?? [];
      if (data === "[" || data === "]") {
        this.selectedOption = Math.max(0, Math.min(options.length - 1, this.selectedOption + (data === "]" ? 1 : -1)));
        this.requestRender?.();
        return true;
      }
      if (matchesKey(data, Key.enter) || data === "a" || data === "A" || data === "s" || data === "S" || data === "n" || data === "N") {
        const dismiss = data.toLowerCase() === "n";
        const chosen = options[this.selectedOption];
        if (this.simulatedMode) {
          this.lastActionMessage = "Demostración: ninguna acción ejecutada.";
        } else if (question && (dismiss || chosen !== undefined)) {
          dcRemoteQuestionManager.postAnswer({
            questionId: question.id,
            ...(dismiss ? {} : { chosenOption: chosen }),
            answeredAt: Date.now(),
            source: dismiss ? "dismissed" : "option",
          });
          this.lastActionMessage = dismiss ? "✔ Pregunta descartada." : "✔ Opción enviada al subagente.";
        } else {
          this.lastActionMessage = "Sin acción: selecciona una pregunta pendiente.";
        }
        this.requestRender?.();
        return true;
      }
      if (data.toLowerCase() === "d" || data.toLowerCase() === "o") {
        this.lastActionMessage = "No disponible: esta ventana no programa recordatorios ni abre GitHub.";
        this.requestRender?.();
        return true;
      }
    }

    // Toggle de colaboradores con la barra espaciadora en Pestaña 2
    if (!this.simulatedMode && this.activeTab === "collaborators" && matchesKey(data, Key.space)) {
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
    if (this.isHelpMode || this.isInputMode) return undefined;
    if (event.type === "click" && event.button === "left") {
      if (event.y === 2) {
        const tab = this.tabHitboxes.find((box) => event.x >= box.start && event.x < box.end);
        if (!tab) return undefined;
        this.activeTab = tab.tab;
        this.selectedIndex = 0;
        this.scrollOffset = 0;
      } else if (this.activeTab === "worktrees" && event.y === this.inputRow) {
        this.startInput();
      } else if (this.activeTab === "worktrees" && event.x < this.listWidth) {
        const index = this.itemHitboxes.get(event.y);
        if (index === undefined) return undefined;
        this.selectedIndex = index;
      } else if (this.activeTab === "collaborators") {
        const index = this.itemHitboxes.get(event.y);
        if (index === undefined) return undefined;
        this.selectedIndex = index;
        if (!this.simulatedMode) {
          const target = this.collabDb.listCollaborators()[index];
          if (target) this.collabDb.toggleCollaboratorStatus(target.login);
        }
      } else {
        return undefined;
      }
      this.requestRender?.();
      return { handled: true, render: true };
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
    const innerW = Math.max(1, Math.floor(width));
    this.itemHitboxes.clear();
    this.inputRow = -1;
    const allItems = this.getAllItems();
    const workingCount = allItems.filter((item) => item.kind === "task" && item.data.status === "in_progress").length;
    lines.push(`${t.bold(t.fg("accent", "central · dc-super-agente"))} · ${workingCount} trabajando`);

    // Pending decisions and explicit data source.
    const needsCount = allItems.filter((i) => i.kind === "decision").length;
    const needsLabel = needsCount > 0 ? `${needsCount} te necesitan` : "al día";
    const modeLabel = this.simulatedMode ? "MODO PRUEBA · sin efectos reales" : "EN VIVO · datos locales";

    const badgePart = `${t.bold(t.fg("accent", "▲ CENTRAL"))}  ${t.bold(needsLabel)}`;
    const modePart = `${t.bold(t.fg("accent", "●"))} ${t.fg("dim", modeLabel)}`;
    const syncPart = t.fg("dim", "GitHub: sincronización no consultada");

    const headerGap = Math.max(2, Math.floor((innerW - visibleWidth(badgePart) - visibleWidth(modePart) - visibleWidth(syncPart)) / 2));
    lines.push(`${badgePart}${" ".repeat(headerGap)}${modePart}${" ".repeat(headerGap)}${syncPart}`);

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

    const tabs: Array<[ControlCenterTab, string]> = innerW < 100
      ? [["worktrees", " [1] Central "], ["collaborators", " [2] Colaboradores "], ["audit", " [3] Audit Log "]]
      : [["worktrees", tab1], ["collaborators", tab2], ["audit", tab3]];
    let tabX = 0;
    this.tabHitboxes = tabs.map(([tab, label]) => {
      const box = { start: tabX, end: Math.min(innerW, tabX + visibleWidth(label)), tab };
      tabX += visibleWidth(label) + 3;
      return box;
    });
    lines.push(tabs.map(([tab, label]) => tab === this.activeTab ? t.bold(t.fg("accent", label)) : label).join(" │ "));
    lines.push(t.fg("border", "─".repeat(innerW)));

    // ── 3. Contenido según pestaña activa ──
    if (this.activeTab === "worktrees") {
      this.renderCentralTab(lines, innerW, allItems);
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

  private renderCentralTab(lines: string[], width: number, allItems: CentralItem[]): void {
    const t = this.theme;
    const decisions = allItems.filter((i) => i.kind === "decision");
    const tasks = allItems.filter((i) => i.kind === "task");
    const completedCount = this.simulatedMode ? this.defaultTasks.filter((task) => task.status === "done").length : undefined;

    const leftColW = width < 80 ? width : Math.min(36, Math.max(28, Math.floor(width * 0.32)));
    this.listWidth = leftColW;
    const rightColW = width < 80 ? width : Math.max(1, width - leftColW - 3);

    const leftLines: string[] = [];
    const rightLines: string[] = [];
    const rowItems = new Map<number, number>();
    let selectedRow = 0;

    // ── COLUMNA IZQUIERDA: 1 DECISIONES, 2 TAREAS, 3 HECHO HOY ──
    // Sección 1: DECISIONES
    const decHeader = t.bold(t.fg("accent", `1 DECISIONES · ${decisions.length}`));
    leftLines.push(decHeader);

    if (decisions.length === 0) {
      leftLines.push(`  ${t.fg("dim", "Sin decisiones pendientes")}`);
    } else {
      decisions.forEach((item, idx) => {
        const isSel = idx === this.selectedIndex;
        const d = item.data as CentralDecisionItem;
        if (isSel) selectedRow = leftLines.length;
        for (let r = 0; r < 3; r++) rowItems.set(leftLines.length + r, idx);
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
        if (isSel) selectedRow = leftLines.length;
        for (let r = 0; r < (task.scopeText ? 2 : 1); r++) rowItems.set(leftLines.length + r, globalIdx);
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
    leftLines.push(t.bold(t.fg("accent", `3 HECHO HOY · ${completedCount ?? "sin historial"}`)));
    leftLines.push(`  ${t.fg("dim", this.simulatedMode ? "Datos de demostración" : "Historial no disponible")}`);

    // ── COLUMNA DERECHA: INSPECCIÓN, RESUMEN, ACCIONES, COMENTARIOS Y BIENVENIDA ──
    const selected = allItems[this.selectedIndex];
    const current = selected?.data;

    if (selected?.kind === "decision") {
      const dec = selected.data;
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
      for (const [label, value] of [["Qué piden", dec.summaryCard.peticion], ["Quién", dec.summaryCard.quien], ["Sugerido", dec.summaryCard.sugerido]]) {
        const body = truncateToWidth(`${label!.padEnd(12)} ${value ?? ""}`, cardW - 4, "…");
        rightLines.push(`${t.fg("border", "│")} ${body}${" ".repeat(Math.max(0, cardW - 4 - visibleWidth(body)))} ${t.fg("border", "│")}`);
      }
      rightLines.push(t.fg("border", `└${"─".repeat(cardW - 2)}┘`));
      rightLines.push("");

      // Barra de Botones de Acción
      if (dec.questionPacket) {
        const question = this.currentQuestion();
        const options = question?.options ?? [];
        rightLines.push(t.bold("Opciones: [ / ] seleccionar · Enter enviar · n descartar"));
        const start = Math.max(0, this.selectedOption - 2);
        options.slice(start, start + 5).forEach((option, offset) => {
          const index = start + offset;
          rightLines.push(`${index === this.selectedOption ? "▶" : " "} ${index + 1}. ${option}`);
        });
      } else {
        rightLines.push(t.fg("dim", "Demostración: acciones deshabilitadas"));
        for (const comment of dec.comments) rightLines.push(`• ${comment.author}: ${comment.text}`);
      }
    } else if (selected?.kind === "task") {
      const task = selected.data;
      rightLines.push(`${t.bold(t.fg("dim", "Tareas » "))}${t.bold(t.fg("warning", task.title))}`);
      rightLines.push(t.fg("dim", `Rama: ${task.branchName ?? "no disponible"}  |  Worktree: ${task.worktreePath ?? "no disponible"}`));
      rightLines.push("");

      rightLines.push(t.bold("Hoja de Ruta ODD en Vivo:"));
      const roadmap = task.worktreePath ? parseOddTasksFromWorktree(task.worktreePath, task.taskSlug || "task") : [];
      if (roadmap.length === 0) rightLines.push(t.fg("dim", "Hoja de ruta no disponible; no se infiere progreso."));
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
      rightLines.push(t.fg("dim", "─".repeat(Math.max(0, rightColW - 2))));
      rightLines.push("Decisiones: selecciona una pregunta y responde una opción o texto.");
      rightLines.push("Tareas: inspecciona la rama, el worktree y el progreso ODD.");
      rightLines.push("m: demostración opcional · r: actualizar · ?: ayuda · Esc: salir");
    }

    // Keep the reference's guidance below the inspector, without duplicating the empty state.
    if (selected && rightLines.length < 18) {
      while (rightLines.length < 18) rightLines.push("");
      rightLines.push(t.bold("Bienvenido a Central"));
      rightLines.push("Decisiones: [ / ] elige opción · Enter envía · n descarta");
      rightLines.push("Tareas: inspección del worktree y hoja de ruta ODD");
      rightLines.push("Escribe a Central: / o Ctrl+K · m demostración · ? ayuda");
    }

    // Combinar en dos columnas visuales para el cuerpo de Central (filas 4..27)
    const maxRows = width < 80 ? 8 : 23;
    if (selectedRow < this.scrollOffset) this.scrollOffset = selectedRow;
    if (selectedRow >= this.scrollOffset + maxRows - 2) this.scrollOffset = selectedRow - maxRows + 3;
    this.scrollOffset = Math.min(this.scrollOffset, Math.max(0, leftLines.length - maxRows));
    for (let r = 0; r < maxRows; r++) {
      const sourceRow = r + this.scrollOffset;
      const index = rowItems.get(sourceRow);
      if (index !== undefined) this.itemHitboxes.set(lines.length, index);
      const leftPart = truncateToWidth(leftLines[sourceRow] ?? "", leftColW, "");
      const rightPart = truncateToWidth(rightLines[r] ?? "", rightColW, "…");
      const leftPadded = leftPart + " ".repeat(Math.max(0, leftColW - visibleWidth(leftPart)));
      lines.push(width < 80 ? leftPart : `${leftPadded} ${t.fg("border", "│")} ${rightPart}`);
    }
    if (width < 80) {
      for (let row = 0; row < 15; row++) lines.push(truncateToWidth(rightLines[row] ?? "", width, "…"));
    }

    // Fixed composer and status bar, independent of list length.
    lines.push(t.fg("border", "─".repeat(width)));

    if (this.lastActionMessage) lines.push(truncateToWidth(t.fg("accent", this.lastActionMessage), width, "…"));
    else lines.push(t.fg("dim", "Las acciones solo responden preguntas; no modifican PR ni tareas."));
    const selectedTitle = current?.title || "sin selección";
    const promptHeader = `Escribe a Central — sobre: ${t.bold(selectedTitle)}`;
    lines.push(promptHeader);

    let inputBody = t.fg("dim", "/ para escribir");
    if (this.isInputMode) {
      const segments = [...graphemes.segment(this.inputText)].map((segment) => segment.segment);
      while (segments.length && visibleWidth(segments.join("")) > width - 9) segments.shift();
      inputBody = `${t.bold(segments.join(""))}${t.bold(t.fg("accent", "█"))}`;
    }
    this.inputRow = lines.length;
    lines.push(`> [ ${inputBody} ]`);

    // Only advertise implemented actions.
    const fA = `${t.bold(t.fg("accent", "Enter/a/s"))} responder`;
    const fN = `${t.bold(t.fg("dim", "n"))} descartar pregunta`;
    const fD = `${t.bold(t.fg("dim", "[/]"))} opción`;
    const fO = `${t.bold(t.fg("dim", "r"))} actualizar`;
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

    if (this.selectedIndex < this.scrollOffset) this.scrollOffset = this.selectedIndex;
    if (this.selectedIndex >= this.scrollOffset + 23) this.scrollOffset = this.selectedIndex - 22;
    collabs.slice(this.scrollOffset, this.scrollOffset + 23).forEach((c, offset) => {
      const idx = this.scrollOffset + offset;
      this.itemHitboxes.set(lines.length, idx);
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
    lines.push(`  ${t.fg("dim", this.simulatedMode ? "Demostración: cambios de permisos deshabilitados." : "Presiona [Espacio] o haz Clic para alternar: ALLOW → BLOCK → PENDING")}`);
  }

  private renderAuditLogTab(lines: string[], width: number): void {
    const t = this.theme;
    const logs = this.collabDb.getRecentLogs(50);
    if (this.selectedIndex < this.scrollOffset) this.scrollOffset = this.selectedIndex;
    if (this.selectedIndex >= this.scrollOffset + 25) this.scrollOffset = this.selectedIndex - 24;

    lines.push(`  ${t.bold("Registro Forense de Eventos de Seguridad y Despacho:")}`);
    lines.push("");

    if (logs.length === 0) {
      lines.push(`  ${t.fg("dim", "Sin eventos de auditoría registrados.")}`);
      return;
    }

    for (const log of logs.slice(this.scrollOffset, this.scrollOffset + 25)) {
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
    const boxW = Math.max(2, Math.min(width - 6, 70));
    const boxLines: string[] = [
      `┌─ ${t.bold("TECLAS Y ACCIONES DE CENTRAL")} ${"─".repeat(Math.max(2, boxW - 32))}┐`,
      `│ [1..3] Cambiar Pestañas (Central / Colaboradores / Auditoría)     │`,
      `│ [↑/↓] o [j/k] Navegar elementos en Decisiones y Tareas            │`,
      `│ [Enter / a / s] Enviar la opción seleccionada de una pregunta     │`,
      `│ [ [ / ] ] Seleccionar opción anterior / siguiente                 │`,
      `│ [n] Descartar solo la pregunta seleccionada                       │`,
      `│ [d / o] No disponibles: sin recordatorios ni apertura de GitHub    │`,
      `│ [/] Responder con texto si la pregunta lo permite                 │`,
      `│ [Ctrl+K] Enfocar respuesta de texto                               │`,
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
      left: ` [1..3/Tab/←→] Pestaña   [↑/↓] Navegar   [Enter] Responder   [n] Descartar pregunta   [/] Texto   [m] Demo   [?] Ayuda`,
      right: `[Esc Salir] `,
    }),
    content: (done, theme, tui) => {
      return new DcControlCenterPanel(
        theme,
        () => done(undefined),
        () => tui.requestRender(),
      );
    },
  });
}
