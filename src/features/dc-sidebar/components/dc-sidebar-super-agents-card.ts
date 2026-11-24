import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import { DcSidebarCard } from "../../../ui/dc-sidebar-card.ts";
import { DcVStack } from "../../../ui/dc-vstack.ts";
import { DcTabs, type DcTabItem } from "../../../ui/dc-tabs.ts";
import { DcJustifiedRow } from "../views/dc-sidebar-body.ts";
import { renderProgressBar } from "../../../ui/dc-progress-bar.ts";
import { dcControlDaemonManager } from "../../dc-agents/daemon/dc-control-daemon-manager.ts";
import { openControlCenterModal } from "../../dc-agents/views/dc-control-center-modal.ts";
import { openAgentChatMessengerModal } from "../../dc-agents/views/dc-chat-messenger-modal.ts";
import { checkPendingIssues } from "../../dc-agents/daemon/dc-pending-issues.ts";
import { getSidebarContext } from "../dc-sidebar.ts";
import { dcSupervisorBus } from "../../dc-control/core/dc-supervisor-bus.ts";
import { DcSupervisorLauncher } from "../../dc-control/core/dc-supervisor-launcher.ts";
import { getCanonicalDcSupervisorPaths } from "../../dc-control/core/dc-supervisor-paths.ts";
import { scanRunningPiProcesses } from "../../dc-control/core/dc-process-scanner.ts";
import { dcPrInspectorAgent } from "../../dc-agents/daemon/dc-pr-inspector-agent.ts";
import { dcSuperAgentRegistry, type DcSuperAgentRegistry } from "../../dc-agents/core/dc-super-agent-registry.ts";
import type { DcSuperAgentDefinition } from "../../dc-agents/core/dc-super-agent-definition.ts";

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

