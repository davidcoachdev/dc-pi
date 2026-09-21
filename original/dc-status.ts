/**
 * dc-status — Ventana flotante de estado del entorno (DcWindow Win 3.1 style).
 *
 * Muestra las métricas del entorno (Git, Path, MCPs, Plugins, Agentes, Skills,
 * Extensiones, Tools y Versión) en una ventana flotante limpia, sin ensuciar la
 * terminal con texto plano.
 *
 * Se abre:
 *   - Automáticamente al iniciar sesión (si hay UI interactiva).
 *   - Con el comando: /estado o /dc-status
 *   - Con el atajo: Alt+E
 *
 * Atajos dentro de la ventana:
 *   - Tab / 1-2 / ← → : cambiar pestaña (Info / Alertas)
 *   - 'c' o clic en botón : copiar alertas y pegarlas en el prompt del agente
 *   - ↑ / ↓ / j / k / rueda : scroll en alertas
 *   - Esc / Enter / Espacio / 'q' / clic en [ X ] : cerrar
 */

import { VERSION } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type TUI,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DcWindow } from "./dc-window.ts";
import { notify, notifyHerdr } from "./dc-notify.ts";

interface EnvStatus {
  gitBranch: string;
  gitStatus: string;
  cwd: string;
  modelId?: string;
  thinkingLevel?: string;
  mcpServers: Array<{ name: string; toolsCount?: number }>;
  packages: string[];
  extensionsCount: number;
  skillsCount: number;
  customToolsCount: number;
  sddPhasesCount: number;
  alerts: string[];
}

function getGitInfo(cwd: string): Promise<{ branch: string; status: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", cwd, "status", "--porcelain", "-b"],
      { encoding: "utf8", windowsHide: true, timeout: 2000 },
      (err, stdout) => {
        if (err || !stdout) {
          resolve({ branch: "No es un repositorio git", status: "n/a" });
          return;
        }
        const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
        const branchLine = lines[0] ?? "";
        let branch = "desconocida";
        const m = branchLine.match(/^##\s+([^.\s]+)/);
        if (m && m[1]) branch = m[1];
        else if (branchLine.includes("No commits yet on ")) {
          branch = branchLine.replace("## No commits yet on ", "").trim();
        }

        const changes = lines.slice(1).length;
        const status = changes === 0 ? "limpio" : `${changes} cambio(s) pendiente(s)`;
        resolve({ branch, status });
      },
    );
  });
}

