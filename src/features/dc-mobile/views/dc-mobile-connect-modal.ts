import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { openDcModal } from "../../../ui/dc-modal.ts";
import {
  DC_ADB_UNAVAILABLE_MESSAGE,
} from "../core/dc-adb-driver.ts";
import {
  connectUsb,
  connectWifi,
  createDcMobileConnectionDriver,
  isValidWifiAddress,
  loadConnectionPrefs,
  pairWifi,
  type DcMobileConnectionDriver,
  type DcMobileConnectionMode,
  type DcMobileConnectionOutcome,
  type DcMobileConnectionPrefs,
} from "../core/dc-mobile-connection.ts";
import {
  discoverMdnsAddresses,
  ensureUsbAutoAttach,
} from "../core/dc-mobile-supervisor.ts";

/** Exact S10 window title. */
export const DC_MOBILE_CONNECT_TITLE = "📱 DC Mobile — Conexión";

export type DcMobileConnectChoice = "usb" | "wifi" | "pair" | "cancel";

export interface DcMobileConnectOption {
  id: DcMobileConnectChoice;
  label: string;
}

/** Exact S10 option order. */
export const DC_MOBILE_CONNECT_OPTIONS: readonly DcMobileConnectOption[] = [
  { id: "usb", label: "USB · detectar dispositivo" },
  { id: "wifi", label: "Wi-Fi · ingresar IP:puerto" },
  { id: "pair", label: "Wi-Fi · vincular con código" },
  { id: "cancel", label: "Cancelar" },
];

export interface DcMobileConnectResult {
  ok: boolean;
  cancelled?: boolean;
  guided?: boolean;
  mode?: DcMobileConnectionMode;
  serial?: string;
  lastWifiAddress?: string;
  message: string;
}

type WizardStep = "choose" | "address" | "code";

export interface DcMobileConnectWizardOptions {
  driver: DcMobileConnectionDriver;
  prefs: DcMobileConnectionPrefs;
  theme: Theme;
  done: (result: DcMobileConnectResult) => void;
  requestRender: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wrapText(text: string, width: number): string[] {
  const contentWidth = Math.max(10, width);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (visibleWidth(candidate) <= contentWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length === 0) lines.push("");

  return lines;
}

/**
 * Single-window wizard for S10–S12: the chooser, the Wi-Fi address prompt and
 * the pairing-code prompt share the same floating DcWindow, so Escape always
 * closes one modal and never leaves a second overlay hanging.
 */
export class DcMobileConnectWizard implements Component {
  private step: WizardStep = "choose";
  private selectedIndex: number;
  private address: string;
  private code = "";
  private error = "";
  private notice = "";
  private mode: "wifi" | "pair" = "wifi";
  private pairAddress = "";
  private retryConnect = false;

  constructor(private readonly options: DcMobileConnectWizardOptions) {
    this.selectedIndex = options.prefs.mode === "wifi" ? 1 : 0;
    this.address = options.prefs.lastWifiAddress;
  }

  invalidate(): void {}

  private requestRender(): void {
    this.options.requestRender();
  }

  private finish(result: DcMobileConnectResult): void {
    this.options.done(result);
  }

  private cancel(): void {
    this.finish({ ok: false, cancelled: true, message: "Conexión cancelada." });
  }

  private selectUsb(): void {
    const { driver } = this.options;

    try {
      if (!driver.isAvailable()) {
        this.finish({ ok: false, mode: "usb", message: DC_ADB_UNAVAILABLE_MESSAGE });
        return;
      }

      const outcome = connectUsb(driver);
      // S16: keep usbipd attached so a replug self-heals without UAC.
      if (outcome.ok) {
        ensureUsbAutoAttach();
      }
      this.finish({
        ok: outcome.ok,
        guided: outcome.guided,
        mode: "usb",
        serial: outcome.serial,
        message: outcome.message,
      });
    } catch (error) {
      this.finish({ ok: false, mode: "usb", message: errorMessage(error) });
    }
  }

