import * as path from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  Markdown,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { DcSearchInput } from "../../../ui/dc-search-input.ts";
import { justifyRow } from "../../../ui/dc-row.ts";
import { dcClipboard } from "../../../integrations/dc-clipboard/dc-clipboard.ts";
import type {
  SentinelTurnRecord,
  SentinelSubagentLaunch,
  SentinelToolExecution,
  SentinelNote,
  SentinelProcedure,
  SentinelNoteType,
} from "../core/dc-sentinel-types.ts";
import { SENTINEL_TYPE_GLYPHS } from "../core/dc-sentinel-types.ts";
import {
  type SentinelRecorder,
  globalSentinelRecorder,
  listChronicleFiles,
  type ChronicleFileItem,
} from "../core/dc-sentinel-recorder.ts";
import { SentinelDatabase } from "../core/dc-sentinel-db.ts";
import { resolveMetroLine } from "../core/dc-sentinel-deterministic-extractor.ts";
import { getProjectObservations, type EngramObservation } from "../../dc-engram/dc-engram-db.ts";

export type SentinelViewMode = "metro" | "session" | "chronicle" | "procedures" | "engram";

/**
 * Crea un tema seguro para el componente Markdown de pi-tui
 * que soporta todos los tokens requeridos (underline, strike, code, quotes, headers).
 */
export function createSafeMarkdownTheme(theme?: Pick<Theme, "fg" | "bg" | "bold">): any {
  const fg = (color: string, s: string) => {
    try {
      if (theme && typeof theme.fg === "function") return theme.fg(color as any, s);
    } catch {}
    return s;
  };
  const bold = (s: string) => {
    try {
      if (theme && typeof theme.bold === "function") return theme.bold(s);
    } catch {}
    return `\x1b[1m${s}\x1b[22m`;
  };

  return {
    heading: (s: string) => fg("accent", bold(s)),
    bold: (s: string) => bold(s),
    italic: (s: string) => `\x1b[3m${s}\x1b[23m`,
    underline: (s: string) => `\x1b[4m${s}\x1b[24m`,
    strikethrough: (s: string) => `\x1b[9m${s}\x1b[29m`,
    code: (s: string) => fg("warning", s),
    codeBlock: (s: string) => fg("warning", s),
    codeBlockBorder: (s: string) => fg("dim", s),
    listBullet: (s: string) => fg("accent", s),
    quote: (s: string) => fg("dim", s),
    quoteBorder: (s: string) => fg("dim", s),
    hr: (s: string) => fg("border", s),
    link: (s: string) => fg("accent", `\x1b[4m${s}\x1b[24m`),
    linkUrl: (s: string) => fg("dim", s),
  };
}

/**
 * Formatea una observación de Engram estructurando sus bloques (What/Why/Where/Learned, etc.)
 * en Markdown limpio con viñetas e iconos semánticos antes de pasarlo al componente Markdown.
 */
export function formatEngramMarkdownLines(
  rawContent: string,
  width: number,
  theme?: Pick<Theme, "fg" | "bg" | "bold">,
): string[] {
  const mdTheme = createSafeMarkdownTheme(theme);
  const safeW = Math.max(20, width - 4);
  const raw = (rawContent || "(Sin contenido)").trim();

  // Normalizar secciones clásicas de Engram (What:, Why:, Where:, Learned:, etc.) para que tengan saltos de párrafo y badges claros
  const normalized = raw
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const m = trimmed.match(/^(?:\*\*)?(What|Why|Where|Learned|Goal|Instructions|Discoveries|Accomplished|Next Steps|Relevant Files)(?:\*\*)?:\s*(.*)$/i);
      if (m) {
        const key = m[1]!;
        const rest = m[2]!;
        const iconMap: Record<string, string> = {
          what: "🎯 **Qué (What):**",
          why: "💡 **Por qué (Why):**",
          where: "📁 **Dónde (Where):**",
          learned: "🧠 **Aprendido (Learned):**",
          goal: "🏁 **Objetivo (Goal):**",
          instructions: "📋 **Instrucciones:**",
          discoveries: "🔍 **Hallazgos:**",
          accomplished: "✅ **Logrado:**",
          "next steps": "⏭️ **Próximos Pasos:**",
          "relevant files": "📂 **Archivos Relevantes:**",
        };
        const label = iconMap[key.toLowerCase()] || `▸ **${key}:**`;
        return `\n${label} ${rest}\n`;
      }
      return line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const md = new Markdown(normalized, 0, 0, mdTheme);
  return md.render(safeW).map((l) => `   ${l}`);
}

export interface SentinelPanelOptions {
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  requestRender: () => void;
  recorder?: SentinelRecorder;
  projectRoot?: string;
  projectName?: string;
  maxRows?: number | (() => number);
  initialMode?: SentinelViewMode;
  db?: SentinelDatabase;
}