async function collectStatus(ctx: ExtensionContext, pi: ExtensionAPI): Promise<EnvStatus> {
  const alerts: string[] = [];

  // Git
  const gitInfo = await getGitInfo(ctx.cwd);

  // Model
  const modelId = ctx.model?.id;
  const thinkingLevel = ctx.thinkingLevel;

  // MCP Servers
  const mcpServers: Array<{ name: string; toolsCount?: number }> = [];
  try {
    const mcpPath = path.join(os.homedir(), ".pi", "agent", "mcp.json");
    const cachePath = path.join(os.homedir(), ".pi", "agent", "mcp-cache.json");

    let serverNames: string[] = [];
    if (fs.existsSync(mcpPath)) {
      const cfg = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
      if (cfg && typeof cfg.mcpServers === "object") {
        serverNames = Object.keys(cfg.mcpServers);
      }
    }

    let cacheServers: Record<string, { tools?: unknown[] }> = {};
    if (fs.existsSync(cachePath)) {
      const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      if (cache?.servers && typeof cache.servers === "object") {
        cacheServers = cache.servers;
      }
    }

    if (serverNames.length === 0 && Object.keys(cacheServers).length > 0) {
      serverNames = Object.keys(cacheServers);
    }

    for (const name of serverNames) {
      mcpServers.push({
        name,
        toolsCount: Array.isArray(cacheServers[name]?.tools) ? cacheServers[name].tools.length : undefined,
      });
    }
  } catch {
    /* noop */
  }

  // Packages y detección de duplicados
  const packages: string[] = [];
  try {
    const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      if (Array.isArray(settings.packages)) {
        const seen = new Set<string>();
        for (const p of settings.packages) {
          const raw = typeof p === "string" ? p : p?.source ?? "";
          if (raw) {
            packages.push(raw);
            const baseName = raw.replace(/^npm:/, "").replace(/^git:[^/]+\/[^/]+\//, "").split("@")[0];
            if (seen.has(baseName)) {
              alerts.push(`Paquete duplicado en settings: ${baseName}`);
            }
            seen.add(baseName);
          }
        }
      }
    }
  } catch {
    /* noop */
  }

  // Extensions
  let extensionsCount = 0;
  try {
    const extDir = path.join(os.homedir(), ".pi", "agent", "extensions");
    if (fs.existsSync(extDir)) {
      const files = fs.readdirSync(extDir).filter((f) => f.endsWith(".ts") || f.endsWith(".js"));
      extensionsCount = files.length;
    }
  } catch {
    /* noop */
  }

  // Skills
  const allCommands = pi.getCommands();
  const skillsCount = allCommands.filter((c) => c.source === "skill").length;

  // Custom Tools
  const allTools = pi.getAllTools();
  const customToolsCount = allTools.filter(
    (t) => !["builtin", "sdk"].includes(t.sourceInfo.source),
  ).length;

  // SDD Agents / Phases
  let sddPhasesCount = 0;
  try {
    const agentDir = path.join(os.homedir(), ".pi", "agent", "agents");
    if (fs.existsSync(agentDir)) {
      const files = fs.readdirSync(agentDir).filter((f) => f.endsWith(".md") || f.endsWith(".json"));
      sddPhasesCount = files.length;
    }
  } catch {
    /* noop */
  }

  // Diagnósticos capturados de extensiones, skills, prompts o themes
  const G_DIAGNOSTICS = Symbol.for("dc.env.diagnostics");
  const captured = (globalThis as unknown as Record<symbol, string[]>)[G_DIAGNOSTICS];
  if (Array.isArray(captured) && captured.length > 0) {
    for (const diag of captured) {
      alerts.push(...diag.split("\n"));
    }
  }

  return {
    gitBranch: gitInfo.branch,
    gitStatus: gitInfo.status,
    cwd: ctx.cwd,
    modelId,
    thinkingLevel,
    mcpServers,
    packages,
    extensionsCount,
    skillsCount,
    customToolsCount,
    sddPhasesCount,
    alerts,
  };
}

interface TabHit {
  tab: number;
  xStart: number;
  xEnd: number;
}

interface ButtonHit {
  y: number;
  xStart: number;
  xEnd: number;
}

function tryCopyToClipboard(text: string): void {
  // 1. Terminal OSC 52 sequence (Alacritty, Kitty, WezTerm, iTerm, tmux, etc.)
  try {
    const base64 = Buffer.from(text, "utf8").toString("base64");
    process.stdout.write(`\x1b]52;c;${base64}\x07`);
  } catch {
    /* noop */
  }

  // 2. xsel si está disponible en Linux
  try {
    const child = execFile("xsel", ["--clipboard", "--input"], { timeout: 1000 }, () => {});
    if (child.stdin) {
      child.stdin.write(text);
      child.stdin.end();
    }
  } catch {
    /* noop */
  }
}

function copyAlertsToPrompt(alerts: string[], ctx: ExtensionContext): boolean {
  const cleanAlerts = alerts
    .map((a) => a.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trimEnd())
    .filter((a) => a.trim().length > 0);

  if (cleanAlerts.length === 0) {
    ctx.ui.notify("No hay alertas activas para copiar.", "info");
    return false;
  }

  const promptText = [
    "Revisá y solucioná las siguientes alertas detectadas en el estado del entorno de Pi:",
    "",
    "```",
    ...cleanAlerts,
    "```",
    "",
  ].join("\n");

  // Inyectar en el editor/prompt de Pi
  ctx.ui.pasteToEditor(promptText);

  // Copiar también al portapapeles del sistema
  tryCopyToClipboard(promptText);

  ctx.ui.notify(`✔ ${cleanAlerts.length} alerta(s) pegada(s) en el prompt para el agente.`, "info");
  return true;
}

function getAlertCount(status: EnvStatus): number {
  let count = 0;
  for (const alert of status.alerts) {
    const trimmed = alert.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
      count++;
    }
  }
  if (count === 0 && status.alerts.filter((a) => a.trim().length > 0).length > 0) {
    count = status.alerts.filter((a) => a.trim().length > 0).length;
  }
  return count;
}

class StatusPanel implements Component {
  private activeTab = 0; // 0 = Info, 1 = Alertas
  private scroll = 0;
  private tabHits: TabHit[] = [];
  private copyBtnHit?: ButtonHit;
  private lastWidth = 60;

