import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import * as os from "node:os";
import * as path from "node:path";
import { DcSidebarCard } from "../../../ui/dc-sidebar-card.ts";
import { DcVStack } from "../../../ui/dc-vstack.ts";
import { DcText } from "../../../ui/dc-text.ts";
import { DcCollapsible } from "../../../ui/dc-collapsible.ts";
import { renderProgressBar } from "../../../ui/dc-progress-bar.ts";
import { DcJustifiedRow } from "../views/dc-sidebar-body.ts";
import { getProjectInfo } from "../providers/dc-project-provider.ts";
import { getProjectObservations, isProjectEnrolled, resolveEngramProjectName } from "../../dc-engram/dc-engram-db.ts";
import { getCachedAccountQuotas } from "../providers/dc-quota-provider.ts";
import { readProfilesInfo, switchActiveProfile } from "../providers/dc-profile-provider.ts";
import { getMcpServersInfo } from "../providers/dc-mcp-provider.ts";
import { executeSlashCommand } from "../../../core/dc-command-executor.ts";
import { openChangesViewer } from "../../dc-changes/dc-changes.ts";
import { openGitGraphViewer } from "../../dc-git-graph/index.ts";
import { openPreviewDirectionMenu } from "../../dc-preview/index.ts";
import { openQuotaViewer } from "../../dc-quota/dc-quota.ts";
import { openTaxisViewer } from "../../dc-agents/dc-agents.ts";
import { openEngramExplorer, openEngramEnrollModal, openProjectDashboard } from "../../dc-engram/dc-engram.ts";
import { openSentinelViewer } from "../../dc-sentinel/views/dc-sentinel-modal.ts";
import { SentinelDatabase } from "../../dc-sentinel/core/dc-sentinel-db.ts";
import type { SentinelStats, SentinelNote } from "../../dc-sentinel/core/dc-sentinel-types.ts";
import {
  getSidebarTaxiFleet,
  formatFleetSummaryText,
  formatElapsedDuration,
  formatPassengerRole,
} from "../providers/dc-taxi-provider.ts";
import type { DcTaxiUnit } from "../../dc-agents/core/dc-ephemeral-types.ts";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";
import { getSidebarContext } from "../dc-sidebar.ts";

