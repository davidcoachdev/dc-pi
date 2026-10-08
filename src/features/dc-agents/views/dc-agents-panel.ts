import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import {
  loadSubagentsData,
  type SubagentsData,
  type SubagentExecutionTask,
  type AvailableAgentInfo,
} from "../core/dc-agents-tasks.ts";
import { applyModalBg } from "../../dc-plan/core/dc-plan-types.ts";

export class DcAgentsPanel implements Component {
  private selectedIndex: number = 0;
  private data: SubagentsData;
  private activePanel: "list" | "detail" = "list";
  private listScrollY: number = 0;
  private detailScrollY: number = 0;
  private readonly theme: Theme;
  private readonly onDone: () => void;
  private readonly currentSessionId?: string;
  public invalidate: () => void = () => {};

  constructor(theme: Theme, onDone: () => void, ctx?: any) {
    this.theme = theme;
    this.onDone = onDone;
    this.currentSessionId = ctx?.sessionManager?.getSessionId?.();
    this.data = loadSubagentsData(this.currentSessionId);
  }

  public reloadData(): void {
    this.data = loadSubagentsData(this.currentSessionId);
    this.invalidate();
  }

  public handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
      this.onDone();
      return;
    }

    if (data === "r" || data === "R") {
      this.reloadData();
      return;
    }

    if (matchesKey(data, Key.tab)) {
      this.activePanel = this.activePanel === "list" ? "detail" : "list";
      this.invalidate();
      return;
    }

    const totalItems = this.data.executionTasks.length + this.data.availableAgents.length;

    if (this.activePanel === "list") {
      if (matchesKey(data, Key.up) || data === "k") {
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.detailScrollY = 0;
        this.ensureVisible();
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.down) || data === "j") {
        this.selectedIndex = Math.min(totalItems - 1, this.selectedIndex + 1);
        this.detailScrollY = 0;
        this.ensureVisible();
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.pageUp)) {
        this.selectedIndex = Math.max(0, this.selectedIndex - 8);
        this.detailScrollY = 0;
        this.ensureVisible();
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.pageDown)) {
        this.selectedIndex = Math.min(totalItems - 1, this.selectedIndex + 8);
        this.detailScrollY = 0;
        this.ensureVisible();
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.home)) {
        this.selectedIndex = 0;
        this.detailScrollY = 0;
        this.listScrollY = 0;
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.end)) {
        this.selectedIndex = Math.max(0, totalItems - 1);
        this.detailScrollY = 0;
        this.ensureVisible();
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.right) || matchesKey(data, Key.enter)) {
        this.activePanel = "detail";
        this.invalidate();
        return;
      }
    } else {
      if (matchesKey(data, Key.left)) {
        this.activePanel = "list";
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.up) || data === "k") {
        this.detailScrollY = Math.max(0, this.detailScrollY - 1);
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.down) || data === "j") {
        this.detailScrollY += 1;
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.pageUp)) {
        this.detailScrollY = Math.max(0, this.detailScrollY - 8);
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.pageDown)) {
        this.detailScrollY += 8;
        this.invalidate();
        return;
      }
      if (matchesKey(data, Key.home)) {
        this.detailScrollY = 0;
        this.invalidate();
        return;
      }
    }
  }

  private ensureVisible(): void {
    const visibleRows = 18;
    if (this.selectedIndex < this.listScrollY) {
      this.listScrollY = this.selectedIndex;
    } else if (this.selectedIndex >= this.listScrollY + visibleRows) {
      this.listScrollY = this.selectedIndex - visibleRows + 1;
    }
  }

  public handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") {
      const delta = (event as any).wheelDelta ?? ((event as any).button === 4 ? -1 : 1);
      if (this.activePanel === "list") {
        const totalItems = this.data.executionTasks.length + this.data.availableAgents.length;
        this.selectedIndex = Math.max(0, Math.min(totalItems - 1, this.selectedIndex + delta));
        this.detailScrollY = 0;
        this.ensureVisible();
      } else {
        this.detailScrollY = Math.max(0, this.detailScrollY + delta * 2);
      }
      this.invalidate();
      return { handled: true };
    }

    if (event.type === "click" && event.button === "left") {
      const splitX = 32;
      if (event.x < splitX) {
        this.activePanel = "list";
        const row = event.y - 2 + this.listScrollY;
        const totalItems = this.data.executionTasks.length + this.data.availableAgents.length;
        if (row >= 0 && row < totalItems) {
          this.selectedIndex = row;
          this.detailScrollY = 0;
        }
      } else {
        this.activePanel = "detail";
      }
      this.invalidate();
      return { handled: true };
    }

    return undefined;
  }

  public render(width: number): string[] {
    const bloodBright = (s: string) => `\x1b[38;2;255;51;51m${s}\x1b[0m`;
    const bloodSoft = (s: string) => `\x1b[38;2;255;128;128m${s}\x1b[0m`;
    const bloodWhite = (s: string) => `\x1b[38;2;255;204;204m${s}\x1b[0m`;
    const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
    const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

    const leftWidth = Math.min(36, Math.max(28, Math.floor(width * 0.36)));
    const rightWidth = Math.max(20, width - leftWidth - 1);
    const maxRows = 24;

    // --- Panel Izquierdo: Lista ---
    const leftLines: string[] = [];
    const listActiveBadge = this.activePanel === "list" ? bloodBright(" ●") : "";
    leftLines.push(bold(bloodBright(` EJECUCIONES & AGENTES${listActiveBadge}`)));
    leftLines.push(dim("─".repeat(leftWidth)));

    const execTasks = this.data.executionTasks;
    const availAgents = this.data.availableAgents;

    // Construir items planos con su tipo
    interface FlatItem {
      kind: "task" | "agent";
      task?: SubagentExecutionTask;
      agent?: AvailableAgentInfo;
      label: string;
      badge: string;
    }

    const flatItems: FlatItem[] = [];

    // 1. Tareas de ejecución
    for (const t of execTasks) {
      let badge = bloodWhite("[listo]");
      let glyph = bloodBright("✓");
      if (t.status === "running") {
        badge = bloodBright("[running]");
        glyph = bloodBright("◐");
      } else if (t.status === "failed") {
        badge = bloodBright("[falló]");
        glyph = bloodBright("✗");
      } else if (t.status === "stopped") {
        badge = dim("[cancel]");
        glyph = dim("⊘");
      }

      const shortLabel = t.label ? t.label : t.prompt.slice(0, 24);
      flatItems.push({
        kind: "task",
        task: t,
        label: `${glyph} ${t.agent} · ${shortLabel}`,
        badge,
      });
    }

    // 2. Subagentes disponibles
    for (const a of availAgents) {
      flatItems.push({
        kind: "agent",
        agent: a,
        label: `🤖 ${a.name}`,
        badge: bloodSoft(`[${a.role}]`),
      });
    }

    if (flatItems.length === 0) {
      leftLines.push(`  ${dim("Sin ejecuciones ni agentes")}`);
    } else {
      const visibleItems = flatItems.slice(this.listScrollY, this.listScrollY + maxRows - 2);
      visibleItems.forEach((item, index) => {
        const actualIndex = this.listScrollY + index;
        const isSelected = actualIndex === this.selectedIndex;
        const prefix = isSelected ? bloodBright("▸ ") : "  ";

        const textWidth = leftWidth - 12;
        const cleanLabel = item.label.replace(/\x1b\[[0-9;]*m/g, "");
        const truncated = cleanLabel.length > textWidth ? cleanLabel.slice(0, textWidth - 1) + "…" : cleanLabel;

        const rowStr = `${prefix}${isSelected ? bold(bloodWhite(truncated)) : dim(truncated)}`;
        const pad = Math.max(1, leftWidth - visibleWidth(rowStr) - visibleWidth(item.badge));
        const fullRow = `${rowStr}${" ".repeat(pad)}${item.badge}`;

        if (isSelected) {
          leftLines.push(`\x1b[48;2;45;15;20m${fullRow}\x1b[49m`);
        } else {
          leftLines.push(fullRow);
        }
      });
    }

    // --- Panel Derecho: Detalle ---
    const rightLines: string[] = [];
    const detailActiveBadge = this.activePanel === "detail" ? bloodBright(" ●") : "";

    const selectedItem = flatItems[this.selectedIndex];

    if (!selectedItem) {
      rightLines.push(bold(bloodBright(` DETALLE DE SUBAGENTE${detailActiveBadge}`)));
      rightLines.push(dim("─".repeat(rightWidth)));
      rightLines.push(`  ${dim("Selecciona un elemento de la lista para ver su información.")}`);
    } else if (selectedItem.kind === "task" && selectedItem.task) {
      const t = selectedItem.task;
      rightLines.push(bold(bloodBright(` EJECUCIÓN · ${t.agent.toUpperCase()}${detailActiveBadge}`)));
      rightLines.push(dim("─".repeat(rightWidth)));

      let statusBadge = bloodWhite("[completed]");
      if (t.status === "running") statusBadge = bloodBright(bold("[running]"));
      else if (t.status === "failed") statusBadge = bloodBright("[failed]");
      else if (t.status === "stopped") statusBadge = dim("[stopped]");

      const dateStr = new Date(t.createdAt).toLocaleTimeString();
      const durStr = t.durationMs !== undefined ? `${(t.durationMs / 1000).toFixed(1)}s` : "-";
      const modelStr = t.model ? t.model.split("/").pop() || t.model : "defecto";
      const tokensStr = t.tokens !== undefined ? `${(t.tokens / 1000).toFixed(1)}k` : "-";
      const costStr = t.cost !== undefined ? `$${t.cost.toFixed(4)}` : "-";

      rightLines.push(` ${bloodSoft("Estado:")}   ${statusBadge}     ${bloodSoft("ID:")} ${dim(t.id)}     ${bloodSoft("Hora:")} ${dim(dateStr)}`);
      rightLines.push(` ${bloodSoft("Modelo:")}   ${bloodWhite(modelStr)}     ${bloodSoft("Duración:")} ${bloodWhite(durStr)}     ${bloodSoft("Tokens:")} ${dim(tokensStr)}     ${bloodSoft("Costo:")} ${dim(costStr)}`);
      if (t.cwd) {
        rightLines.push(` ${bloodSoft("Directorio:")} ${dim(t.cwd)}`);
      }
      rightLines.push("");

      // Prompt
      rightLines.push(` ${bloodBright(bold("▸ Instrucción / Tarea Solicitada:"))}`);
      const promptLines = this.wrapText(t.prompt, rightWidth - 4);
      for (const pl of promptLines.slice(0, 10)) {
        rightLines.push(`   ${bloodWhite(pl)}`);
      }
      if (promptLines.length > 10) {
        rightLines.push(`   ${dim(`... (${promptLines.length - 10} líneas más)`)}`);
      }
      rightLines.push("");

      // Resultado o Error
      if (t.error) {
        rightLines.push(` ${bloodBright(bold("✗ Error Reportado:"))}`);
        const errLines = this.wrapText(t.error, rightWidth - 4);
        for (const el of errLines.slice(0, 8)) {
          rightLines.push(`   ${bloodBright(el)}`);
        }
        rightLines.push("");
      } else if (t.result) {
        rightLines.push(` ${bloodBright(bold("✔ Resultado Final:"))}`);
        const resLines = this.wrapText(t.result, rightWidth - 4);
        for (const rl of resLines.slice(0, 12)) {
          rightLines.push(`   ${bloodWhite(rl)}`);
        }
        if (resLines.length > 12) {
          rightLines.push(`   ${dim(`... (${resLines.length - 12} líneas más en log)`)}`);
        }
        rightLines.push("");
      }

      // Eventos / Hilo de mensajes
      if (t.threadItems && t.threadItems.length > 0) {
        rightLines.push(` ${bloodSoft(bold("⟡ Eventos del Hilo (Thread):"))}`);
        for (const item of t.threadItems.slice(0, 8)) {
          if (item.toolName) {
            rightLines.push(`   ${dim("•")} ${bloodSoft(`[tool: ${item.toolName}]`)}`);
          } else if (item.text) {
            const shortT = item.text.replace(/\n/g, " ").slice(0, rightWidth - 8);
            rightLines.push(`   ${dim("•")} ${dim(shortT)}`);
          }
        }
      }
    } else if (selectedItem.kind === "agent" && selectedItem.agent) {
      const a = selectedItem.agent;
      rightLines.push(bold(bloodBright(` SUBAGENTE · ${a.name.toUpperCase()}${detailActiveBadge}`)));
      rightLines.push(dim("─".repeat(rightWidth)));

      rightLines.push(` ${bloodSoft("Rol:")}        ${bloodBright(`[${a.role}]`)}`);
      rightLines.push(` ${bloodSoft("Modelo:")}     ${bloodWhite(a.model || "heredado del orquestador")}`);
      if (a.effort) {
        rightLines.push(` ${bloodSoft("Thinking:")}   ${bloodWhite(a.effort)}`);
      }
      rightLines.push(` ${bloodSoft("Ubicación:")}  ${dim(a.filePath)}`);
      rightLines.push("");

      rightLines.push(` ${bloodBright(bold("▸ Descripción y Directivas:"))}`);
      const descLines = this.wrapText(a.description, rightWidth - 4);
      for (const dl of descLines) {
        rightLines.push(`   ${bloodWhite(dl)}`);
      }
      rightLines.push("");
      rightLines.push(` ${dim("Invocación: El orquestador delega automáticamente tareas a este subagente")}`);
      if (a.filePath.includes("efímero")) {
        rightLines.push(` ${dim("de forma aislada bajo demanda mediante dc_ephemeral_agent_run.")}`);
      } else {
        rightLines.push(` ${dim("según las directivas de ODD, o explícitamente mediante subagent_run.")}`);
      }
    }

    // Scroll vertical del detalle si está activo
    const scrolledDetail = rightLines.slice(this.detailScrollY, this.detailScrollY + maxRows);

    // --- Combinar ambos paneles con separador │ ---
    const combined: string[] = [];
    const totalRows = Math.max(leftLines.length, scrolledDetail.length, maxRows);

    for (let i = 0; i < totalRows; i++) {
      const l = leftLines[i] ?? "";
      const r = scrolledDetail[i] ?? "";

      const lPad = Math.max(0, leftWidth - visibleWidth(l));
      const rPad = Math.max(0, rightWidth - visibleWidth(r));

      const sep = bloodSoft("│");
      const combinedLine = `${l}${" ".repeat(lPad)} ${sep} ${r}${" ".repeat(rPad)}`;
      combined.push(applyModalBg(truncateToWidth(combinedLine, width, "")));
    }

    return combined;
  }

  private wrapText(text: string, maxWidth: number): string[] {
    const lines: string[] = [];
    const paragraphs = text.split("\n");
    for (const p of paragraphs) {
      if (!p.trim()) {
        lines.push("");
        continue;
      }
      const words = p.split(/\s+/);
      let cur = "";
      for (const w of words) {
        if (!cur) {
          cur = w;
        } else if (visibleWidth(cur) + 1 + visibleWidth(w) <= maxWidth) {
          cur += " " + w;
        } else {
          lines.push(cur);
          cur = w;
        }
      }
      if (cur) lines.push(cur);
    }
    return lines;
  }
}