  constructor(
    private readonly status: EnvStatus,
    private readonly theme: Theme,
    private readonly onClose: () => void,
    private readonly tui?: TUI,
    private readonly onCopy?: () => void,
  ) {}

  invalidate(): void {}

  getFooter(): string {
    const t = this.theme;
    const alertCount = this.getAlertCount();
    const compact = this.lastWidth < 62;

    if (this.activeTab === 1 && alertCount > 0) {
      if (compact) {
        return `${t.fg("accent", "c")} copiar   ${t.fg("accent", "↑/↓")} scroll   ${t.fg("accent", "Tab/1-2")} pestaña   ${t.fg("accent", "esc/q")} cerrar`;
      }
      return `${t.fg("accent", "c")} copiar al prompt   ${t.fg("accent", "↑/↓ / Rueda")} scroll   ${t.fg("accent", "Tab/←→ / Clic")} cambiar pestaña   ${t.fg("accent", "esc/q")} cerrar`;
    }

    if (alertCount > 0) {
      if (compact) {
        return `${t.fg("accent", "c")} copiar   ${t.fg("accent", "2/Tab")} alertas   ${t.fg("accent", "esc/q")} cerrar`;
      }
      return `${t.fg("accent", "c")} copiar al prompt   ${t.fg("accent", "Tab/←→ / Clic")} cambiar pestaña   ${t.fg("accent", "esc/q")} cerrar`;
    }

    if (compact) {
      return `${t.fg("accent", "Tab/1-2")} pestaña   ${t.fg("accent", "esc/q")} cerrar`;
    }
    return `${t.fg("accent", "Tab/←→ / Clic")} cambiar pestaña   ${t.fg("accent", "esc/q/enter")} cerrar`;
  }

  private getAlertCount(): number {
    return getAlertCount(this.status);
  }

  private getWrappedAlertLines(width: number): string[] {
    const t = this.theme;
    const w = Math.max(20, width);
    const alertLines: string[] = [];

    for (const alert of this.status.alerts) {
      const trimmed = alert.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        const wrapW = Math.max(15, w - 6);
        const parts = wrapTextWithAnsi(t.fg("warning", trimmed), wrapW);
        for (const p of parts) {
          alertLines.push("    " + p);
        }
      } else if (alert.startsWith("    ")) {
        const wrapW = Math.max(15, w - 10);
        const parts = wrapTextWithAnsi(t.fg("error", trimmed), wrapW);
        for (const p of parts) {
          alertLines.push("        " + p);
        }
      } else if (alert.startsWith("  ")) {
        const wrapW = Math.max(15, w - 8);
        const parts = wrapTextWithAnsi(t.fg("accent", trimmed), wrapW);
        for (const p of parts) {
          alertLines.push("      " + p);
        }
      } else {
        const wrapW = Math.max(15, w - 6);
        const parts = wrapTextWithAnsi(t.fg("error", trimmed), wrapW);
        if (parts.length > 0) {
          alertLines.push("  • " + parts[0]);
          for (let i = 1; i < parts.length; i++) {
            alertLines.push("    " + parts[i]);
          }
        }
      }
    }

