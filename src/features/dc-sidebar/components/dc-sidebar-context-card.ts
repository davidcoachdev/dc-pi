import type { Component } from "@earendil-works/pi-tui";
import { DcSidebarCard } from "../../../ui/dc-sidebar-card.ts";
import { DcVStack } from "../../../ui/dc-vstack.ts";
import { renderProgressBar } from "../../../ui/dc-progress-bar.ts";
import { DcJustifiedRow } from "../views/dc-sidebar-body.ts";
import { getContextUsageInfo } from "../providers/dc-context-provider.ts";

export function createContextCard(): Component {
  const bloodSoft = (s: string) => `\x1b[38;2;255;128;128m${s}\x1b[0m`;
  const bloodWhite = (s: string) => `\x1b[38;2;255;204;204m${s}\x1b[0m`;
  const bloodBright = (s: string) => `\x1b[38;2;255;51;51m${s}\x1b[0m`;
  const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

  const contextUsage = getContextUsageInfo();
  const contextLevelColor =
    contextUsage.pct > 80
      ? "\x1b[38;2;255;51;51m" // Crítico (rojo brillante)
      : contextUsage.pct > 60
        ? "\x1b[38;2;255;102;102m" // Alto
        : contextUsage.pct > 40
          ? "\x1b[38;2;255;160;160m" // Medio
          : "\x1b[38;2;255;255;255m"; // Óptimo (blanco)

  const contextBar = renderProgressBar(contextUsage.pct, 32, "▰", "▱", contextLevelColor);

  const contextContent = new DcVStack([
    new DcJustifiedRow(
      ` ${bloodWhite(contextUsage.tokStr)} ${dim("/")} ${bloodSoft(contextUsage.winStr + " tokens")}`, 
      `${contextLevelColor}● ${contextUsage.stateLabel}\x1b[0m ${bloodBright(bold("[" + contextUsage.pct + "%]"))} `
    ),
    new DcJustifiedRow(
      ` ${contextBar}`, 
      ""
    ),
    new DcJustifiedRow(
      ` ${bloodSoft("↑")} ${bloodWhite(contextUsage.inStr + " in")} ${dim("·")} ${bloodSoft("↓")} ${bloodWhite(contextUsage.outStr + " out")}`, 
      `${bloodSoft("Cost")} ${bloodWhite(contextUsage.costStr)} `
    )
  ]);

  return new DcSidebarCard({
    glyph: "📊",
    title: "Context",
    content: contextContent,
    paddingX: 1,
  });
}
