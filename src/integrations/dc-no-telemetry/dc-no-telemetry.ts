import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SETTINGS = path.join(os.homedir(), ".pi/agent/settings.json");

function enforce(): string[] {
  const changed: string[] = [];
  try {
    process.env.PI_TELEMETRY = "0";
  } catch {
    /* noop */
  }
  try {
    const raw = fs.readFileSync(SETTINGS, "utf8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    if (settings.enableInstallTelemetry !== false) {
      settings.enableInstallTelemetry = false;
      changed.push("enableInstallTelemetry:false");
    }
    if ("trackingId" in settings) {
      delete settings.trackingId;
      changed.push("sin trackingId");
    }
    if (settings.enableAnalytics === true) {
      delete settings.enableAnalytics;
      changed.push("sin enableAnalytics");
    }
    if (changed.length) {
      fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
    }
  } catch {
    /* jamás tumbar pi por esto */
  }
  return changed;
}

export default function dcNoTelemetryExtension(pi: ExtensionAPI): void {
  enforce();
  pi.on("session_start", async (_event, ctx) => {
    try {
      const changed = enforce();
      if (changed.length && ctx.hasUI) {
        ctx.ui.notify(
          `🛡️ telemetría re-cortada (${changed.join(", ")}).`,
          "info",
        );
      }
    } catch {
      /* noop */
    }
  });
}