    return alertLines;
  }

  private maxScroll(): number {
    if (this.activeTab !== 1) return 0;
    const alertLines = this.getWrappedAlertLines(this.lastWidth);
    return Math.max(0, alertLines.length - 12);
  }

  handleInput(data: string): boolean {
    if (
      matchesKey(data, Key.enter) ||
      matchesKey(data, Key.escape) ||
      data === " " ||
      data.toLowerCase() === "q"
    ) {
      this.onClose();
      return true;
    }

    if (data.toLowerCase() === "c" || data.toLowerCase() === "y") {
      if (this.onCopy) {
        this.onCopy();
        return true;
      }
    }

    if (
      matchesKey(data, Key.tab) ||
      matchesKey(data, "shift+tab") ||
      matchesKey(data, Key.shift(Key.tab))
    ) {
      this.activeTab = this.activeTab === 0 ? 1 : 0;
      this.scroll = 0;
      this.tui?.requestRender();
      return true;
    }

    if (matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
      this.activeTab = this.activeTab === 0 ? 1 : 0;
      this.scroll = 0;
      this.tui?.requestRender();
      return true;
    }

    if (data === "1") {
      this.activeTab = 0;
      this.scroll = 0;
      this.tui?.requestRender();
      return true;
    }

    if (data === "2") {
      this.activeTab = 1;
      this.scroll = 0;
      this.tui?.requestRender();
      return true;
    }

    if (matchesKey(data, Key.up) || data === "k") {
      if (this.scroll > 0) {
        this.scroll = Math.max(0, this.scroll - 1);
        this.tui?.requestRender();
        return true;
      }
    }

    if (matchesKey(data, Key.down) || data === "j") {
      if (this.scroll < this.maxScroll()) {
        this.scroll = Math.min(this.maxScroll(), this.scroll + 1);
        this.tui?.requestRender();
        return true;
      }
    }

    if (matchesKey(data, Key.pageUp)) {
      if (this.scroll > 0) {
        this.scroll = Math.max(0, this.scroll - 5);
        this.tui?.requestRender();
        return true;
      }
    }

    if (matchesKey(data, Key.pageDown)) {
      if (this.scroll < this.maxScroll()) {
        this.scroll = Math.min(this.maxScroll(), this.scroll + 5);
        this.tui?.requestRender();
        return true;
      }
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): { handled: boolean } | undefined {
    const { type } = event;
    const x = (event as { x?: number }).x ?? 0;
    const y = (event as { y?: number }).y ?? 0;

    if (type === "wheel") {
      const delta = (event as { wheelDelta?: number }).wheelDelta ?? 0;
      if (delta === 0) return undefined;
      if (delta > 0) {
        this.scroll = Math.min(this.maxScroll(), this.scroll + 2);
      } else {
        this.scroll = Math.max(0, this.scroll - 2);
      }
      this.tui?.requestRender();
      return { handled: true };
    }

    if (type === "click") {
      // Clic en la fila de tabs (y === 1)
      if (y === 1) {
        for (const hit of this.tabHits) {
          if (x >= hit.xStart && x <= hit.xEnd) {
            if (this.activeTab !== hit.tab) {
              this.activeTab = hit.tab;
              this.scroll = 0;
              this.tui?.requestRender();
            }
            return { handled: true };
          }
        }
      }

      // Clic en el botón Copiar al Prompt
      if (this.copyBtnHit && y === this.copyBtnHit.y) {
        if (x >= this.copyBtnHit.xStart && x <= this.copyBtnHit.xEnd) {
          if (this.onCopy) {
            this.onCopy();
            return { handled: true };
          }
        }
      }
    }

    return undefined;
  }

  render(width: number): string[] {
    const out: string[] = [];
    const w = Math.max(20, width);
    this.lastWidth = w;
    const t = this.theme;
    const alertCount = this.getAlertCount();
    this.copyBtnHit = undefined;

    // ── 1. Barra de Tabs ──
    this.tabHits = [];
    let currentX = 2; // margen de 2 espacios ("  ")
    const renderedTabs: string[] = [];

    const shortTabs = w < 50;
    const tabsDef = [
      { id: 0, label: shortTabs ? " [1] Info " : " [1] ✦ Información " },
      {
        id: 1,
        label:
          alertCount > 0
            ? shortTabs
              ? ` [2] ⚠ (${alertCount}) `
              : ` [2] ⚠ Alertas (${alertCount}) `
            : shortTabs
              ? " [2] Alertas "
              : " [2] Alertas (0) ",
      },
    ];

    for (let i = 0; i < tabsDef.length; i++) {
      const def = tabsDef[i];
      const isSel = this.activeTab === i;
      const label = def.label;
      const labelW = visibleWidth(label);

      this.tabHits.push({ tab: i, xStart: currentX, xEnd: currentX + labelW });
      currentX += labelW;

      if (isSel) {
        if (i === 1 && alertCount > 0) {
          renderedTabs.push(t.bg("selectedBg", t.fg("error", t.bold(label))));
        } else {
          renderedTabs.push(t.bg("selectedBg", t.fg("accent", t.bold(label))));
        }
      } else {
        if (i === 1 && alertCount > 0) {
          renderedTabs.push(t.fg("warning", label));
        } else {
          renderedTabs.push(t.fg("dim", label));
        }
      }

      if (i < tabsDef.length - 1) {
        renderedTabs.push(t.fg("dim", " │ "));
        currentX += 3;
      }
    }

    out.push("");
    out.push("  " + renderedTabs.join(""));
    out.push("  " + t.fg("border", "─".repeat(Math.max(10, Math.min(w - 4, 60)))));
    out.push("");

    // ── 2. Contenido según tab activo ──
    if (this.activeTab === 0) {
      // TAB 0: INFORMACIÓN DEL ENTORNO
      const pad = (s: string, len: number) => {
        const v = visibleWidth(s);
        return v >= len ? truncateToWidth(s, len, "") : s + " ".repeat(len - v);
      };

      const row = (label: string, val: string, valColor?: string) => {
        const lbl = this.theme.fg("accent", pad(label, 17));
        const valueFormatted = valColor ? valColor : this.theme.fg("text", val);
        const valW = Math.max(15, w - 21);
        const parts = wrapTextWithAnsi(valueFormatted, valW);
        const lines: string[] = [];
        lines.push(`  ${lbl} ${parts[0] ?? ""}`);
        const indent = " ".repeat(17);
        for (let i = 1; i < parts.length; i++) {
          lines.push(`  ${indent} ${parts[i]}`);
        }
        return lines;
      };

      out.push(...row("RAMA GIT:", ` ${this.status.gitBranch} (${this.status.gitStatus})`));
      out.push(...row("DIRECTORIO:", this.status.cwd));
      if (this.status.modelId) {
        const modelDisplay = this.status.thinkingLevel
          ? `${this.status.modelId} (${this.status.thinkingLevel})`
          : this.status.modelId;
        out.push(...row("MODELO ACTIVO:", modelDisplay));
      }
      const mcpText =
        this.status.mcpServers.length > 0
          ? `${this.status.mcpServers.length} activo(s) [${this.status.mcpServers
              .map((s) => (s.toolsCount !== undefined ? `${s.name} (${s.toolsCount})` : s.name))
              .join(", ")}]`
          : "0 configurados";
      out.push(...row("SERVIDORES MCP:", mcpText));
      out.push(...row("PLUGINS:", `${this.status.packages.length} paquete(s) configurado(s)`));
      out.push(...row("EXTENSIONES:", `${this.status.extensionsCount} activa(s)`));
      if (this.status.sddPhasesCount > 0) {
        out.push(...row("AGENTES SDD:", `${this.status.sddPhasesCount} fases disponibles`));
      }
      out.push(...row("SKILLS:", `${this.status.skillsCount} cargado(s)`));
      out.push(...row("HERRAMIENTAS:", `${this.status.customToolsCount} custom disponibles`));
      out.push(...row("VERSIÓN PI:", `v${VERSION}`));

      const noticeWrapW = Math.max(15, w - 4);
      if (alertCount > 0) {
        out.push("");
        const notice = `⚠ Se detectaron ${alertCount} alerta(s). Presioná [2] para verlas o [c] para copiar al prompt.`;
        for (const line of wrapTextWithAnsi(this.theme.fg("warning", notice), noticeWrapW)) {
          out.push(`  ${line}`);
        }
        out.push("");
      } else {
        out.push("");
      }
    } else {
      // TAB 1: ALERTAS DETECTADAS
      const alertLines = this.getWrappedAlertLines(w);
      if (alertCount === 0 || alertLines.length === 0) {
        const wrapW = Math.max(15, w - 4);
        out.push("");
        for (const line of wrapTextWithAnsi(
          this.theme.fg("success", "✔ No se detectaron alertas ni conflictos en el entorno."),
          wrapW,
        )) {
          out.push(`  ${line}`);
        }
        out.push("");
        for (const line of wrapTextWithAnsi(
          this.theme.fg("muted", "Todas las extensiones, atajos y paquetes cargaron correctamente."),
          wrapW,
        )) {
          out.push(`  ${line}`);
        }
        out.push("");
      } else {
        const copyLabel = " [ Copiar al Prompt (c) ] ";
        const copyLabelW = visibleWidth(copyLabel);
        const headerText = `⚠ ALERTAS DETECTADAS (${alertCount}):`;
        const headerFormatted = this.theme.fg("error", t.bold(headerText));
        const btnFormatted = this.theme.bg("selectedBg", this.theme.fg("accent", t.bold(copyLabel)));

        const headerW = visibleWidth(headerText);
        if (headerW + copyLabelW + 6 <= w) {
          const spaceW = Math.max(2, w - headerW - copyLabelW - 4);
          const btnXStart = 2 + headerW + spaceW;
          this.copyBtnHit = { y: out.length, xStart: btnXStart, xEnd: btnXStart + copyLabelW };
          out.push(`  ${headerFormatted}${" ".repeat(spaceW)}${btnFormatted}`);
        } else {
          out.push(`  ${headerFormatted}`);
          this.copyBtnHit = { y: out.length, xStart: 2, xEnd: 2 + copyLabelW };
          out.push(`  ${btnFormatted}`);
        }
        out.push("");

        const maxRows = 12;
        // Bounded scroll
        this.scroll = Math.min(this.scroll, Math.max(0, alertLines.length - maxRows));
        const visibleAlerts = alertLines.slice(this.scroll, this.scroll + maxRows);
        out.push(...visibleAlerts);

        if (alertLines.length > maxRows) {
          out.push("");
          out.push(
            `  ${this.theme.fg(
              "dim",
              `(Mostrando ${this.scroll + 1}-${Math.min(alertLines.length, this.scroll + maxRows)} de ${alertLines.length} — ↑/↓ o rueda para scroll)`,
            )}`,
          );
        }
        out.push("");
      }
    }

    return out.map((line) => truncateToWidth(line, w, ""));
  }
}