function formatSuperAgentHeadline(agent: DcSuperAgentDefinition): string {
  const stripped = agent.name
    .replace(/^DC\s+Super-?Agent\s*#?\d*\s*/i, "")
    .replace(/^\((.+)\)$/, "$1")
    .trim();
  return stripped ? `#${agent.agentNumber} ${stripped}` : `Agente #${agent.agentNumber}`;
}

const CARD_PADDING_X = 1;
const CARD_CONTENT_X_OFFSET = 1 + CARD_PADDING_X; // borde izquierdo '║' + paddingX

class SubTabsBarWrapper implements Component {
  constructor(
    private readonly tabs: DcTabs,
    private readonly xOffset: number = CARD_CONTENT_X_OFFSET,
  ) {}

  render(width: number): string[] {
    return this.tabs.render(width);
  }

  invalidate(): void {
    this.tabs.invalidate();
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const adjustedEvent: TuiMouseEvent =
      typeof event.x === "number" ? { ...event, x: event.x - this.xOffset } : event;
    if (
      adjustedEvent.y === 0 &&
      adjustedEvent.type === "press" &&
      (adjustedEvent.button === undefined || adjustedEvent.button === "left")
    ) {
      return { handled: true };
    }
    return this.tabs.handleMouse(adjustedEvent);
  }
}

/**
 * Tarjeta completa de la Torre de Control (dc-control):
 * Reúne sub-tabs interactivas por Super-Agente ([#86], [#99], agentes dinámicos)
 * y la sub-tab [⚙ CONFIG] con salud de binarios, estado del Gateway y botones de acción.
 */
export class DcSuperAgentsSidebarCard implements Component {
  public static readonly CONFIG_TAB_ID = "config";

  private requestRender?: () => void;
  private currentCard?: DcSidebarCard;
  private launcher = new DcSupervisorLauncher();
  private readonly registry: DcSuperAgentRegistry;
  private activeSubTab: string;
  private readonly tabsComponent: DcTabs;
  private readonly tabsBar: SubTabsBarWrapper;

  constructor(requestRender?: () => void, registry: DcSuperAgentRegistry = dcSuperAgentRegistry) {
    this.requestRender = requestRender;
    this.registry = registry;
    this.activeSubTab = this.resolveDefaultSubTab();

    this.tabsComponent = new DcTabs({
      tabs: this.buildSubTabs(),
      activeId: this.activeSubTab,
      paddingX: 0,
      separator: " ",
      borderStyle: "single",
      fullWidthBorder: true,
      theme: {
        fg: (col: string, s: string) => {
          if (col === "accent") return `\x1b[38;2;255;51;51m${s}\x1b[0m`;
          if (col === "border" || col === "dim") return `\x1b[2m${s}\x1b[22m`;
          return s;
        },
        bg: (col: string, s: string) =>
          col === "selectedBg" ? `\x1b[48;2;40;20;25m${s}\x1b[49m` : s,
        bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
      },
      onSelect: (id) => {
        if (this.activeSubTab !== id) {
          this.activeSubTab = id;
          this.requestRender?.();
        }
      },
    });
    this.tabsBar = new SubTabsBarWrapper(this.tabsComponent, CARD_CONTENT_X_OFFSET);

    void checkGhBinary().then(() => this.requestRender?.());

    const onUpdate = () => {
      this.syncSubTabs();
      this.requestRender?.();
    };
    dcSupervisorBus.on("session:discovered", onUpdate);
    dcSupervisorBus.on("session:state_changed", onUpdate);
    dcSupervisorBus.on("session:hung", onUpdate);
    dcSupervisorBus.on("session:terminated", onUpdate);
    this.registry.on("agent_registered", onUpdate);
    this.registry.on("agent_unregistered", onUpdate);
  }

  private resolveDefaultSubTab(): string {
    const agents = this.registry.listAgents();
    const agent86 = agents.find((a) => a.agentNumber === 86);
    if (agent86) return `agent:${agent86.agentNumber}`;
    if (agents.length > 0) return `agent:${agents[0]!.agentNumber}`;
    return DcSuperAgentsSidebarCard.CONFIG_TAB_ID;
  }

  private buildSubTabs(): DcTabItem[] {
    const agentTabs: DcTabItem[] = this.registry.listAgents().map((agent) => ({
      id: `agent:${agent.agentNumber}`,
      label: `[#${agent.agentNumber}]`,
    }));
    agentTabs.push({
      id: DcSuperAgentsSidebarCard.CONFIG_TAB_ID,
      label: "[⚙ CONFIG]",
    });
    return agentTabs;
  }

  private syncSubTabs(): DcTabItem[] {
    const tabs = this.buildSubTabs();
    if (!tabs.some((tab) => tab.id === this.activeSubTab)) {
      this.activeSubTab = this.resolveDefaultSubTab();
    }
    this.tabsComponent.options.tabs = tabs;
    this.tabsComponent.options.activeId = this.activeSubTab;
    return tabs;
  }

  public getSubTabs(): DcTabItem[] {
    return this.syncSubTabs();
  }

  public getActiveSubTab(): string {
    this.syncSubTabs();
    return this.activeSubTab;
  }

  public setActiveSubTab(tabId: string): boolean {
    const trimmed = tabId.trim();
    let normalized = trimmed;
    if (trimmed.toLowerCase() === "config" || trimmed === "[⚙ CONFIG]") {
      normalized = DcSuperAgentsSidebarCard.CONFIG_TAB_ID;
    } else {
      const bracketMatch = trimmed.match(/^\[?#?(\d+)\]?$/);
      if (bracketMatch) {
        normalized = `agent:${bracketMatch[1]}`;
      }
    }

    const tabs = this.syncSubTabs();
    if (!tabs.some((tab) => tab.id === normalized)) {
      return false;
    }

    this.activeSubTab = normalized;
    this.tabsComponent.options.activeId = normalized;
    this.requestRender?.();
    return true;
  }

  public handleInput(data: string): void {
    this.syncSubTabs();
    if (data === "\x1b[C" || data === "\t" || data === "]") {
      this.tabsComponent.nextTab();
    } else if (data === "\x1b[D" || data === "\x1b[Z" || data === "[") {
      this.tabsComponent.prevTab();
    } else if (data === "c" || data === "C") {
      this.setActiveSubTab(DcSuperAgentsSidebarCard.CONFIG_TAB_ID);
    }
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

    const registeredAgents = this.registry.listAgents();
    this.syncSubTabs();

    const rows: Component[] = [this.tabsBar];
    const sep = `  ${dim("─".repeat(Math.max(10, width - 8)))}`;

    const status = dcControlDaemonManager.getStatus();
    const dispatches = status.activeDispatches;
    const isDaemonRunning = status.running;
    const isTunnelRunning = status.tunnelActive;
    const inspections = dcPrInspectorAgent.getActiveInspections();

    const gatewayStatusStr = isDaemonRunning ? greenBright("● ONLINE") : dim("○ INACTIVO");
    const tunnelStatusStr = isTunnelRunning ? greenBright("✓ GH TÚNEL") : dim("○ SIN TÚNEL");

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

    const triggerCheckIssues = () => {
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
    };

    const getAgentLiveBadge = (agent: DcSuperAgentDefinition): string => {
      if (agent.agentNumber === 86 || agent.role === "issue_resolver") {
        return dispatches.length > 0 ? yellowBright(`[ocupado:${dispatches.length}]`) : dim("[idle]");
      }
      if (agent.agentNumber === 99 || agent.role === "pr_inspector") {
        return inspections.length > 0 ? greenBright(`[${inspections.length} PRs]`) : dim("[idle]");
      }
      return isDaemonRunning ? greenBright("[activo]") : dim("[idle]");
    };

    if (this.activeSubTab === DcSuperAgentsSidebarCard.CONFIG_TAB_ID) {
      // ── VISTA [⚙ CONFIG]: BINARIOS, GATEWAY Y BOTONES DE CONTROL ──
      const gh = cachedGhStatus;
      const ghBadge = gh?.ghInstalled ? greenBright("✓ ACTIVO") : bloodBright("✗ INACTIVO");
      const ghDetail = gh ? gh.ghVersion : "Verificando binario gh...";

      rows.push(
        new DcJustifiedRow(
          `  ${bloodSoft(bold("Salud de Binarios"))}`,
          `${bloodBright("[ ↻ ]")} `,
          () => {
            cachedGhStatus = null;
            void checkGhBinary().then(() => this.requestRender?.());
            this.requestRender?.();
          }
        )
      );

      rows.push(
        new DcJustifiedRow(
          `  ${dim("GitHub CLI (gh):")}`,
          `${ghBadge} `
        )
      );
      rows.push(
        new DcJustifiedRow(
          `    ${dim(`↳ ${ghDetail.length > 36 ? ghDetail.slice(0, 35) + "…" : ghDetail}`)}`,
          ""
        )
      );

      const hubStatusBadge = hubRunning
        ? greenBright(`● ONLINE (PID ${hubPid})`)
        : dim("○ INACTIVO");

      rows.push(
        new DcJustifiedRow(
          `  ${bloodSoft(bold("Daemon Hub:"))} ${hubStatusBadge}`,
          hubRunning ? `${greenBright("[Listo]")} ` : `${bloodBright("[Iniciar ▶]")} `,
          () => {
            void this.launcher.ensureDaemonRunning().then(() => this.requestRender?.());
          }
        )
      );

      rows.push(new DcJustifiedRow(sep, ""));

      // Configuración del Gateway Ingress & Super-Agentes
      rows.push(
        new DcJustifiedRow(
          `  ${bloodSoft(bold("Gateway Ingress:"))} ${gatewayStatusStr}`,
          `${tunnelStatusStr} `
        )
      );

      const portStr = status.port ? `${status.port}` : "4545";
      const receiverStr = status.running ? greenBright(`✓ 127.0.0.1:${portStr}`) : dim("○ Inactivo");
      rows.push(
        new DcJustifiedRow(
          `  ${dim("Receptor Local:")}`,
          `${receiverStr} `
        )
      );

      const repoLabel = status.repo?.fullNwo ?? "no detectado";
      const repoDisplay = repoLabel.length > 26 ? repoLabel.slice(0, 25) + "…" : repoLabel;
      rows.push(
        new DcJustifiedRow(
          `  ${dim("Repositorio:")}`,
          `${bloodWhite(repoDisplay)} `
        )
      );

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
      rows.push(
        new DcJustifiedRow(
          `  ${dim("Super-Agentes:")}`,
          `${bloodWhite(`${registeredAgents.length} registrados`)} `
        )
      );

      rows.push(new DcJustifiedRow(sep, ""));

      // Botones de acción directa
      if (isDaemonRunning) {
        rows.push(
          new DcJustifiedRow(
            `  ${bloodWhite("■ Detener Gateway Ingress")}`,
            `${bloodBright("[Detener]")} `,
            () => {
              void dcControlDaemonManager.stop().then(() => {
                this.requestRender?.();
                dcSupervisorBus.emit("session:state_changed", null as any, null as any);
              });
            }
          )
        );
        rows.push(
          new DcJustifiedRow(
            `  ${dim("↻ Reiniciar Gateway Ingress")}`,
            `${bloodBright("[Reiniciar]")} `,
            () => {
              const ctx = getSidebarContext();
              void dcControlDaemonManager.stop().then(async () => {
                await dcControlDaemonManager.start(ctx);
                this.requestRender?.();
                dcSupervisorBus.emit("session:state_changed", null as any, null as any);
                setTimeout(() => this.requestRender?.(), 1000);
              });
            }
          )
        );
      } else {
        rows.push(
          new DcJustifiedRow(
            `  ${greenBright("▶ Iniciar Gateway Ingress")}`,
            `${greenBright("[Iniciar]")} `,
            () => {
              const ctx = getSidebarContext();
              void dcControlDaemonManager.start(ctx).then(() => {
                this.requestRender?.();
                dcSupervisorBus.emit("session:state_changed", null as any, null as any);
                setTimeout(() => this.requestRender?.(), 1000);
              });
            }
          )
        );
      }

      rows.push(
        new DcJustifiedRow(
          `  ${bloodWhite(bold("🏢 OFICINA DC-CONTROL"))}`,
          `${bloodBright("[/dc-control ↗]")} `,
          () => {
            const ctx = getSidebarContext();
            if (ctx) void openControlCenterModal(ctx);
          }
        )
      );

      rows.push(
        new DcJustifiedRow(
          `  ${bloodWhite("💬 Mensajes & Chats")}`,
          `${bloodBright("[Ver Chats ↗]")} `,
          () => {
            const ctx = getSidebarContext();
            if (ctx) void openAgentChatMessengerModal(ctx);
          }
        )
      );

      rows.push(
        new DcJustifiedRow(
          `  ${bloodWhite("⚡ Revisar Issues GitHub")}`,
          `${bloodBright("[Check Issues]")} `,
          triggerCheckIssues
        )
      );
    } else {
      // ── VISTA DE SUPER-AGENTE ([#86], [#99], DINÁMICOS) ──
      const selectedNum = parseInt(this.activeSubTab.replace(/^agent:/, ""), 10);
      const selectedAgent =
        registeredAgents.find((a) => a.agentNumber === selectedNum) ?? registeredAgents[0];

      if (selectedAgent) {
        const selectedIcon = selectedAgent.icon || (selectedAgent.role === "pr_inspector" ? "🕵️‍♀️" : "🤖");
        const selectedHeadline = formatSuperAgentHeadline(selectedAgent);
        const selectedBadge = getAgentLiveBadge(selectedAgent);

        rows.push(
          new DcJustifiedRow(
            `  ${yellowBright(selectedIcon)} ${bloodWhite(bold(selectedHeadline))}`,
            `${selectedBadge} `
          )
        );

        const triggersText = selectedAgent.eventTriggers.join(", ");
        const metaText = `${selectedAgent.role} · ${triggersText}`;
        rows.push(
          new DcJustifiedRow(
            `    ${dim(`↳ ${metaText.length > 38 ? metaText.slice(0, 37) + "…" : metaText}`)}`,
            ""
          )
        );

        if (selectedAgent.agentNumber === 86 || selectedAgent.role === "issue_resolver") {
          // Trabajo en tiempo real de #86
          if (dispatches.length === 0) {
            rows.push(
              new DcJustifiedRow(
                `  ${dim(`Misión #${selectedAgent.agentNumber}:`)}`,
                `${dim("en espera")} `
              )
            );
            rows.push(
              new DcJustifiedRow(
                `    ${dim("↳ Gateway a la escucha de eventos GitHub")}`,
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

            const oddTasks = parseOddTasksFromWorktree(active.worktreePath, active.taskSlug);
            if (oddTasks.length > 0) {
              const doneSteps = oddTasks.filter((t) => t.status === "done").length;
              const totalSteps = oddTasks.length;
              const pct = Math.round((doneSteps / totalSteps) * 100);
              const bar = renderProgressBar(pct, 8, "▰", "▱", "\x1b[38;2;255;77;77m");

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

          // Labs supervisados en vivo
          const runningLabs = scanRunningPiProcesses();
          rows.push(
            new DcJustifiedRow(
              `  ${dim("Labs supervisados:")}`,
              `${bloodBright(`${runningLabs.length} vivos`)}  ${bloodBright("[ ↻ ]")} `,
              () => {
                cachedGhStatus = null;
                void checkGhBinary().then(() => this.requestRender?.());
                this.requestRender?.();
              }
            )
          );
          if (runningLabs.length > 0) {
            for (const lab of runningLabs.slice(0, 3)) {
              const glyph = lab.role.startsWith("super_agent") || lab.role === "worker"
                ? yellowBright("🤖")
                : lab.osState === "stopped"
                  ? dim("⏸")
                  : greenBright("●");
              const statusTag = lab.osState === "stopped"
                ? dim("[suspendido]")
                : lab.role.startsWith("super_agent")
                  ? yellowBright(`[${lab.role.replace("super_agent_", "#")}]`)
                  : dim(`PID ${lab.pid}`);
              const nameDisplay = lab.displayLabel.length > 18
                ? lab.displayLabel.slice(0, 17) + "…"
                : lab.displayLabel;
              rows.push(
                new DcJustifiedRow(
                  `    ${glyph} ${bloodWhite(nameDisplay)}`,
                  `${statusTag} `
                )
              );
            }
          }
        } else if (selectedAgent.agentNumber === 99 || selectedAgent.role === "pr_inspector") {
          // Trabajo en tiempo real de #99 (PR Inspector)
          if (inspections.length === 0) {
            rows.push(
              new DcJustifiedRow(
                `  ${dim(`Inspección #${selectedAgent.agentNumber}:`)}`,
                `${dim("en espera")} `
              )
            );
            rows.push(
              new DcJustifiedRow(
                `    ${dim("↳ Sin PRs en inspección activa")}`,
                ""
              )
            );
          } else {
            for (const insp of inspections.slice(0, 3)) {
              const verdictBadge = insp.verdict === "APPROVE"
                ? greenBright("[APPROVE]")
                : insp.verdict === "REQUEST_CHANGES"
                  ? bloodBright("[CHANGES]")
                  : yellowBright("[DISCUSS]");
              rows.push(
                new DcJustifiedRow(
                  `  ${yellowBright("▶")} ${bloodWhite(bold(`PR #${insp.prNumber}`))}`,
                  `${verdictBadge} `
                )
              );
              rows.push(
                new DcJustifiedRow(
                  `    ${dim(`↳ ${insp.blastRadius.filesChanged} archivos (+${insp.blastRadius.insertions}/-${insp.blastRadius.deletions})`)}`,
                  ""
                )
              );
            }
          }
        } else {
          // Vista de Super-Agente dinámico registrado en runtime
          const desc = selectedAgent.description.trim();
          if (desc) {
            rows.push(
              new DcJustifiedRow(
                `  ${dim(desc.length > 42 ? desc.slice(0, 41) + "…" : desc)}`,
                ""
              )
            );
          }
          rows.push(
            new DcJustifiedRow(
              `  ${dim(`Misión #${selectedAgent.agentNumber}:`)}`,
              isDaemonRunning ? `${greenBright("en escucha")} ` : `${dim("en espera")} `
            )
          );
        }

        // Botones de acción rápida del agente activo
        rows.push(
          new DcJustifiedRow(
            `  ${bloodWhite(bold("🏢 OFICINA DC-CONTROL"))}`,
            `${bloodBright("[Abrir Oficina ↗]")} `,
            () => {
              const ctx = getSidebarContext();
              if (ctx) void openControlCenterModal(ctx);
            }
          )
        );
        rows.push(
          new DcJustifiedRow(
            `  ${bloodWhite(`💬 Chat #${selectedAgent.agentNumber}`)}`,
            `${bloodBright("[Ver Chats ↗]")} `,
            () => {
              const ctx = getSidebarContext();
              if (ctx) void openAgentChatMessengerModal(ctx);
            }
          )
        );
        if (isTunnelRunning && (selectedAgent.agentNumber === 86 || selectedAgent.role === "issue_resolver")) {
          rows.push(
            new DcJustifiedRow(
              `  ${bloodWhite("⚡ Revisar Issues GitHub")}`,
              `${bloodBright("[Check Issues]")} `,
              triggerCheckIssues
            )
          );
        }
      }

      rows.push(new DcJustifiedRow(sep, ""));

      // ── GATEWAY INGRESS & SUPER-AGENTES FEDERADOS ──
      rows.push(
        new DcJustifiedRow(
          `  ${bloodSoft(bold("Gateway Ingress:"))} ${gatewayStatusStr}`,
          `${tunnelStatusStr} `
        )
      );

      rows.push(
        new DcJustifiedRow(
          `  ${dim(`Super-Agentes (${registeredAgents.length}):`)}`,
          `${dim(isDaemonRunning ? "federados" : "en espera")} `
        )
      );

      for (const agent of registeredAgents) {
        const icon = agent.icon || (agent.role === "pr_inspector" ? "🕵️‍♀️" : "🤖");
        const liveStatus = getAgentLiveBadge(agent);
        const headline = formatSuperAgentHeadline(agent);
        const displayHeadline = headline.length > 26 ? headline.slice(0, 25) + "…" : headline;
        const isCurrent = this.activeSubTab === `agent:${agent.agentNumber}`;
        const marker = isCurrent ? bloodBright("▸") : " ";

        rows.push(
          new DcJustifiedRow(
            `  ${marker} ${yellowBright(icon)} ${bloodWhite(displayHeadline)}`,
            `${liveStatus} `,
            () => {
              this.setActiveSubTab(`agent:${agent.agentNumber}`);
            }
          )
        );

        const triggersSummary = agent.eventTriggers.join(", ");
        const metaLine = `${agent.role} · ${triggersSummary}`;
        const displayMeta = metaLine.length > 34 ? metaLine.slice(0, 33) + "…" : metaLine;
        rows.push(
          new DcJustifiedRow(
            `      ${dim(`↳ ${displayMeta}`)}`,
            ""
          )
        );
      }
    }

    this.currentCard = new DcSidebarCard({
      glyph: "🏢",
      title: "DC-Control",
      titleRight: "oficina [↗]",
      content: new DcVStack(rows),
      paddingX: CARD_PADDING_X,
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

export function createSuperAgentsSidebarCard(
  requestRender?: () => void,
  registry: DcSuperAgentRegistry = dcSuperAgentRegistry,
): DcSuperAgentsSidebarCard {
  return new DcSuperAgentsSidebarCard(requestRender, registry);
}