export class SentinelPanel implements Component {
  private theme: Pick<Theme, "fg" | "bg" | "bold">;
  private recorder: SentinelRecorder;
  private projectRoot: string;
  private projectName: string;
  private requestRender: () => void;
  private maxRowsOption?: number | (() => number);
  private db: SentinelDatabase;

  private mode: SentinelViewMode = "metro";
  private turns: SentinelTurnRecord[] = [];
  private chronicleFiles: ChronicleFileItem[] = [];
  private notes: SentinelNote[] = [];
  private procedures: SentinelProcedure[] = [];
  private engramObservations: EngramObservation[] = [];

  private selectedIndex = 0;
  private listScrollOffset = 0;
  private detailScrollOffset = 0;

  private searchInput: DcSearchInput;
  private lastLeftW = 36;
  private lastRowsCount = 14;
  private readonly headerRows = 2;

  constructor(options: SentinelPanelOptions) {
    this.theme = options.theme;
    this.requestRender = options.requestRender;
    this.recorder = options.recorder || globalSentinelRecorder;
    this.projectRoot = options.projectRoot || process.cwd();
    this.projectName = options.projectName || path.basename(this.projectRoot) || "default";
    this.maxRowsOption = options.maxRows;
    this.mode = options.initialMode || "session";
    this.db = options.db || new SentinelDatabase(this.projectName, this.projectRoot);

    this.searchInput = new DcSearchInput({
      placeholder: "Buscar (#tag, decisión, error, proc)...",
      width: 32,
      theme: {
        fg: (c, text) => this.theme.fg(c as any, text),
        bold: (text) => this.theme.bold(text),
      },
      showEscHint: true,
    });

    this.reload();
  }

  reload(): void {
    this.turns = [...this.recorder.getTurns()].reverse();
    this.chronicleFiles = listChronicleFiles(this.projectRoot);
    try {
      this.notes = this.db.listNotes({ project: this.projectName });
      this.procedures = this.db.listProcedures(this.projectName);
    } catch {
      this.notes = [];
      this.procedures = [];
    }
    try {
      this.engramObservations = getProjectObservations(50, this.projectName);
    } catch {
      this.engramObservations = [];
    }
  }

  invalidate(): void {
    this.reload();
  }

  getMode(): SentinelViewMode {
    return this.mode;
  }

