import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { renderDcBanner } from "./dc-banner-art.ts";

export class DcBannerComponent implements Component {
  invalidate(): void {}

  render(width: number): string[] {
    return renderDcBanner(width);
  }
}

export default function dcBannerExtension(pi: ExtensionAPI): void {
  let dismissed = false;
  let activeCtx: ExtensionContext | undefined;

  const hideBanner = () => {
    if (dismissed || !activeCtx) return;
    dismissed = true;
    try {
      // Usar un header vacío en lugar de undefined para no restaurar el builtInHeader nativo de Pi
      activeCtx.ui.setHeader(() => ({
        render: () => [],
        invalidate: () => {},
      }));
    } catch {
      /* ignore */
    }
  };

  pi.on("session_start", (_event, ctx) => {
    activeCtx = ctx;
    dismissed = false;
    if (ctx.hasUI && ctx.mode === "tui") {
      try {
        ctx.ui.setHeader(() => new DcBannerComponent());
      } catch {
        /* ignore */
      }
    }
  });

  // Automatically dismiss the banner once the user interacts or sends a prompt
  pi.on("input", () => {
    hideBanner();
  });

  pi.on("agent_start", () => {
    hideBanner();
  });

  pi.on("session_shutdown", () => {
    dismissed = true;
  });

  pi.registerCommand("dc-banner", {
    description: "Mostrar el logo oficial de DC Studio en el header",
    handler: async (_args, ctx) => {
      activeCtx = ctx;
      dismissed = false;
      if (ctx.hasUI) {
        ctx.ui.setHeader(() => new DcBannerComponent());
      }
    },
  });
}
