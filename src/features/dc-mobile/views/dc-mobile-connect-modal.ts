import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import { openDcModal } from "../../../ui/dc-modal.ts";
import { SPINNER_FRAMES } from "../../../ui/dc-window.ts";
import {
  DC_ADB_UNAVAILABLE_MESSAGE,
} from "../core/dc-adb-driver.ts";
import {
  connectUsb,
  createDcMobileConnectionDriver,
  isValidWifiAddress,
  loadConnectionPrefs,
  type DcMobileConnectionDriver,
  type DcMobileConnectionMode,
  type DcMobileConnectionPrefs,
} from "../core/dc-mobile-connection.ts";
import {
  connectWifiAsync,
  createAdbRunner,
  pairWifiAsync,
  type DcMobileAdbRunner,
} from "../core/dc-mobile-async-connection.ts";
import {
  discoverMdnsAddresses,
  ensureUsbAutoAttach,
} from "../core/dc-mobile-supervisor.ts";

/** Exact S10 window title. */
export const DC_MOBILE_CONNECT_TITLE = "📱 DC Mobile — Conexión";

/** One Wi-Fi path only (S1): pair is reached from a failed connect. */
export type DcMobileConnectChoice = "usb" | "wifi" | "cancel";

export interface DcMobileConnectOption {
  id: DcMobileConnectChoice;
  label: string;
}

/** Exact S1 option order. */
export const DC_MOBILE_CONNECT_OPTIONS: readonly DcMobileConnectOption[] = [
  { id: "usb", label: "USB · detectar dispositivo" },
  { id: "wifi", label: "Wi-Fi · conectar" },
  { id: "cancel", label: "Cancelar" },
];

export interface DcMobileConnectResult {
  ok: boolean;
  cancelled?: boolean;
  guided?: boolean;
  mode?: DcMobileConnectionMode;
  serial?: string;
  lastWifiAddress?: string;
  /** S11: host that completed pairing in this run, even if the retry failed. */
  pairedHost?: string;
  message: string;
}

type WizardStep = "choose" | "address" | "pair" | "running";
type PairFocus = "url" | "code";

/** Number of adb log lines kept visible on the progress/pairing screens. */
const VISIBLE_LOG_LINES = 6;
const VISIBLE_PAIR_LOG_LINES = 5;
/** Same repaint cadence as the existing DcWindow/DcProgressBar spinners. */
const SPINNER_INTERVAL_MS = 85;

