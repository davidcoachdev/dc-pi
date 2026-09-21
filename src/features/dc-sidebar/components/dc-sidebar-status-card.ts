import type { Component } from "@earendil-works/pi-tui";
import { DcSidebarCard } from "../../../ui/dc-sidebar-card.ts";
import { DcVStack } from "../../../ui/dc-vstack.ts";
import { DcText } from "../../../ui/dc-text.ts";
import { DcCollapsible } from "../../../ui/dc-collapsible.ts";
import { renderProgressBar } from "../../../ui/dc-progress-bar.ts";
import { DcJustifiedRow } from "../views/dc-sidebar-body.ts";
import { getProjectInfo } from "../providers/dc-project-provider.ts";
import { getCachedAccountQuotas } from "../providers/dc-quota-provider.ts";
import { readProfilesInfo, switchActiveProfile } from "../providers/dc-profile-provider.ts";
import { getMcpServersInfo } from "../providers/dc-mcp-provider.ts";
import { executeSlashCommand } from "../../../core/dc-command-executor.ts";
import { openChangesViewer } from "../../dc-changes/dc-changes.ts";
import { openQuotaViewer } from "../../dc-quota/dc-quota.ts";
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

  const projectRows = [
    new DcJustifiedRow(` 📁 ${bloodBright(bold("Project"))}`, `${bloodWhite(proj.displayCwd)} `),
    new DcJustifiedRow(` 🗂️ ${bloodSoft("Branch")}`, `${bloodWhite(`» ${proj.branch}`)} `),
    new DcJustifiedRow(
      ` 📂 ${bloodBright(bold("Changes"))}`, 
      `${changesDisplay} ${bloodBright("[↗]")} `,
      () => {
        const ctx = getSidebarContext();
        if (ctx) {
          void openChangesViewer(ctx);
        }
      }
    )
  ];

  // --- Bloque 2: Sesión y LSP ---
  const sessionRows = [
    new DcJustifiedRow(` 🧠 ${bloodWhite("lab-00")}`, `${dim("· ready")} `),
    new DcJustifiedRow(` 📚 ${bloodBright(bold("LSP:"))} ${bloodSoft("inactivo")}`, `${dim("[off]")} `)
  ];

  // --- Bloque 3: Quota (Conectado al bridge :8325) ---
  const quotaAccounts = getCachedAccountQuotas(reqRender);
  const providerCollapsibles = quotaAccounts.map((acc, idx) => {
    const childrenRows: DcJustifiedRow[] = [];
    let summary5h = "";
    let summaryWeek = "";

    for (const entry of acc.entries) {
      const bar = renderProgressBar(entry.pctLeft, 8, "▰", "▱", bloodBrightAnsi);
      const resetLabel = entry.resetStr ? ` ${dim("(" + entry.resetStr + ")")}` : "";
      childrenRows.push(
        new DcJustifiedRow(
          `      ${bloodSoft(entry.label + ":")}`,
          `${bar} ${bloodWhite(entry.pctLeft + "%")}${resetLabel} `
        )
      );
      if (entry.label === "5h") summary5h = `${entry.pctLeft}%`;
      if (entry.label === "Sem") summaryWeek = `${entry.pctLeft}%`;
    }

    const collapsedRestante = summary5h && summaryWeek
      ? `${bloodBright("▰▰▱▱▱▱▱▱")} ${bloodWhite(summary5h)} ${bloodSoft("sem")} ${bloodWhite(summaryWeek)} `
      : `${bloodBright("▰▰▱▱▱▱▱▱")} ${bloodWhite(summary5h || summaryWeek || "100%")} `;

    return new DcCollapsible({
      title: `   🎚️ ${bloodWhite(bold(acc.prefix))} ${bloodSoft("(" + acc.family + ")")}`,
      titleRight: "5h / semanal",
      expanded: idx === 0,
      children: childrenRows,
      collapsedChildren: [
        new DcJustifiedRow(`      ${bloodSoft("Restante")}`, collapsedRestante)
      ],
      requestRender: reqRender
    });
  });

  const primaryCollapsed = quotaAccounts[0]?.collapsedSummary ?? "ac06-100%-100%";

  const quotaCollapsible = new DcCollapsible({
    title: `🧮 ${bloodBright(bold("Quota:"))}`,
    collapsedInfo: bloodWhite(bold(primaryCollapsed)),
    titleRight: dim("[↗]"),
    expanded: false,
    children: [
      ...providerCollapsibles,
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

  // --- Bloque 4: Profile (Desplegable y switch interactivo) ---
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

  // --- Bloque 5: MCP (Desplegable) ---
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
    ...sessionRows,
    new DcText("─"),
    quotaCollapsible,
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
