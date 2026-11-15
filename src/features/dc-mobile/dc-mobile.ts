import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import {
  DC_ADB_UNAVAILABLE_MESSAGE,
  DcAdbDriver,
} from "./core/dc-adb-driver.ts";
import { getLatestFramePath } from "./core/dc-mobile-viewer.ts";
import { loadConnectionPrefs, saveConnectionPrefs } from "./core/dc-mobile-connection.ts";
import {
  createDcMobileSupervisedDriver,
  discoverMdnsAddresses,
  ensureUsbAutoAttach,
} from "./core/dc-mobile-supervisor.ts";
import { openDcMobileConnectModal } from "./views/dc-mobile-connect-modal.ts";
import { registerDcMobileTools } from "./tools/dc-mobile-tools.ts";
import { existsSync } from "node:fs";

/**
 * Extensión dc-mobile para Pi y DC Studio.
 * - Registra dc_adb_devices, dc_mobile_screen_inspect, dc_mobile_action y dc_mobile_connect.
 * - Comando /dc-mobile y atajo Alt+Shift+M: sin dispositivo activo abre el selector
 *   USB/Wi-Fi; con dispositivo conectado reporta estado y último frame (S10).
 */
export default function dcMobileExtension(pi: ExtensionAPI): void {
  registerDcMobileTools(pi);

  pi.registerCommand("dc-mobile", {
    description: "DC Studio: Android devices and last captured frame",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      await runDcMobilePanel(ctx);
    },
  });

  try {
    pi.registerShortcut("alt+shift+m" as never, {
      description: "DC Studio: panel de conexión Android",
      handler: async (ctx: ExtensionContext) => {
        await runDcMobilePanel(ctx);
      },
    });
  } catch {
    // Graceful fallback: older Pi builds without shortcut support.
  }
}

/**
 * Shared entry point for the command and the keybinding, so both surfaces stay
 * in sync: connection chooser when idle, status report when connected.
 */
async function runDcMobilePanel(ctx: ExtensionContext): Promise<void> {
  const driver = new DcAdbDriver();

  if (!driver.isAvailable()) {
    if (ctx.hasUI) {
      dcNotifier.notify(ctx, "DC Mobile", DC_ADB_UNAVAILABLE_MESSAGE, "error");
    }
    return;
  }

  try {
    const devices = driver.listDevices();
    const activeDevices = devices.filter((device) => device.state === "device");

    if (activeDevices.length === 0) {
      if (!ctx.hasUI || ctx.mode !== "tui") {
        dcNotifier.notify(ctx, "DC Mobile", "No hay dispositivos conectados.", "warning");
        return;
      }

      // Discovery is wired in so a successful pairing reaches the
      // advertised connect port without a second address prompt.
      const result = await openDcMobileConnectModal(ctx, createDcMobileSupervisedDriver());

      if (!result) {
        dcNotifier.notify(ctx, "DC Mobile", "Conexión cancelada.", "warning");
        return;
      }

      // S11: a pairing that already succeeded survives the reload even when
      // the final connect failed or the user leaves the wizard afterwards.
      if (!result.ok && result.pairedHost) {
        saveConnectionPrefs({
          pairedHosts: Array.from(
            new Set([
              ...(loadConnectionPrefs().pairedHosts ?? []),
              result.pairedHost,
            ]),
          ),
        });
      }

      if (result.cancelled) {
        dcNotifier.notify(ctx, "DC Mobile", result.message, "warning");
        return;
      }

      if (!result.ok) {
        dcNotifier.notify(
          ctx,
          "DC Mobile",
          result.message,
          result.guided ? "warning" : "error",
        );
        return;
      }

      saveConnectionPrefs({
        lastSerial: result.serial ?? "",
        mode: result.mode ?? "usb",
        ...(result.lastWifiAddress
          ? { lastWifiAddress: result.lastWifiAddress }
          : {}),
        // S11: a successful pairing survives the reload, without duplicates.
        ...(result.pairedHost
          ? {
              pairedHosts: Array.from(
                new Set([
                  ...(loadConnectionPrefs().pairedHosts ?? []),
                  result.pairedHost,
                ]),
              ),
            }
          : {}),
      });
      if ((result.mode ?? "usb") === "usb") {
        // S16: a successful USB connection keeps auto-attach alive.
        ensureUsbAutoAttach();
      }
      dcNotifier.notify(ctx, "DC Mobile", result.message, "info");
      return;
    }

    const lines = devices.map((device) => {
      const latestPath = getLatestFramePath(device.serial);
      const frame = existsSync(latestPath) ? latestPath : "sin captura";
      return `${device.serial} · ${device.state} · ${device.model} · frame: ${frame}`;
    });

    const summary = `${devices.length} dispositivo(s):\n${lines.join("\n")}`;
    if (ctx.hasUI) {
      dcNotifier.notify(ctx, "DC Mobile", summary, "info");
    }
    dcNotifier.notifyHerdr("DC Mobile", summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (ctx.hasUI) {
      dcNotifier.notify(ctx, "DC Mobile", message, "error");
    }
  }
}