export function createStatusCard(reqRender: () => void): Component {
  const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
  const bloodBrightAnsi = "\x1b[38;2;255;51;51m";
  const bloodBright = (s: string) => `${bloodBrightAnsi}${s}\x1b[0m`;
  const bloodSoft = (s: string) => `\x1b[38;2;255;128;128m${s}\x1b[0m`;
  const bloodWhite = (s: string) => `\x1b[38;2;255;204;204m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
  const grayLight = (s: string) => `\x1b[38;2;150;150;150m${s}\x1b[0m`;

  // --- Bloque 1: Proyecto (Datos Reales de Git) ---
  const proj = getProjectInfo();
  const changesDisplay = proj.changesCount > 0 
    ? bloodBright(bold(proj.changesText)) 
    : dim("sin cambios");

  // Soporte RDD / Review Authority de Gentle-Pi
  const rddSnapshot = (globalThis as any)[Symbol.for("gentle-ai.review-sidebar.snapshot")];
  const rddRows = rddSnapshot ? [
    new DcJustifiedRow(
      ` 🌹 ${bloodBright(bold("RDD"))}`,
      `${bloodBright(rddSnapshot.state || "Active")} ${dim(rddSnapshot.scope ? `(${rddSnapshot.scope})` : "")} `
    )
  ] : [];

  const projectRows = [
    new DcJustifiedRow(
      ` 📁 ${bloodBright(bold("Project"))}`,
      () => {
        const p = getProjectInfo();
        return `${bloodWhite(p.displayCwd)} `;
      },
      () => {
        const ctx = getSidebarContext();
        if (ctx) {
          const p = getProjectInfo();
          void openPreviewDirectionMenu(ctx, "yazi", p.cwd);
        }
      },
    ),
    new DcJustifiedRow(
      ` 🗂️ ${bloodSoft("Branch")}`,
      () => {
        const p = getProjectInfo();
        return `${bloodWhite(`» ${p.branch}`)} `;
      },
      () => {
        const ctx = getSidebarContext();
        if (ctx) {
          const p = getProjectInfo();
          void openGitGraphViewer(ctx, p.cwd);
        }
      },
    ),
    ...rddRows,
    new DcJustifiedRow(
      ` 📂 ${bloodBright(bold("Changes"))}`, 
      () => {
        const p = getProjectInfo();
        const display = p.changesCount > 0 
          ? bloodBright(bold(p.changesText)) 
          : dim("sin cambios");
        return `${display} ${bloodBright("[↗]")} `;
      },
      () => {
        const ctx = getSidebarContext();
        if (ctx) {
          void openChangesViewer(ctx);
        }
      }
    )
  ];

  // --- Bloque 2: Engram (Desplegable interactivo con Local y Cloud) ---
  const currentProjectName = resolveEngramProjectName(undefined, proj.cwd);

  const createEngramRows = (projName: string) => {
    const engramObs = getProjectObservations(5, projName);
    const latestId = engramObs[0]?.id ? `#${engramObs[0].id}` : "#0";

    const rows: DcJustifiedRow[] = [
      new DcJustifiedRow(`     ${bloodSoft("Health:")} ${bloodBright("ok")}`, `${dim("daemon activo")} `),
      new DcJustifiedRow(
        `     ${bloodSoft("Memoria:")}`,
        `${bloodWhite(`${engramObs.length} obs`)} ${dim("·")} ${bloodSoft(`${latestId} última`)} `,
        () => {
          const ctx = getSidebarContext();
          if (ctx) void openEngramExplorer(ctx, projName);
        }
      ),
    ];

    if (engramObs.length === 0) {
      rows.push(
        new DcJustifiedRow(
          `     ${dim("•")} ${dim("(sin memorias)")}`,
          `${dim("[abrir ↗]")} `,
          () => {
            const ctx = getSidebarContext();
            if (ctx) void openEngramExplorer(ctx, projName);
          }
        )
      );
    } else {
      for (const obs of engramObs.slice(0, 2)) {
        const tShort = obs.title.length > 18 ? obs.title.slice(0, 17) + "…" : obs.title;
        rows.push(
          new DcJustifiedRow(
            `     ${dim("•")} ${bloodWhite(tShort)}`,
            `${dim(`[${obs.type}]`)} `,
            () => {
              const ctx = getSidebarContext();
              if (ctx) void openEngramExplorer(ctx, projName);
            }
          )
        );
      }
    }

    rows.push(
      new DcJustifiedRow(
        `    ⚙️ ${dim("Gestor /dc-engram")}`,
        `${bloodBright("[Alt+Shift+G ↗]")} `,
        () => {
          const ctx = getSidebarContext();
          if (ctx) void openEngramExplorer(ctx, projName);
        }
      ),
      new DcJustifiedRow(
        `    💻 ${dim("TUI nativa")}`,
        `${bloodBright("[engram tui ↗]")} `,
        () => {
          const ctx = getSidebarContext();
          if (ctx) {
            const p = getProjectInfo();
            void openPreviewDirectionMenu(ctx, "engram", p.cwd);
          }
        }
      )
    );

    return { rows, count: engramObs.length, latestId };
  };

  const initialEngramData = createEngramRows(currentProjectName);
  const isEnrolled = isProjectEnrolled(currentProjectName);

  // 2.1 Sub-desplegable Local
  const localCollapsible = new DcCollapsible({
    title: `   🖧  ${bloodWhite(bold("Local"))}`,
    collapsedInfo: dim("(127.0.0.1:7437)"),
    titleRight: (expanded) => (expanded ? dim("[↗]") : bloodSoft(initialEngramData.count ? `${initialEngramData.count} obs` : "0 obs")),
    onTitleRightClick: () => {
      const ctx = getSidebarContext();
      if (ctx) void openEngramExplorer(ctx, resolveEngramProjectName(undefined, getProjectInfo().cwd));
    },
    expanded: true,
    children: initialEngramData.rows,
    requestRender: reqRender,
  });

  // 2.2 Sub-desplegable Cloud
  const cloudHost = process.env.ENGRAM_CLOUD_SERVER ? "engram.davidcoach.dev" : "sin config";
  const autoSync = process.env.ENGRAM_CLOUD_AUTOSYNC === "1" ? bloodBright("Activo (1)") : dim("off");

  const cloudCollapsible = new DcCollapsible({
    title: `   ☁  ${bloodWhite(bold("Cloud"))}`,
    collapsedInfo: dim(`(${cloudHost})`),
    titleRight: isEnrolled ? bloodSoft("on") : bloodBright("off"),
    expanded: false,
    children: [
      new DcJustifiedRow(`     ${bloodSoft("Autosync:")}`, `${autoSync} `),
      new DcJustifiedRow(
        `     ${bloodSoft("Enroll:")}`,
        isEnrolled ? `${bloodBright("on")} ` : `${bloodBright(bold("[⚡ Enrolar]"))} ${bloodBright("off")} `,
        () => {
          const ctx = getSidebarContext();
          const targetProj = resolveEngramProjectName(undefined, getProjectInfo().cwd);
          if (ctx) void openEngramEnrollModal(ctx, targetProj);
        }
      ),
      new DcJustifiedRow(
        `     ${bloodSoft("Target:")}`,
        `${bloodBright("[↗ sync]")} `,
        () => {
          const ctx = getSidebarContext();
          const targetProj = resolveEngramProjectName(undefined, getProjectInfo().cwd);
          if (ctx) void openEngramEnrollModal(ctx, targetProj);
        }
      ),
    ],
    requestRender: reqRender,
  });

  // Cabecera Principal de Engram Reactiva
  class LiveEngramCollapsible extends DcCollapsible {
    render(width: number) {
      const liveProject = resolveEngramProjectName(undefined, getProjectInfo().cwd);
      const freshData = createEngramRows(liveProject);
      const freshEnrolled = isProjectEnrolled(liveProject);

      (localCollapsible as any).childrenStack.children = freshData.rows;
      localCollapsible.options.titleRight = (expanded) =>
        expanded ? dim("[↗]") : bloodSoft(freshData.count ? `${freshData.count} obs` : "0 obs");

      const badge = freshEnrolled ? bloodSoft("🌐 ok") : dim("🌐 off");
      this.options.titleRight = (expanded) => (expanded ? dim("[↗]") : `${badge} ${dim("[↗]")}`);
      this.options.collapsedInfo = `${bloodWhite(bold(liveProject))} ${bloodBright(`✓ ${freshData.latestId}`)}`;

      return super.render(width);
    }
  }

  const engramRightBadge = isEnrolled ? bloodSoft("🌐 ok") : dim("🌐 off");
  const engramCollapsible = new LiveEngramCollapsible({
    title: `🧠 ${bloodBright(bold("Engram:"))}`,
    collapsedInfo: `${bloodWhite(bold(currentProjectName))} ${bloodBright(`✓ ${initialEngramData.latestId}`)}`,
    titleRight: (expanded) => (expanded ? dim("[↗]") : `${engramRightBadge} ${dim("[↗]")}`),
    onTitleRightClick: () => {
      const ctx = getSidebarContext();
      const targetProj = resolveEngramProjectName(undefined, getProjectInfo().cwd);
      if (ctx) void openEngramExplorer(ctx, targetProj);
    },
    expanded: true,
    children: [
      localCollapsible,
      cloudCollapsible,
    ],
    requestRender: reqRender,
  });

  // --- Bloque 2.5: Centinela Soberano v2.0 (Líneas de Metro, Smart Frames y Procedimientos) ---
  const createSentinelRows = (projName: string, projCwd?: string) => {
    let db: SentinelDatabase | null = null;
    let stats: SentinelStats = {
      framesCount: 0,
      notesCount: 0,
      proceduresCount: 0,
      relationsCount: 0,
      activeProjects: [],
      dbPath: "",
    };
    let recentNotes: SentinelNote[] = [];

    try {
      db = new SentinelDatabase(projName, projCwd);
      stats = db.getStats(projName);
      recentNotes = db.listNotes({ project: projName, limit: 3 });
      db.close();
    } catch {
      /* fallback limpio */
    }

    const rows: DcJustifiedRow[] = [
      new DcJustifiedRow(
        `     ${bloodSoft("Motor:")} ${bloodBright("node:sqlite")}`,
        `${dim("WAL · soberano")} `
      ),
      new DcJustifiedRow(
        `     ${bloodSoft("Memoria:")}`,
        `${bloodWhite(`${stats.notesCount} notas`)} ${dim("·")} ${bloodSoft(`${stats.framesCount} frames`)} `,
        () => {
          const ctx = getSidebarContext();
          if (ctx) void openSentinelViewer(ctx, "metro");
        }
      ),
    ];

    if (recentNotes.length === 0) {
      rows.push(
        new DcJustifiedRow(
          `     ${dim("•")} ${dim("(sin notas guardadas)")}`,
          `${dim("[abrir ↗]")} `,
          () => {
            const ctx = getSidebarContext();
            if (ctx) void openSentinelViewer(ctx, "metro");
          }
        )
      );
    } else {
      for (const n of recentNotes.slice(0, 2)) {
        const glyph = n.glyph || "•";
        const tShort = n.title.length > 18 ? n.title.slice(0, 17) + "…" : n.title;
        rows.push(
          new DcJustifiedRow(
            `     ${glyph} ${bloodWhite(tShort)}`,
            `${dim(`[${n.type}]`)} `,
            () => {
              const ctx = getSidebarContext();
              if (ctx) void openSentinelViewer(ctx, "metro");
            }
          )
        );
      }
    }

    if (stats.proceduresCount > 0) {
      rows.push(
        new DcJustifiedRow(
          `     ${bloodSoft("Recetas:")} ${bloodWhite(`${stats.proceduresCount} auto-skills`)}`,
          `${bloodBright("[ver ↗]")} `,
          () => {
            const ctx = getSidebarContext();
            if (ctx) void openSentinelViewer(ctx, "procedures");
          }
        )
      );
    }

    rows.push(
      new DcJustifiedRow(
        `    🚇 ${dim("Líneas de Metro")}`,
        `${bloodBright("[Alt+Shift+S ↗]")} `,
        () => {
          const ctx = getSidebarContext();
          if (ctx) void openSentinelViewer(ctx, "metro");
        }
      ),
      new DcJustifiedRow(
        `    📜 ${dim("Registro de Vuelo")}`,
        `${bloodBright("[turno ↗]")} `,
        () => {
          const ctx = getSidebarContext();
          if (ctx) void openSentinelViewer(ctx, "session");
        }
      )
    );

    return { rows, stats };
  };

  class LiveSentinelCollapsible extends DcCollapsible {
    render(width: number) {
      const liveCwd = getProjectInfo().cwd;
      const liveProject = path.basename(liveCwd) || "default";
      const freshData = createSentinelRows(liveProject, liveCwd);

      (this as any).childrenStack.children = freshData.rows;
      this.options.titleRight = (expanded) =>
        expanded ? dim("[↗]") : bloodSoft(`${freshData.stats.notesCount} notas · ${freshData.stats.framesCount} frames`);
      this.options.collapsedInfo = `${bloodWhite(bold(liveProject))} ${bloodBright(`✓ ${freshData.stats.notesCount} notas`)}`;

      return super.render(width);
    }
  }

  const initialSentinelData = createSentinelRows(currentProjectName, proj.cwd);

  const sentinelCollapsible = new LiveSentinelCollapsible({
    title: `⛩️ ${bloodBright(bold("Centinela:"))}`,
    collapsedInfo: `${bloodWhite(bold(currentProjectName))} ${bloodBright(`✓ ${initialSentinelData.stats.notesCount} notas`)}`,
    titleRight: (expanded) =>
      expanded ? dim("[↗]") : bloodSoft(`${initialSentinelData.stats.notesCount} notas · ${initialSentinelData.stats.framesCount} frames`),
    onTitleRightClick: () => {
      const ctx = getSidebarContext();
      if (ctx) void openSentinelViewer(ctx, "metro");
    },
    expanded: true,
    children: initialSentinelData.rows,
    requestRender: reqRender,
  });

  // --- Bloque 3: Quota (Conectado al bridge :8325) ---
  type QuotaAccount = ReturnType<typeof getCachedAccountQuotas>[number];
  const createQuotaRows = (initial: QuotaAccount, collapsed: boolean) => {
    let account = initial;
    return {
      setAccount(next: QuotaAccount) {
        account = next;
      },
      render(width: number) {
        if (collapsed) {
          const available = account.entries
            .filter((entry) => typeof entry?.pctLeft === "number")
            .map((entry) => `${entry.pctLeft}%`);
          const summaryText = available.length > 0 ? available.join("/") : "100%";
          const collapsedRestante = `${bloodBright("▰▰▱▱▱▱▱▱")} ${bloodWhite(summaryText)} `;
          return new DcVStack([
            new DcJustifiedRow(`      ${bloodSoft("Restante")}`, collapsedRestante),
          ]).render(width);
        }

        return new DcVStack(account.entries.map((entry) => {
          const isFallback = entry.pctLeft === 100 && entry.pctUsed === 0 && !entry.resetStr;
          const barColor = isFallback ? "\x1b[38;2;100;100;100m" : bloodBrightAnsi;
          const bar = renderProgressBar(entry.pctLeft, 8, "▰", "▱", barColor);
          const valueStr = `${entry.pctLeft}%`;
          return new DcJustifiedRow(
            `      ${bloodSoft(entry.label + ":")}`,
            `${bar} ${bloodWhite(valueStr)} `
          );
        })).render(width);
      },
      invalidate() {},
    };
  };

  class QuotaProviderList implements Component {
    public children: DcCollapsible[] = [];
    private stack = new DcVStack([]);
    private providers = new Map<string, {
      collapsible: DcCollapsible;
      rows: ReturnType<typeof createQuotaRows>;
      summary: ReturnType<typeof createQuotaRows>;
    }>();

    update(accounts: QuotaAccount[]) {
      this.children = accounts.map((account, idx) => {
        let provider = this.providers.get(account.prefix);
        if (!provider) {
          const rows = createQuotaRows(account, false);
          const summary = createQuotaRows(account, true);
          provider = {
            rows,
            summary,
            collapsible: new DcCollapsible({
              title: `   🎚️ ${bloodWhite(bold(account.prefix))} ${bloodSoft("(" + account.family + ")")}`,
              titleRight: "5h / semanal",
              expanded: idx === 0,
              children: [rows],
              collapsedChildren: [summary],
              requestRender: reqRender,
            }),
          };
          this.providers.set(account.prefix, provider);
        }
        provider.rows.setAccount(account);
        provider.summary.setAccount(account);
        provider.collapsible.options.title = `   🎚️ ${bloodWhite(bold(account.prefix))} ${bloodSoft("(" + account.family + ")")}`;
        return provider.collapsible;
      });
      this.stack.children = this.children;
    }

    render(width: number) {
      return this.stack.render(width);
    }

    handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
      return this.stack.handleMouse(event);
    }

    invalidate() {
      this.stack.invalidate();
    }
  }

  const quotaAccounts = getCachedAccountQuotas(reqRender);
  const providerList = new QuotaProviderList();
  providerList.update(quotaAccounts);

  class LiveQuotaCollapsible extends DcCollapsible {
    render(width: number) {
      const latestAccounts = getCachedAccountQuotas(reqRender);
      providerList.update(latestAccounts);
      const primaryCollapsed = latestAccounts[0]?.collapsedSummary ?? "ac06-100%-100%";
      this.options.collapsedInfo = bloodWhite(bold(primaryCollapsed));
      return super.render(width);
    }
  }

  const quotaCollapsible = new LiveQuotaCollapsible({
    title: `🧮 ${bloodBright(bold("Quota:"))}`,
    collapsedInfo: bloodWhite(bold(quotaAccounts[0]?.collapsedSummary ?? "ac06-100%-100%")),
    titleRight: dim("[↗]"),
    onTitleRightClick: () => {
      const ctx = getSidebarContext();
      if (ctx) {
        void openQuotaViewer(ctx);
      }
    },
    expanded: false,
    children: [
      providerList,
      new DcJustifiedRow(
        `    ⚙️ ${dim("Gestor /quota")}`, 
        `${dim("[abrir ↗]")} `,
        () => {
          const ctx = getSidebarContext();
          if (ctx) {
            void openQuotaViewer(ctx);
          }
        }
      )
    ],
    requestRender: reqRender
  });

  // --- Bloque 4: Taxis (Flota de subagentes y orquestador) ---
  const createTaxiUnitRows = (unit: DcTaxiUnit) => {
    if (unit.status === "ocupado" && unit.passenger) {
      const p = unit.passenger;
      const role = formatPassengerRole(p);
      const rawTask = p.taskLabel || "tarea en ejecución";
      const taskShort = rawTask.length > 20 ? rawTask.slice(0, 19) + "…" : rawTask;
      const modelRaw = p.model || "gemini-3.8-flash";
      const modelClean = modelRaw.split("/").pop() || modelRaw;
      const elapsed = formatElapsedDuration(p.startedAt);
      const pidStr = p.pid ? `PID ${p.pid}` : "PID -";

      return [
        new DcJustifiedRow(`      ${bloodSoft("Pasajero:")}`, `${bloodWhite(role)} `),
        new DcJustifiedRow(`      ${bloodSoft("Tarea:")}`, `${bloodWhite(taskShort)} `),
        new DcJustifiedRow(`      ${bloodSoft("Modelo:")}`, `${bloodSoft(modelClean)} `),
        new DcJustifiedRow(`      ${bloodSoft("Proceso:")}`, `${dim(`${pidStr} · ${elapsed}`)} `),
        new DcJustifiedRow(
          `      ${dim("Telemetría en vivo")}`,
          `${bloodBright("[Alt+Shift+T ↗]")} `,
          () => {
            const currentCtx = getSidebarContext();
            if (currentCtx) void openTaxisViewer(currentCtx);
          }
        ),
      ];
    }

    if (unit.status === "recargando") {
      return [
        new DcJustifiedRow(`      ${bloodSoft("Estado:")}`, `${bloodBright("cuota baja (<5%)")} `),
        new DcJustifiedRow(`      ${bloodSoft("Recarga:")}`, `${dim("esperando cuota >=60%")} `),
      ];
    }

    // Libre
    return [
      new DcJustifiedRow(`      ${bloodSoft("Estado:")}`, `${bloodWhite("disponible")} `),
      new DcJustifiedRow(`      ${bloodSoft("Asignación:")}`, `${dim("sin pasajero activo")} `),
    ];
  };

  class TaxiUnitList implements Component {
    public children: DcCollapsible[] = [];
    private stack = new DcVStack([]);
    private unitsMap = new Map<string, {
      collapsible: DcCollapsible;
      rowsStack: DcVStack;
    }>();

    update(units: DcTaxiUnit[]) {
      this.children = units.map((unit) => {
        let entry = this.unitsMap.get(unit.account);
        const rows = createTaxiUnitRows(unit);
        
        let titleBadge = bloodSoft("○ libre");
        let titleExtra = dim("(libre)");
        if (unit.status === "ocupado") {
          const role = unit.passenger ? formatPassengerRole(unit.passenger) : "ocupado";
          titleBadge = bloodBright("● ocupado");
          titleExtra = bloodSoft(`[${role}]`);
        } else if (unit.status === "recargando") {
          titleBadge = bloodBright("◐ recarga");
          titleExtra = dim("(<5%)");
        }

        const titleText = `   🚕 ${bloodWhite(bold(unit.account))} ${titleExtra}`;

        if (!entry) {
          const rowsStack = new DcVStack(rows);
          const collapsible = new DcCollapsible({
            title: titleText,
            titleRight: titleBadge,
            expanded: unit.status === "ocupado",
            children: [rowsStack],
            requestRender: reqRender,
          });
          entry = { collapsible, rowsStack };
          this.unitsMap.set(unit.account, entry);
        } else {
          entry.rowsStack.children = rows;
          entry.collapsible.options.title = titleText;
          entry.collapsible.options.titleRight = titleBadge;
        }

        return entry.collapsible;
      });
      this.stack.children = this.children;
    }

    render(width: number) {
      return this.stack.render(width);
    }

    handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
      return this.stack.handleMouse(event);
    }

    invalidate() {
      this.stack.invalidate();
    }
  }

  const initialFleet = getSidebarTaxiFleet();
  const taxiUnitList = new TaxiUnitList();
  taxiUnitList.update(initialFleet.units);

  class LiveTaxisCollapsible extends DcCollapsible {
    render(width: number) {
      const latestFleet = getSidebarTaxiFleet();
      taxiUnitList.update(latestFleet.units);
      this.options.collapsedInfo = bloodWhite(bold(latestFleet.summaryText));
      return super.render(width);
    }
  }

  const taxisCollapsible = new LiveTaxisCollapsible({
    title: `🚕 ${bloodBright(bold("Taxis:"))}`,
    collapsedInfo: bloodWhite(bold(initialFleet.summaryText)),
    titleRight: dim("[↗]"),
    onTitleRightClick: () => {
      const ctx = getSidebarContext();
      if (ctx) {
        void openTaxisViewer(ctx);
      }
    },
    expanded: false,
    children: [
      taxiUnitList,
      new DcJustifiedRow(
        `    ⚙️ ${dim("Gestor /dc-taxis")}`,
        `${bloodBright("[Alt+Shift+T ↗]")} `,
        () => {
          const ctx = getSidebarContext();
          if (ctx) {
            void openTaxisViewer(ctx);
          }
        }
      )
    ],
    requestRender: reqRender,
  });

  // --- Bloque 5: Profile (Desplegable y switch interactivo) ---
  const profilesInfo = readProfilesInfo();
  const profileRows = profilesInfo.profiles.map((p) => {
    if (p.isActive) {
      return new DcJustifiedRow(
        `    ${bloodBright("●")} ${bloodBright(bold(p.name))}`,
        `${bloodBright("[activo]")} `
      );
    }
    return new DcJustifiedRow(
      `    ${dim("○")} ${bloodSoft(p.name)}`,
      `${dim("[cambiar]")} `,
      () => {
        const success = switchActiveProfile(p.name);
        if (success) {
          reqRender();
        }
      }
    );
  });

  const profileCollapsible = new DcCollapsible({
    title: `🎛️ ${bloodBright(bold("Profile:"))}`,
    collapsedInfo: bloodWhite(profilesInfo.activeProfile || "default"),
    titleRight: dim("[↗]"),
    onTitleRightClick: () => {
      const ctx = getSidebarContext();
      void executeSlashCommand(ctx, "/gentle:profiles", "Perfiles");
    },
    expanded: true,
    children: [
      ...profileRows,
      new DcJustifiedRow(
        `    ⚙️ ${dim("Gestor /gentle:profiles")}`, 
        `${dim("[abrir ↗]")} `,
        () => {
          const ctx = getSidebarContext();
          void executeSlashCommand(ctx, "/gentle:profiles", "Perfiles");
        }
      )
    ],
    requestRender: reqRender
  });

  // --- Bloque 6: MCP (Desplegable) ---
  const mcpInfo = getMcpServersInfo();
  const mcpRows = mcpInfo.servers.map((s) => {
    if (s.disabled) {
      return new DcJustifiedRow(
        `    ${grayLight("○")} ${grayLight(s.name)}`,
        `${grayLight("disabled")} `
      );
    }
    const toolsStr = typeof s.toolsCount === "number"
      ? `${s.toolsCount} tool${s.toolsCount === 1 ? "" : "s"}`
      : "ready";
    return new DcJustifiedRow(
      `    ${bloodSoft("●")} ${bloodWhite(s.name)}`,
      `${dim(toolsStr)} `
    );
  });

  const mcpCollapsedSummary = mcpInfo.disabledCount > 0
    ? `${mcpInfo.enabledCount} enabled · ${mcpInfo.disabledCount} disabled`
    : `${mcpInfo.enabledCount} servers enabled`;

  const mcpCollapsible = new DcCollapsible({
    title: `🔌 ${bloodBright(bold("MCP:"))}`,
    collapsedInfo: bloodSoft(mcpCollapsedSummary),
    titleRight: dim("[↗]"),
    onTitleRightClick: () => {
      const ctx = getSidebarContext();
      void executeSlashCommand(ctx, "/mcp", "MCP");
    },
    expanded: true,
    children: [
      ...mcpRows,
      new DcJustifiedRow(
        `    ⚙️ ${dim("Gestor /mcp")}`, 
        `${dim("[abrir ↗]")} `,
        () => {
          const ctx = getSidebarContext();
          void executeSlashCommand(ctx, "/mcp", "MCP");
        }
      )
    ],
    requestRender: reqRender
  });

  const statusContent = new DcVStack([
    ...projectRows,
    new DcText("─"),
    engramCollapsible,
    new DcText("─"),
    sentinelCollapsible,
    new DcText("─"),
    quotaCollapsible,
    new DcText("─"),
    taxisCollapsible,
    new DcText("─"),
    profileCollapsible,
    new DcText("─"),
    mcpCollapsible
  ]);

  return new DcSidebarCard({
    glyph: "🗃 ",
    title: "Status",
    content: statusContent,
    paddingX: 1,
  });
}