async function showStatusModal(ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
  if (!ctx.hasUI || ctx.mode !== "tui") return;
  const status = await collectStatus(ctx, pi);

  let panel: StatusPanel;
  await ctx.ui.custom<void>(
    (tui, theme, _kb, done) => {
      panel = new StatusPanel(
        status,
        theme,
        () => done(),
        tui,
        () => {
          const ok = copyAlertsToPrompt(status.alerts, ctx);
          if (ok) {
            done();
          }
        },
      );
      return new DcWindow({
        title: "Estado del Entorno — DC Studio",
        glyph: "✦",
        theme,
        content: panel,
        onClose: () => done(),
        footer: () => panel.getFooter(),
        paddingX: 1,
        frame: "double",
      });
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "65%",
        maxHeight: "85%",
      },
    },
  );
}

export default function dcStatusExtension(pi: ExtensionAPI) {
  let autoTimer: NodeJS.Timeout | null = null;

  pi.on("session_shutdown", () => {
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
  });

  // Verificación de entorno en el arranque interactivo y recargas
  pi.on("session_start", async (event, ctx) => {
    try {
      if (!ctx.hasUI || ctx.mode !== "tui") return;

      const reason = (event as { reason?: string } | undefined)?.reason;
      if (reason && reason !== "startup" && reason !== "new" && reason !== "new-session" && reason !== "reload") return;

      // No abrir en comandos de CLI como `pi update` o `pi install`
      const isCLI =
        process.argv.length > 2 &&
        !process.argv.every((arg) => arg.startsWith("-") || arg.endsWith(".ts"));
      if (isCLI) return;

      if (autoTimer) clearTimeout(autoTimer);
      // Pequeño delay defensivo para que la TUI monte su layout base
      autoTimer = setTimeout(async () => {
        autoTimer = null;
        try {
          const status = await collectStatus(ctx, pi);
          const alertCount = getAlertCount(status);

          if (alertCount > 0) {
            notify(
              ctx,
              `⚠ Entorno: ${alertCount} alerta(s) detectada(s)`,
              "Presioná Alt+E para verlas o [c] para copiar al prompt.",
              "warning",
            );
          } else {
            // Entorno limpio: se notifica exclusivamente por dc-notify (Herdr) sin abrir nada por pantalla
            notify(
              ctx,
              "Entorno verificado",
              "Sin alertas ni conflictos detectados.",
              "info",
            );
          }
        } catch {
          /* noop */
        }
      }, 500);
    } catch {
      /* noop */
    }
  });

  // Comando manual: /estado o /dc-status
  pi.registerCommand("estado", {
    description: "Muestra el estado del entorno en una ventana flotante DC",
    handler: async (_args, ctx) => {
      await showStatusModal(ctx, pi);
    },
  });

  pi.registerCommand("dc-status", {
    description: "Muestra el estado del entorno en una ventana flotante DC",
    handler: async (_args, ctx) => {
      await showStatusModal(ctx, pi);
    },
  });

  // Atajo: Alt+E
  pi.registerShortcut("alt+e", {
    description: "dc-status: ver estado del entorno en ventana flotante",
    handler: async (ctx) => {
      await showStatusModal(ctx, pi);
    },
  });
}