  setMode(mode: SentinelViewMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.selectedIndex = 0;
    this.listScrollOffset = 0;
    this.detailScrollOffset = 0;
    this.requestRender();
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  setSelectedIndex(index: number): void {
    const listLen = this.getFilteredItems().length;
    if (listLen === 0) return;
    this.selectedIndex = Math.max(0, Math.min(listLen - 1, index));
    this.detailScrollOffset = 0;
    this.adjustListScroll();
    this.requestRender();
  }

  public getFilteredItems(): Array<{ id: string | number; label: string; raw: any }> {
    const query = this.searchInput.getQuery().trim().toLowerCase();

    if (this.mode === "metro") {
      return this.notes
        .filter((n) => {
          if (!query) return true;
          return (
            n.title.toLowerCase().includes(query) ||
            n.content.toLowerCase().includes(query) ||
            (n.topicKey && n.topicKey.toLowerCase().includes(query)) ||
            (n.concepts && n.concepts.some((c) => c.toLowerCase().includes(query))) ||
            n.type.toLowerCase().includes(query)
          );
        })
        .map((n) => ({ id: n.id ?? n.title, label: n.title, raw: n }));
    }

    if (this.mode === "session") {
      return this.turns
        .filter((t) => {
          if (!query) return true;
          return (
            t.userPrompt.toLowerCase().includes(query) ||
            t.turnId.toLowerCase().includes(query) ||
            t.subagentsLaunched.some(
              (s: SentinelSubagentLaunch) =>
                s.agent.toLowerCase().includes(query) || s.task.toLowerCase().includes(query),
            ) ||
            (t.recalledTitles && t.recalledTitles.some((r: string) => r.toLowerCase().includes(query))) ||
            t.errorsDetected.some((e: string) => e.toLowerCase().includes(query))
          );
        })
        .map((t) => ({ id: t.turnId, label: t.userPrompt, raw: t }));
    }

    if (this.mode === "procedures") {
      return this.procedures
        .filter((p) => {
          if (!query) return true;
          return (
            p.title.toLowerCase().includes(query) ||
            p.name.toLowerCase().includes(query) ||
            p.symptoms.toLowerCase().includes(query) ||
            p.steps.some((st) => st.toLowerCase().includes(query))
          );
        })
        .map((p) => ({ id: p.id ?? p.name, label: p.title, raw: p }));
    }

    if (this.mode === "engram") {
      return this.engramObservations
        .filter((obs) => {
          if (!query) return true;
          return (
            obs.title.toLowerCase().includes(query) ||
            obs.content.toLowerCase().includes(query) ||
            obs.type.toLowerCase().includes(query) ||
            (obs.scope && obs.scope.toLowerCase().includes(query))
          );
        })
        .map((obs) => ({ id: obs.id, label: obs.title, raw: obs }));
    }

    return this.chronicleFiles
      .filter((f) => {
        if (!query) return true;
        return f.name.toLowerCase().includes(query) || f.content.toLowerCase().includes(query);
      })
      .map((f) => ({ id: f.name, label: f.name, raw: f }));
  }

  public getMaxRows(): number {
    if (typeof this.maxRowsOption === "function") {
      return Math.max(12, this.maxRowsOption());
    }
    if (typeof this.maxRowsOption === "number") {
      return Math.max(12, this.maxRowsOption);
    }
    // Alto fijo constante de 34 filas totales (32 de cuerpo + 2 de cabecera)
    return 34;
  }

  private adjustListScroll(): void {
    const rowsBudget = this.lastRowsCount;
    if (this.selectedIndex < this.listScrollOffset) {
      this.listScrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.listScrollOffset + rowsBudget) {
      this.listScrollOffset = this.selectedIndex - rowsBudget + 1;
    }
  }

  /**
   * Encuentra otras notas conectadas por archivos tocados o conceptos compartidos (Estaciones de Transbordo).
   */
  public getTransferStations(currentNote: SentinelNote): SentinelNote[] {
    const curFiles = new Set(currentNote.filesAffected || []);
    const curConcepts = new Set(currentNote.concepts || []);
    const curLine = resolveMetroLine(currentNote).code;

    return this.notes.filter((other) => {
      if (other.id === currentNote.id && other.title === currentNote.title) return false;
      const sharedFile = (other.filesAffected || []).some((f) => curFiles.has(f));
      if (sharedFile) return true;
      const otherLine = resolveMetroLine(other).code;
      const sharedConcept = otherLine !== curLine && (other.concepts || []).some((c) => curConcepts.has(c));
      return sharedConcept;
    });
  }

  copyCurrentDetail(): void {
    const items = this.getFilteredItems();
    if (items.length === 0) return;
    const current = items[this.selectedIndex];
    if (!current) return;

    if (this.mode === "metro") {
      const note = current.raw as SentinelNote;
      const text = `# ${note.glyph} [${note.type.toUpperCase()}] ${note.title}\n\n${note.content}\n\nTopic: ${note.topicKey || "none"}`;
      void dcClipboard.copy(text);
      return;
    }

    if (this.mode === "session") {
      const turn = current.raw as SentinelTurnRecord;
      void dcClipboard.copy(this.recorder.formatTurnMarkdown(turn));
      return;
    }

    if (this.mode === "procedures") {
      const p = current.raw as SentinelProcedure;
      const text = `# ⚒ Procedimiento: ${p.title}\n\nSíntomas: ${p.symptoms}\n\nPasos:\n${p.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
      void dcClipboard.copy(text);
      return;
    }

    if (this.mode === "engram") {
      const obs = current.raw as EngramObservation;
      const text = `# [${obs.type.toUpperCase()}] ${obs.title}\n\n${obs.content}`;
      void dcClipboard.copy(text);
      return;
    }

    const file = current.raw as ChronicleFileItem;
    void dcClipboard.copy(file.content);
  }

  render(width: number): string[] {
    const t = this.theme;
    const safeW = Math.max(50, width);

    // 1/3 (38%) izquierda para índice, 2/3 (62%) derecha para detalle
    const leftW = Math.max(32, Math.min(52, Math.floor(safeW * 0.40)));
    this.lastLeftW = leftW;
    const rightW = Math.max(20, safeW - leftW - 3);

    const pad = (str: string, len: number) => {
      const v = visibleWidth(str);
      return v >= len ? truncateToWidth(str, len, "") : str + " ".repeat(len - v);
    };

    const filtered = this.getFilteredItems();

    if (this.selectedIndex >= filtered.length) {
      this.selectedIndex = Math.max(0, filtered.length - 1);
    }

    // Cabecera Fila 0: Tabs compactos dinámicos
    const sessionTab =
      this.mode === "session"
        ? t.bold(t.fg("accent", `[1] Sesión Activa`))
        : t.fg("dim", `[1]`);

    const chronicleTab =
      this.mode === "chronicle"
        ? t.bold(t.fg("accent", `[2] Disco`))
        : t.fg("dim", `[2]`);

    const metroTab =
      this.mode === "metro"
        ? t.bold(t.fg("accent", `[3] Metro`))
        : t.fg("dim", `[3]`);

    const procTab =
      this.mode === "procedures"
        ? t.bold(t.fg("accent", `[4] Recetas`))
        : t.fg("dim", `[4]`);

    const engramTab =
      this.mode === "engram"
        ? t.bold(t.fg("accent", `[5] Engram`))
        : t.fg("dim", `[5]`);

    const headerLeft = ` ⛩️ ${sessionTab} ${chronicleTab} ${metroTab} ${procTab} ${engramTab}`;

    const titleText =
      this.mode === "metro"
        ? ` 🚇 ${t.bold(t.fg("accent", "Líneas de Conocimiento & Transbordos"))}`
        : this.mode === "session"
          ? ` 📜 ${t.bold(t.fg("accent", "Registro de Vuelo (Turno)"))}`
          : this.mode === "procedures"
            ? ` ⚒️ ${t.bold(t.fg("accent", "Runbooks Ejecutables (Auto-Skills)"))}`
            : this.mode === "engram"
              ? ` 🧠 ${t.bold(t.fg("accent", "Espejo Aislado Engram"))}`
              : ` 📁 ${t.bold(t.fg("accent", "Bitácora Markdown"))}`;

    const searchWidth = Math.min(36, Math.max(16, rightW - visibleWidth(" 🚇 Líneas") - 4));
    const searchRender = this.searchInput.render(searchWidth);
    const headerRight = justifyRow(titleText, searchRender + " ", rightW);

    const lines: string[] = [];
    lines.push(`${pad(headerLeft, leftW)} ${t.fg("border", "│")} ${pad(headerRight, rightW)}`);
    lines.push(`${t.fg("border", "─".repeat(leftW))}─┼─${t.fg("border", "─".repeat(rightW))}`);

    const availableRows = Math.max(10, this.getMaxRows() - this.headerRows);
    this.lastRowsCount = availableRows;

    // Si no hay datos en general o tras el filtro: mantener SIEMPRE el mismo alto fijo (availableRows)
    if (filtered.length === 0) {
      const emptyMsg = `  ${t.fg("dim", "(sin registros que coincidan)")}`;
      const emptyDetail = `  ${t.fg("dim", "Probá con otro término o presioná Esc para limpiar el filtro.")}`;

      lines.push(`${pad(emptyMsg, leftW)} ${t.fg("border", "│")} ${pad(emptyDetail, rightW)}`);
      for (let i = 1; i < availableRows; i++) {
        lines.push(`${" ".repeat(leftW)} ${t.fg("border", "│")} ${" ".repeat(rightW)}`);
      }
      return lines.map((l) => truncateToWidth(l, safeW, ""));
    }

    this.adjustListScroll();

    // 1. Preparar detalle derecho
    const current = filtered[this.selectedIndex] || filtered[0]!;
    const rightContent: string[] = [];
    const mdTheme = createSafeMarkdownTheme(t);

    if (this.mode === "metro") {
      const note = current.raw as SentinelNote;
      const metroLine = resolveMetroLine(note);
      const pinnedBadge = note.pinned ? ` ${t.fg("warning", "📌 FIJADA")}` : "";
      const scopeBadge = note.scope === "global" ? ` ${t.fg("success", "🌐 GLOBAL")}` : "";

      rightContent.push(
        ` ${metroLine.icon} ${t.bold(t.fg("accent", `[${metroLine.code} ${metroLine.name}]`))}  ${t.fg("dim", "·")}  ${note.glyph} ${t.bold(t.fg("text", note.title))}${pinnedBadge}${scopeBadge}`,
      );
      rightContent.push(
        ` 📅 ${t.fg("dim", note.createdAt?.slice(0, 16) || "reciente")}  ${t.fg("dim", "·")}  🔄 Evoluciones: ${note.revisionCount ?? 1}  ${t.fg("dim", "·")}  👥 Refuerzo: ${note.duplicateCount ?? 1}x`,
      );
      rightContent.push(t.fg("border", "─".repeat(Math.max(1, rightW - 2))));
      rightContent.push("");

      // Memory Chips activos
      rightContent.push(` 🧠 ${t.bold(t.fg("text", "Memory Chips & Señales:"))}`);
      const chips = [
        `[${metroLine.code}]`,
        `[${note.glyph} ${note.type}]`,
        note.topicKey ? `[topic: ${note.topicKey}]` : null,
        note.proofCount && note.proofCount > 1 ? `[pruebas: ${note.proofCount}]` : null,
        note.concepts?.map((c) => `[${c}]`).join(" "),
      ]
        .filter(Boolean)
        .join(" ");
      rightContent.push(`   ${t.fg("accent", chips)}`);
      rightContent.push("");

      // Contenido atómico
      rightContent.push(` 📌 ${t.bold(t.fg("text", "Hecho Atómico Autocontenido:"))}`);
      const contentMd = new Markdown(note.content, 0, 0, mdTheme).render(Math.max(20, rightW - 4));
      for (const cl of contentMd) {
        rightContent.push(`   ${cl}`);
      }
      rightContent.push("");

      // Blast Radius si existe
      if (note.blastRadius) {
        rightContent.push(
          ` 💥 ${t.bold(t.fg("warning", `Blast Radius AST (${note.blastRadius.risk.toUpperCase()}):`))}`,
        );
        rightContent.push(
          `   • Archivos: ${note.blastRadius.filesCount}  ·  Llamadas: ${note.blastRadius.callCount}`,
        );
        if (note.blastRadius.summary) {
          rightContent.push(`   • ${note.blastRadius.summary}`);
        }
        rightContent.push("");
      }

      // Archivos tocados
      if (note.filesAffected && note.filesAffected.length > 0) {
        rightContent.push(` 📁 ${t.bold(t.fg("dim", "Superficies Afectadas:"))}`);
        for (const f of note.filesAffected) {
          rightContent.push(`    - \`${f}\``);
        }
        rightContent.push("");
      }

      // Estaciones de Transbordo (notas conectadas por archivos o topicKey)
      const transfers = this.getTransferStations(note);
      if (transfers.length > 0) {
        rightContent.push(` 🔀 ${t.bold(t.fg("accent", "Estaciones de Transbordo (Enter para saltar):"))}`);
        for (const tr of transfers.slice(0, 3)) {
          const trLine = resolveMetroLine(tr);
          rightContent.push(`    • ${trLine.icon} [${trLine.code}] ${tr.glyph} ${tr.title}`);
        }
        rightContent.push("");
      }

      // Atajos de acción
      rightContent.push(
        t.fg(
          "dim",
          " [Enter] Transbordo  ·  [d] Olvidar  ·  [p] Fijar  ·  [g] Global  ·  [c] Copiar",
        ),
      );
    } else if (this.mode === "procedures") {
      const proc = current.raw as SentinelProcedure;
      rightContent.push(` ⚒️ ${t.bold(t.fg("accent", proc.title))}  ${t.fg("dim", `[${proc.name}]`)}`);
      rightContent.push(
        ` 🎯 Patrón: \`${proc.triggerPattern}\`  ·  Éxito: ${(proc.successRate ? proc.successRate * 100 : 100).toFixed(0)}%`,
      );
      rightContent.push(t.fg("border", "─".repeat(Math.max(1, rightW - 2))));
      rightContent.push("");

      if (proc.symptoms) {
        rightContent.push(` ⚠️ ${t.bold(t.fg("warning", "Síntomas y Error:"))}`);
        rightContent.push(`   ${proc.symptoms}`);
        rightContent.push("");
      }

      rightContent.push(` 📋 ${t.bold(t.fg("text", "Pasos de Ejecución Deterministas:"))}`);
      proc.steps.forEach((step, idx) => {
        rightContent.push(`   ${idx + 1}. ${step}`);
      });
      rightContent.push("");

      if (proc.verificationCmd) {
        rightContent.push(` 🧪 ${t.bold(t.fg("success", "Comando de Verificación:"))}`);
        rightContent.push(`   \`${proc.verificationCmd}\``);
      }
    } else if (this.mode === "session") {
      const turn = current.raw as SentinelTurnRecord;
      rightContent.push(
        ` 📌 ${t.bold(t.fg("accent", turn.turnId))}  ${t.fg("dim", "·")}  📅 ${t.fg("dim", turn.timestamp.slice(11, 19))}`,
      );
      rightContent.push(t.fg("border", "─".repeat(Math.max(1, rightW - 2))));

      rightContent.push(` 💬 ${t.bold(t.fg("text", "Prompt:"))}`);
      const promptMd = new Markdown(turn.userPrompt, 0, 0, mdTheme).render(Math.max(20, rightW - 4));
      for (const pl of promptMd) {
        rightContent.push(`   ${pl}`);
      }
      rightContent.push("");

      if (turn.recallInjected && turn.recalledTitles && turn.recalledTitles.length > 0) {
        rightContent.push(` 🧠 ${t.bold(t.fg("accent", "Pre-Flight Recall Activo:"))}`);
        for (const r of turn.recalledTitles) {
          rightContent.push(`    • ${t.fg("accent", r)}`);
        }
        rightContent.push("");
      }

      if (turn.subagentsLaunched.length > 0) {
        rightContent.push(` 🤖 ${t.bold(t.fg("accent", "Subagentes Delegados:"))}`);
        for (const s of turn.subagentsLaunched) {
          const duration = s.endedAt ? `${((s.endedAt - s.startedAt) / 1000).toFixed(1)}s` : "activo";
          const status = s.isError ? t.fg("error", "❌ FALLÓ") : t.fg("success", "✅ OK");
          rightContent.push(`    • ${t.bold(s.agent)} (${s.mode || "task"} · ${duration}): ${status}`);
        }
        rightContent.push("");
      }

      if (turn.toolsExecuted.length > 0) {
        const nonSubagents = turn.toolsExecuted.filter((te: SentinelToolExecution) => te.toolName !== "subagent_run");
        if (nonSubagents.length > 0) {
          rightContent.push(` 🛠️ ${t.bold(t.fg("text", "Herramientas Ejecutadas:"))}`);
          for (const te of nonSubagents) {
            const status = te.isError ? t.fg("error", "[ERROR]") : t.fg("success", "[OK]");
            rightContent.push(`    • ${status} ${t.bold(te.toolName)}`);
          }
          rightContent.push("");
        }
      }

      if (turn.errorsDetected.length > 0) {
        rightContent.push(` ⚠️ ${t.bold(t.fg("error", "Errores / Alertas:"))}`);
        for (const err of turn.errorsDetected) {
          rightContent.push(`    • ${t.fg("error", err)}`);
        }
        rightContent.push("");
      }

      if (turn.assistantSummary) {
        rightContent.push(` 🤖 ${t.bold(t.fg("text", "Resumen Asistente:"))}`);
        const summaryMd = new Markdown(turn.assistantSummary, 0, 0, mdTheme).render(Math.max(20, rightW - 4));
        for (const sl of summaryMd) {
          rightContent.push(`   ${sl}`);
        }
      }
    } else if (this.mode === "engram") {
      const obs = current.raw as EngramObservation;
      rightContent.push(
        ` 🧠 ${t.bold(t.fg("accent", obs.title))}  ${t.fg("dim", `[${obs.type.toUpperCase()}]`)}`,
      );
      rightContent.push(
        ` 📅 ${t.fg("dim", obs.created_at?.slice(0, 16) || "reciente")}  ${t.fg("dim", "·")}  🎯 Scope: ${obs.scope || "project"}`,
      );
      rightContent.push(t.fg("border", "─".repeat(Math.max(1, rightW - 2))));
      rightContent.push("");

      const formattedLines = formatEngramMarkdownLines(obs.content, rightW, t);
      for (const line of formattedLines) {
        rightContent.push(line);
      }
    } else {
      const file = current.raw as ChronicleFileItem;
      rightContent.push(
        ` 📄 ${t.bold(t.fg("accent", file.name))}  ${t.fg("dim", "·")}  💾 ${(file.sizeBytes / 1024).toFixed(1)} KB  ${t.fg("dim", "·")}  📅 ${file.updatedAt}`,
      );
      rightContent.push(t.fg("border", "─".repeat(Math.max(1, rightW - 2))));
      rightContent.push("");

      const md = new Markdown(file.content, 0, 0, mdTheme);
      const renderedLines = md.render(Math.max(20, rightW - 2));
      for (const line of renderedLines) {
        rightContent.push(` ${line}`);
      }
    }

    // Scroll vertical del detalle derecho
    const maxDetailScroll = Math.max(0, rightContent.length - availableRows);
    if (this.detailScrollOffset > maxDetailScroll) {
      this.detailScrollOffset = maxDetailScroll;
    }
    const visibleDetail = rightContent.slice(this.detailScrollOffset, this.detailScrollOffset + availableRows);

    // 2. Renderizar filas izquierda y derecha
    const maxListScroll = Math.max(0, filtered.length - availableRows);
    if (this.listScrollOffset > maxListScroll) {
      this.listScrollOffset = maxListScroll;
    }

    for (let r = 0; r < availableRows; r++) {
      const itemIdx = this.listScrollOffset + r;
      let leftRow = " ".repeat(leftW);

      if (itemIdx < filtered.length) {
        const item = filtered[itemIdx]!;
        const isSelected = itemIdx === this.selectedIndex;

        let rowText = "";
        if (this.mode === "metro") {
          const note = item.raw as SentinelNote;
          const mLine = resolveMetroLine(note);
          const pinGlyph = note.pinned ? "📌" : "";
          rowText = ` ${mLine.icon}[${mLine.code}] ${pinGlyph}${note.glyph} ${note.title}`;
        } else if (this.mode === "procedures") {
          const p = item.raw as SentinelProcedure;
          rowText = ` ⚒️ ${p.title}`;
        } else if (this.mode === "engram") {
          const obs = item.raw as EngramObservation;
          rowText = ` 🧠 [${obs.type}] ${obs.title}`;
        } else if (this.mode === "session") {
          const turn = item.raw as SentinelTurnRecord;
          const time = turn.timestamp.slice(11, 16);
          const pClean = turn.userPrompt.replace(/\s+/g, " ");

          let badges = "";
          if (turn.subagentsLaunched.length > 0) badges += "🤖";
          if (turn.errorsDetected.length > 0) badges += "⚠️";
          if (turn.recallInjected) badges += "🧠";

          rowText = ` ⏱ [${time}] ${badges ? `${badges} ` : ""}${pClean}`;
        } else {
          const file = item.raw as ChronicleFileItem;
          rowText = ` 📄 ${file.name.replace(".md", "")}`;
        }

        // Sin barra de scroll visual (scroll limpio invisible ocupando todo el ancho de la columna)
        const contentW = leftW - 1;
        const truncated = truncateToWidth(rowText, contentW, "…");
        const fullLeft = pad(` ${truncated}`, leftW);
        leftRow = isSelected
          ? t.bg("selectedBg", t.bold(t.fg("accent", fullLeft)))
          : t.fg("text", fullLeft);
      }

      const rightRow =
        visibleDetail[r] !== undefined ? pad(visibleDetail[r]!, rightW) : " ".repeat(rightW);

      lines.push(`${leftRow} ${t.fg("border", "│")} ${rightRow}`);
    }

    return lines.map((l) => truncateToWidth(l, safeW, ""));
  }

  handleInput(data: string): boolean {
    const filtered = this.getFilteredItems();

    // Tab: Alternar modos principales
    if (matchesKey(data, Key.tab)) {
      if (this.mode === "session") {
        this.setMode("chronicle");
      } else if (this.mode === "chronicle") {
        this.setMode("session");
      } else if (this.mode === "metro") {
        this.setMode("procedures");
      } else {
        this.setMode("metro");
      }
      return true;
    }

    // Teclas 1 a 4 para cambiar de pestaña directamente
    if (this.searchInput.isEmpty()) {
      if (data === "1") {
        this.setMode("session");
        return true;
      }
      if (data === "2") {
        this.setMode("chronicle");
        return true;
      }
      if (data === "3") {
        this.setMode("metro");
        return true;
      }
      if (data === "4") {
        this.setMode("procedures");
        return true;
      }
      if (data === "5") {
        this.setMode("engram");
        return true;
      }

      // Enter en modo Metro: saltar a la primera Estación de Transbordo conectada
      if (this.mode === "metro" && matchesKey(data, Key.enter)) {
        const current = filtered[this.selectedIndex];
        if (current && current.raw) {
          const transfers = this.getTransferStations(current.raw as SentinelNote);
          if (transfers.length > 0) {
            const target = transfers[0]!;
            const nextIdx = filtered.findIndex(
              (it) => (it.raw as SentinelNote).id === target.id && (it.raw as SentinelNote).title === target.title,
            );
            if (nextIdx >= 0) {
              this.selectedIndex = nextIdx;
              this.detailScrollOffset = 0;
              this.adjustListScroll();
              this.requestRender();
              return true;
            }
          }
        }
      }

      // Tecla 'd' para olvidar/descartar la nota actual (OpenHuman Pattern)
      if (this.mode === "metro" && (data === "d" || data === "D")) {
        const current = filtered[this.selectedIndex];
        if (current && current.raw?.id) {
          this.db.softDeleteNote(current.raw.id);
          this.reload();
          this.requestRender();
          return true;
        }
      }

      // Tecla 'p' para fijar/desfijar nota (Pin)
      if (this.mode === "metro" && (data === "p" || data === "P")) {
        const current = filtered[this.selectedIndex];
        if (current && current.raw?.id) {
          const note = current.raw as SentinelNote;
          this.db.pinNote(note.id!, !note.pinned);
          this.reload();
          this.requestRender();
          return true;
        }
      }

      // Tecla 'g' para graduar nota a Global (Hub Tecnológico)
      if (this.mode === "metro" && (data === "g" || data === "G")) {
        const current = filtered[this.selectedIndex];
        if (current && current.raw?.id) {
          const note = current.raw as SentinelNote;
          this.db.saveNote({ ...note, scope: "global" });
          this.reload();
          this.requestRender();
          return true;
        }
      }

      // Tecla 'c' para copiar
      if (data === "c" || data === "C") {
        this.copyCurrentDetail();
        return true;
      }

      // Tecla 'r' para refrescar
      if (data === "r" || data === "R") {
        this.reload();
        this.requestRender();
        return true;
      }
    }

    // Navegación con flechas
    if (matchesKey(data, Key.up)) {
      if (this.selectedIndex > 0) {
        this.selectedIndex--;
        this.detailScrollOffset = 0;
        this.adjustListScroll();
        this.requestRender();
      }
      return true;
    }
    if (matchesKey(data, Key.down)) {
      if (this.selectedIndex < filtered.length - 1) {
        this.selectedIndex++;
        this.detailScrollOffset = 0;
        this.adjustListScroll();
        this.requestRender();
      }
      return true;
    }

    // PageUp / PageDown
    if (matchesKey(data, Key.pageUp)) {
      if (filtered.length > 0) {
        this.selectedIndex = Math.max(0, this.selectedIndex - 8);
        this.detailScrollOffset = 0;
        this.adjustListScroll();
        this.requestRender();
      }
      return true;
    }
    if (matchesKey(data, Key.pageDown)) {
      if (filtered.length > 0) {
        this.selectedIndex = Math.min(filtered.length - 1, this.selectedIndex + 8);
        this.detailScrollOffset = 0;
        this.adjustListScroll();
        this.requestRender();
      }
      return true;
    }

    // Home / End
    if (matchesKey(data, Key.home) || data === "\x1b[H") {
      if (filtered.length > 0) {
        this.selectedIndex = 0;
        this.listScrollOffset = 0;
        this.detailScrollOffset = 0;
        this.requestRender();
      }
      return true;
    }
    if (matchesKey(data, Key.end) || data === "\x1b[F") {
      if (filtered.length > 0) {
        this.selectedIndex = filtered.length - 1;
        this.adjustListScroll();
        this.detailScrollOffset = 0;
        this.requestRender();
      }
      return true;
    }

    // Ctrl+Up / Ctrl+Down o j / k o [ / ] para scroll de detalle sin límite artificial
    const isScrollDown =
      matchesKey(data, "ctrl+down") ||
      matchesKey(data, Key.ctrl("down")) ||
      data === "\x1b[1;5B" ||
      (this.searchInput.isEmpty() && (data === "j" || data === "]"));

    const isScrollUp =
      matchesKey(data, "ctrl+up") ||
      matchesKey(data, Key.ctrl("up")) ||
      data === "\x1b[1;5A" ||
      (this.searchInput.isEmpty() && (data === "k" || data === "["));

    if (isScrollDown) {
      this.detailScrollOffset += 4;
      this.requestRender();
      return true;
    }

    if (isScrollUp) {
      if (this.detailScrollOffset > 0) {
        this.detailScrollOffset = Math.max(0, this.detailScrollOffset - 4);
        this.requestRender();
      }
      return true;
    }

    // Escape: limpiar búsqueda
    if (matchesKey(data, Key.escape)) {
      if (!this.searchInput.isEmpty()) {
        this.searchInput.clear();
        this.selectedIndex = 0;
        this.listScrollOffset = 0;
        this.detailScrollOffset = 0;
        this.requestRender();
        return true;
      }
      return false;
    }

    // Backspace
    if (matchesKey(data, Key.backspace)) {
      if (this.searchInput.backspace()) {
        this.selectedIndex = 0;
        this.listScrollOffset = 0;
        this.detailScrollOffset = 0;
        this.requestRender();
        return true;
      }
      return true;
    }

    // Caracteres para búsqueda
    if (data.length === 1 && data >= " " && data <= "~") {
      this.searchInput.append(data);
      this.selectedIndex = 0;
      this.listScrollOffset = 0;
      this.detailScrollOffset = 0;
      this.requestRender();
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const filtered = this.getFilteredItems();

    if (event.type === "wheel") {
      const delta = (event as any).wheelDelta ?? ((event as any).deltaY > 0 ? 1 : -1);
      if (event.x !== undefined && event.x < this.lastLeftW && filtered.length > 0) {
        const next = Math.max(0, Math.min(filtered.length - 1, this.selectedIndex + (delta > 0 ? 1 : -1)));
        if (next !== this.selectedIndex) {
          this.selectedIndex = next;
          this.detailScrollOffset = 0;
          this.adjustListScroll();
          this.requestRender();
          return { handled: true };
        }
      } else {
        this.detailScrollOffset = Math.max(0, this.detailScrollOffset + (delta > 0 ? 3 : -3));
        this.requestRender();
        return { handled: true };
      }
      return undefined;
    }

    if (event.button !== "left" || (event.type !== "press" && event.type !== "click")) {
      return undefined;
    }

    // Clic en la cabecera (y === 0) para alternar tab
    if (event.y === 0 && event.x !== undefined && event.x < this.lastLeftW) {
      this.setMode(this.mode === "session" ? "chronicle" : "session");
      return { handled: true };
    }

    if (event.x !== undefined && event.x < this.lastLeftW && event.y !== undefined && event.y >= this.headerRows) {
      const clickedRow = event.y - this.headerRows;
      const targetIndex = this.listScrollOffset + clickedRow;
      if (targetIndex >= 0 && targetIndex < filtered.length) {
        this.selectedIndex = targetIndex;
        this.detailScrollOffset = 0;
        this.requestRender();
        return { handled: true };
      }
    }

    return undefined;
  }
}