  private selectChoice(id: DcMobileConnectChoice): void {
    if (id === "cancel") {
      this.cancel();
      return;
    }

    if (id === "usb") {
      this.selectUsb();
      return;
    }

    this.mode = id === "pair" ? "pair" : "wifi";
    this.step = "address";
    this.error = "";

    if (this.mode === "pair") {
      this.notice =
        "Dirección IP:puerto que muestra la pantalla de vinculación inalámbrica.";
    } else {
      // S17: a discovered phone can be connected without typing its port.
      const discovered = discoverMdnsAddresses()[0];
      if (discovered) {
        this.address = discovered;
        this.notice = `Detectado por mDNS: ${discovered}. Enter para conectar.`;
      } else {
        this.notice = "";
      }
    }

    this.requestRender();
  }

  private submitAddress(): void {
    const address = this.address.trim();

    if (!isValidWifiAddress(address)) {
      this.error = "Dirección inválida: usá host:puerto, por ejemplo 192.168.1.50:5555 (puerto 1-65535).";
      this.requestRender();
      return;
    }

    this.error = "";
    this.address = address;

    if (this.mode === "wifi" || this.retryConnect) {
      const outcome = connectWifi(this.options.driver, address);
      this.finish(this.wifiResult(address, outcome));
      return;
    }

    this.pairAddress = address;
    this.step = "code";
    this.code = "";
    this.notice = `Vinculando ${address}.`;
    this.requestRender();
  }

  private submitCode(): void {
    if (!/^\d{6}$/.test(this.code)) {
      this.error = "Código inválido: ingresá los 6 dígitos que muestra el dispositivo.";
      this.requestRender();
      return;
    }

    this.error = "";
    const outcome = pairWifi(this.options.driver, this.pairAddress, this.code);

    if (outcome.ok) {
      this.finish(this.wifiResult(this.pairAddress, outcome));
      return;
    }

    if (!outcome.paired) {
      this.finish(this.wifiResult(this.pairAddress, outcome));
      return;
    }

    // Pairing worked but the follow-up connect failed (S12): the pairing port
    // closes, so ask for the port shown on the main wireless-debugging screen.
    const host = this.pairAddress.slice(0, this.pairAddress.lastIndexOf(":"));
    this.address = `${host}:`;
    this.retryConnect = true;
    this.step = "address";
    this.code = "";
    this.error = "";
    this.notice =
      `${outcome.message} Ingresá ahora el puerto de la pantalla principal.`;
    this.requestRender();
  }

  private wifiResult(
    address: string,
    outcome: DcMobileConnectionOutcome,
  ): DcMobileConnectResult {
    return {
      ok: outcome.ok,
      mode: "wifi",
      serial: outcome.serial,
      lastWifiAddress: address,
      message: this.retryConnect && !outcome.ok
        ? `El puerto de vinculación se cerró y el connect al puerto principal falló: ${outcome.message}`
        : outcome.message,
    };
  }

  private insertChar(data: string): void {
    if (data.startsWith("\x1b")) return;
    const clean = data.replace(/[\x00-\x1f\x7f]/g, "");
    if (!clean) return;

    if (this.step === "code") {
      const digits = clean.replace(/\D/g, "");
      if (!digits) return;
      this.code = (this.code + digits).slice(0, 6);
    } else {
      this.address = (this.address + clean).slice(0, 80);
    }
    this.requestRender();
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.escape)) {
      this.cancel();
      return true;
    }

    if (this.step === "choose") {
      const total = DC_MOBILE_CONNECT_OPTIONS.length;

      if (matchesKey(data, Key.up) || data === "up") {
        this.selectedIndex = (this.selectedIndex - 1 + total) % total;
        this.requestRender();
        return true;
      }

      if (matchesKey(data, Key.down) || data === "down") {
        this.selectedIndex = (this.selectedIndex + 1) % total;
        this.requestRender();
        return true;
      }

      if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
        const option = DC_MOBILE_CONNECT_OPTIONS[this.selectedIndex];
        if (option) this.selectChoice(option.id);
        return true;
      }