export interface DcMobileConnectWizardOptions {
  driver: DcMobileConnectionDriver;
  prefs: DcMobileConnectionPrefs;
  theme: Theme;
  done: (result: DcMobileConnectResult) => void;
  requestRender: () => void;
  /** Injectable adb runner for tests; defaults to the real async runner. */
  runner?: DcMobileAdbRunner;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Host part of a `host:port` value; empty when there is no host. */
function hostOfAddress(address: string): string {
  const value = address.trim();
  const index = value.lastIndexOf(":");
  if (index <= 0) return "";
  return value.slice(0, index).trim();
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
 * Single-window wizard for S1–S7: the chooser, the main-screen address prompt,
 * the pairing prompt and the progress screen share one DcWindow, so Escape
 * always closes one modal and never leaves a second overlay hanging.
 *
 * There is exactly one Wi-Fi path: ask for the main address, try to connect,
 * and only fall back to pairing (and an automatic retry) when that fails.
 */
export class DcMobileConnectWizard implements Component {
  private step: WizardStep = "choose";
  private selectedIndex: number;
  /** Main-screen `host:port` typed on the address step. */
  private address: string;
  /** Pairing-dialog `host:port`; prefilled host, port left to the user. */
  private pairUrl = "";
  private code = "";
  private pairFocus: PairFocus = "url";
  private error = "";
  private notice = "";
  /** A prefilled address is replaced on the first keystroke instead of appended. */
  private addressSelected = false;
  /** S10: hosts already paired on this computer (session + persisted prefs). */
  private readonly pairedHosts: Set<string>;
  /** S11: host paired during this run, returned even when the retry failed. */
  private pairedHost?: string;

  private logs: string[] = [];
  private spinnerIdx = 0;
  private spinTimer?: NodeJS.Timeout;
  private finished = false;

  constructor(private readonly options: DcMobileConnectWizardOptions) {
    this.selectedIndex = options.prefs.mode === "wifi" ? 1 : 0;
    // Prefill `host:` so the user only types the port, which rotates on every activation.
    const savedHost = hostOfAddress(options.prefs.lastWifiAddress ?? "");
    this.address = savedHost ? `${savedHost}:` : "";
    this.addressSelected = this.address.length > 0;
    this.pairedHosts = new Set(
      (options.prefs.pairedHosts ?? [])
        .map((host) => host.trim())
        .filter(Boolean),
    );
  }

  invalidate(): void {}

  public destroy(): void {
    this.stopSpinner();
  }

  private requestRender(): void {
    this.options.requestRender();
  }

  private finish(result: DcMobileConnectResult): void {
    if (this.finished) return;
    this.finished = true;
    this.stopSpinner();
    // S11: a pairing that already happened stays in the result even when the
    // user leaves before the retry succeeds.
    this.options.done(
      this.pairedHost && !result.pairedHost
        ? { ...result, pairedHost: this.pairedHost }
        : result,
    );
  }

  private cancel(): void {
    this.finish({ ok: false, cancelled: true, message: "Conexión cancelada." });
  }

  private startSpinner(): void {
    this.stopSpinner();
    this.spinnerIdx = 0;
    this.spinTimer = setInterval(() => {
      this.spinnerIdx = (this.spinnerIdx + 1) % SPINNER_FRAMES.length;
      this.requestRender();
    }, SPINNER_INTERVAL_MS);
    this.spinTimer.unref?.();
  }

  private stopSpinner(): void {
    if (this.spinTimer) {
      clearInterval(this.spinTimer);
      this.spinTimer = undefined;
    }
  }

  private addLog(line: string): void {
    this.logs.push(line);
    if (this.logs.length > 200) this.logs = this.logs.slice(-200);
    this.requestRender();
  }

  private enterRunning(): void {
    this.step = "running";
    this.startSpinner();
    this.requestRender();
  }

  private leaveRunning(): void {
    this.stopSpinner();
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

    this.step = "address";
    this.error = "";
    this.notice = "";

    // S17: a discovered phone can be connected without typing its port.
    const discovered = discoverMdnsAddresses()[0];
    if (discovered) {
      this.address = discovered;
      this.addressSelected = true;
      this.notice = `Detectado por mDNS: ${discovered}. Enter para conectar.`;
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
    this.notice = "";
    this.address = address;
    this.logs = [];
    void this.runCourse();
  }

  /** S3/S5: try the main address first; pairing only appears if it fails. */
  private async runCourse(): Promise<void> {
    const mainAddress = this.address.trim();
    const runner = this.options.runner ?? createAdbRunner();
    const log = (line: string) => this.addLog(line);

    this.enterRunning();

    try {
      const outcome = await connectWifiAsync(runner, mainAddress, log);
      if (this.finished) return;

      if (outcome.ok) {
        this.finish(this.wifiSuccess(mainAddress));
        return;
      }

      this.handleConnectFailure(mainAddress, outcome.message);
    } catch (error) {
      if (this.finished) return;
      this.handleConnectFailure(mainAddress, errorMessage(error));
    }
  }

  /**
   * S4/S10: a failed connect opens pairing only for a host this computer has
   * never paired with. A known host stays on the address step with an explicit
   * error, because the debugging port changes when pairing completes.
   */
  private handleConnectFailure(mainAddress: string, message: string): void {
    this.leaveRunning();
    const host = hostOfAddress(mainAddress);

    if (host && this.pairedHosts.has(host)) {
      this.step = "address";
      this.address = `${host}:`;
      this.addressSelected = true;
      this.notice = "";
      this.error =
        `No se pudo conectar a ${mainAddress}, pero este equipo ya está vinculado con ${host}: ` +
        "es posible que el puerto de depuración inalámbrica haya cambiado. " +
        "Copiá la URL nueva de la pantalla principal y reintentá. " +
        "Si querés volver a vincular, presioná p.";
      this.requestRender();
      return;
    }

    // S4: the pairing screen keeps the log context of the failed connect.
    this.step = "pair";
    this.pairUrl = this.pairUrlFromMain(mainAddress);
    this.pairFocus = "url";
    this.code = "";
    this.error = message;
    this.notice =
      `No se pudo conectar a ${mainAddress}. Vinculá el dispositivo y reintentamos.`;
    this.requestRender();
  }

  /** S10: `p` on the address step asks for pairing even for a known host. */
  private openPairingScreen(): void {
    const host = hostOfAddress(this.address);

    this.step = "pair";
    this.pairUrl = host ? `${host}:` : "";
    this.pairFocus = "url";
    this.code = "";
    this.error = "";
    this.notice = host
      ? `Vinculación manual para ${host}. Ingresá el puerto que muestra el diálogo de vinculación.`
      : "";
    this.requestRender();
  }

  private submitPair(): void {
    const pairUrl = this.pairUrl.trim();
    const code = this.code.trim();

    if (!isValidWifiAddress(pairUrl)) {
      this.error = "Dirección inválida: usá host:puerto, por ejemplo 192.168.1.5:37000 (puerto 1-65535).";
      this.requestRender();
      return;
    }

    if (!/^\d{6}$/.test(code)) {
      this.error = "Código inválido: ingresá los 6 dígitos que muestra el dispositivo.";
      this.requestRender();
      return;
    }

    this.pairUrl = pairUrl;
    this.code = code;
    this.error = "";
    void this.runPairing(pairUrl, code);
  }

  /** S6/S7: pairing failure keeps the screen; success retries the main address. */
  private async runPairing(pairUrl: string, code: string): Promise<void> {
    const mainAddress = this.address.trim();
    const runner = this.options.runner ?? createAdbRunner();
    const log = (line: string) => this.addLog(line);

    this.enterRunning();

    try {
      const paired = await pairWifiAsync(runner, pairUrl, code, log);
      if (this.finished) return;

      if (!paired.paired) {
        this.leaveRunning();
        this.step = "pair";
        this.error = paired.message;
        this.requestRender();
        return;
      }

      // S10/S11: remember this host immediately. A retry failure must not send
      // the user back into pairing for a host that is already paired.
      const pairedHost = hostOfAddress(pairUrl) || hostOfAddress(mainAddress);
      if (pairedHost) {
        this.pairedHost = pairedHost;
        this.pairedHosts.add(pairedHost);
      }

      const retried = await connectWifiAsync(runner, mainAddress, log);
      if (this.finished) return;

      if (retried.ok) {
        this.finish(this.wifiSuccess(mainAddress));
        return;
      }

      // S9: paired, but the main address still refuses. The wireless-debugging
      // port changes when pairing completes (observed :41779 -> :44523), so
      // never prefill the stale port: pressing Enter would repeat the same
      // failure forever. Ask for the new main-screen port instead.
      this.leaveRunning();
      this.step = "address";
      const host = hostOfAddress(mainAddress);
      this.address = host ? `${host}:` : "";
      this.addressSelected = true;
      this.notice =
        "La vinculación se completó, pero el puerto de depuración inalámbrica " +
        "cambia al vincular. Copiá la URL nueva de la pantalla principal y presioná Enter.";
      this.error = `Vinculación correcta, pero el connect posterior falló: ${retried.message}`;
      this.requestRender();
    } catch (error) {
      if (this.finished) return;
      this.leaveRunning();
      this.step = "pair";
      this.error = errorMessage(error);
      this.requestRender();
    }
  }

  private wifiSuccess(address: string): DcMobileConnectResult {
    return {
      ok: true,
      mode: "wifi",
      serial: address,
      lastWifiAddress: address,
      ...(this.pairedHost ? { pairedHost: this.pairedHost } : {}),
      message: `Conectado a ${address}.`,
    };
  }

  /** S4: prefill the pairing host from the main address, port left to the user. */
  private pairUrlFromMain(mainAddress: string): string {
    const host = hostOfAddress(mainAddress);
    return host ? `${host}:` : "";
  }

  private insertChar(data: string): void {
    if (data.startsWith("\x1b")) return;
    const clean = data.replace(/[\x00-\x1f\x7f]/g, "");
    if (!clean) return;

    if (this.step === "pair") {
      if (this.pairFocus === "code") {
        const digits = clean.replace(/\D/g, "");
        if (!digits) return;
        this.code = (this.code + digits).slice(0, 6);
      } else {
        this.pairUrl = (this.pairUrl + clean.replace(/\s/g, "")).slice(0, 80);
      }
      this.requestRender();
      return;
    }

    if (this.addressSelected) {
      // S9: a `host:` value has no port yet, so typing must extend the host
      // instead of wiping the prefilled address.
      if (!this.address.endsWith(":")) this.address = "";
      this.addressSelected = false;
    }
    this.address = (this.address + clean).slice(0, 80);
    this.requestRender();
  }

  handleInput(data: string): boolean {
    if (this.finished) return false;

    if (matchesKey(data, Key.escape)) {
      this.cancel();
      return true;
    }

    // S5: the run owns the screen until it finishes; only Esc leaves.
    if (this.step === "running") return true;

    // S10: `p` is a command key only while the address has no port yet (the
    // state after a pairing changed the wireless port). Anywhere else it is an
    // ordinary character, so a hostname can always be typed.
    if (
      matchesKey(data, "p") &&
      this.step === "address" &&
      this.address.trim().endsWith(":")
    ) {
      this.openPairingScreen();
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

    if (this.step === "pair" && matchesKey(data, Key.tab)) {
      this.pairFocus = this.pairFocus === "url" ? "code" : "url";
      this.error = "";
      this.requestRender();
      return true;
    }

    if (matchesKey(data, Key.enter)) {
      if (this.step === "address") {
        this.submitAddress();
      } else if (this.pairFocus === "url") {
        // S4: Enter moves from the pairing URL to the code, like Tab.
        this.pairFocus = "code";
        this.error = "";
        this.requestRender();
      } else {
        this.submitPair();
      }
      return true;
    }

    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      if (this.step === "pair") {
        if (this.pairFocus === "code") {
          if (this.code.length > 0) {
            this.code = this.code.slice(0, -1);
            this.requestRender();
          }
        } else if (this.pairUrl.length > 0) {
          this.pairUrl = this.pairUrl.slice(0, -1);
          this.requestRender();
        }
      } else if (this.address.length > 0) {
        this.address = this.address.slice(0, -1);
        this.addressSelected = false;
        this.requestRender();
      }
      return true;
    }

    this.insertChar(data);
    return true;
  }

  private renderField(value: string, focused: boolean, theme: Theme): string {
    const cursor = focused ? theme.fg("accent", "█") : "";
    return `${theme.fg("accent", "❯ ")}${theme.fg("text", value)}${cursor}`;
  }

  private renderLogs(lines: string[], width: number, limit = VISIBLE_LOG_LINES): void {
    const t = this.options.theme;
    for (const log of this.logs.slice(-limit)) {
      lines.push(
        `  ${t.fg("dim", truncateToWidth(log, Math.max(10, width - 4), "…"))}`,
      );
    }
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

    if (this.step === "running") {
      const frame = SPINNER_FRAMES[this.spinnerIdx % SPINNER_FRAMES.length] ?? "⠋";
      lines.push(`  ${t.bold(t.fg("accent", `${frame} Conectando el dispositivo…`))}`);
      lines.push("");
      if (this.logs.length === 0) {
        lines.push(`  ${t.fg("dim", "Ejecutando adb…")}`);
      } else {
        this.renderLogs(lines, width);
      }
      lines.push("");
      lines.push(`  ${t.fg("dim", "Esc: cancelar")}`);
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
      lines.push(`  ${t.fg("muted", "IP:puerto que muestra la pantalla principal:")}`);
      lines.push(`  ${t.fg("dim", "Ejemplo: 192.168.100.222:41779")}`);
      lines.push("");
      lines.push(`  ${this.renderField(this.address, true, t)}`);
    } else {
      lines.push(`  ${t.fg("muted", "IP:puerto del diálogo de vinculación:")}`);
      lines.push(`  ${this.renderField(this.pairUrl, this.pairFocus === "url", t)}`);
      lines.push("");
      lines.push(`  ${t.fg("muted", "Código de 6 dígitos:")}`);
      lines.push(`  ${this.renderField(this.code, this.pairFocus === "code", t)}`);
    }

    if (this.error) {
      lines.push("");
      for (const line of wrapText(this.error, Math.max(20, width - 4))) {
        lines.push(`  ${t.fg("error", line)}`);
      }
    }

    if (this.step === "pair" && this.logs.length > 0) {
      lines.push("");
      lines.push(`  ${t.fg("muted", "Últimas líneas:")}`);
      this.renderLogs(lines, width, VISIBLE_PAIR_LOG_LINES);
    }

    lines.push("");
    lines.push(
      `  ${t.fg(
        "dim",
        this.step === "address"
          ? "Enter: conectar  ·  p: vincular  ·  Esc: cancelar"
          : "Tab/Enter: pasar al código  ·  Enter: vincular  ·  Esc: cancelar",
      )}`,
    );
    lines.push("");
    return lines;
  }
}

/**
 * Opens the S1 connection chooser. The same window asks for the main-screen
 * address, then for pairing data only when the connect fails.
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
    maxHeight: 22,
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