      return false;
    }

    if (matchesKey(data, Key.enter)) {
      if (this.step === "address") this.submitAddress();
      else this.submitCode();
      return true;
    }

    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      if (this.step === "code") {
        if (this.code.length > 0) {
          this.code = this.code.slice(0, -1);
          this.requestRender();
        }
      } else if (this.address.length > 0) {
        this.address = this.address.slice(0, -1);
        this.requestRender();
      }
      return true;
    }

    this.insertChar(data);
    return true;
  }

  render(width: number): string[] {
    const t = this.options.theme;
    const lines: string[] = [""];

    if (this.step === "choose") {
      lines.push(`  ${t.fg("muted", "Elegí cómo conectar el dispositivo Android:")}`);
      lines.push("");

      DC_MOBILE_CONNECT_OPTIONS.forEach((option, index) => {
        const selected = index === this.selectedIndex;
        const raw = `${selected ? "▶ " : "  "}${option.label}`;
        lines.push(
          selected
            ? `  ${t.bold(t.fg("accent", raw))}`
            : `  ${t.fg("muted", raw)}`,
        );
      });

      lines.push("");
      return lines;
    }

    if (this.notice) {
      for (const line of wrapText(this.notice, Math.max(20, width - 4))) {
        lines.push(`  ${t.fg("warning", line)}`);
      }
      lines.push("");
    }

    if (this.step === "address") {
      lines.push(`  ${t.fg("muted", "Dirección IP:puerto del dispositivo:")}`);
      lines.push(`  ${t.fg("dim", "Ejemplo: 192.168.100.222:41779")}`);
      lines.push("");
      lines.push(`  ${t.fg("accent", "❯ ")}${t.fg("text", this.address)}${t.fg("accent", "█")}`);
    } else {
      lines.push(`  ${t.fg("muted", `Código de vinculación de ${this.pairAddress}:`)}`);
      lines.push(`  ${t.fg("dim", "6 dígitos que muestra el dispositivo")}`);
      lines.push("");
      lines.push(`  ${t.fg("accent", "❯ ")}${t.fg("text", this.code)}${t.fg("accent", "█")}`);
    }

    if (this.error) {
      lines.push("");
      for (const line of wrapText(this.error, Math.max(20, width - 4))) {
        lines.push(`  ${t.fg("error", line)}`);
      }
    }

    lines.push("");
    lines.push(`  ${t.fg("dim", "Enter: continuar  ·  Esc: cancelar")}`);
    lines.push("");
    return lines;
  }
}

/**
 * Opens the S10 connection chooser. The same window asks for the Wi-Fi address
 * or the pairing code, so cancelling never leaves an overlay behind.
 */
export async function openDcMobileConnectModal(
  ctx: ExtensionContext,
  driver: DcMobileConnectionDriver = createDcMobileConnectionDriver(),
): Promise<DcMobileConnectResult | undefined> {
  const prefs = loadConnectionPrefs();

  const result = await openDcModal<DcMobileConnectResult>(ctx, {
    title: DC_MOBILE_CONNECT_TITLE,
    glyph: "",
    frame: "double",
    width: 62,
    maxHeight: 16,
    paddingX: 1,
    scrollable: false,
    showScrollbar: false,
    footer: {
      left: " [↑/↓] Elegir   [Enter] Confirmar",
      right: "[Esc Cancelar] ",
    },
    content: (done, theme, tui) =>
      new DcMobileConnectWizard({
        driver,
        prefs,
        theme,
        done: (value) => done(value),
        requestRender: () => tui?.requestRender?.(),
      }),
  });

  return result;
}

