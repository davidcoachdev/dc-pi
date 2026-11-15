import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveDcConfigPath } from "../../../core/dc-paths.ts";
import {
  DC_ADB_UNAVAILABLE_MESSAGE,
  DcAdbDriver,
  DcAdbError,
  type DcAdbDevice,
  type DcAdbDriverOptions,
  type DcAdbExecFn,
} from "./dc-adb-driver.ts";
import {
  DC_MOBILE_USB_PERMISSION_HELP,
  ensureAndroidUsbWritable,
  restartAdbServer,
  type UsbPermissionResult,
} from "./dc-usb-permissions.ts";

/**
 * Transport, Wi-Fi connection and per-feature persistence for dc-mobile
 * (S10–S13).
 *
 * The module keeps the pure decisions (transport classification, address
 * validation, USB filtering) separate from the side effects (adb calls and
 * on-disk preferences) so they can be unit tested with a fake driver/execFn.
 */

export type DcMobileTransport = "usb" | "wifi";
export type DcMobileConnectionMode = DcMobileTransport;

/** Exact S11 guidance shown when no USB device is visible. */
export const DC_MOBILE_USB_HELP =
  "No hay dispositivos USB visibles. En WSL el cable requiere usbipd-win: winget install dorssel.usbipd-win, luego usbipd bind --busid <BUSID> y usbipd attach --wsl --busid <BUSID>.";

export interface DcMobileConnectionPrefs {
  lastSerial: string;
  mode: DcMobileConnectionMode;
  lastWifiAddress: string;
  /**
   * Hosts (no port) that completed `adb pair` on this computer (S10/S11).
   * Optional only so older callers/tests that build a prefs literal keep
   * type-checking; `normalizePrefs` and the defaults always resolve to an
   * array.
   */
  pairedHosts?: string[];
}

export const DEFAULT_DC_MOBILE_CONNECTION_PREFS: DcMobileConnectionPrefs = {
  lastSerial: "",
  mode: "usb",
  lastWifiAddress: "",
  pairedHosts: [],
};

/** Exact guidance when the phone has not accepted the RSA fingerprint yet. */
export const DC_MOBILE_USB_UNAUTHORIZED_MESSAGE =
  'El celular rechazó la huella RSA. Aceptá "Permitir depuración USB" en la pantalla del teléfono y reintentá.';

export interface DcMobileConnectionOutcome {
  ok: boolean;
  serial?: string;
  message: string;
  /** True when `adb pair` succeeded; lets the UI ask for the main-screen port. */
  paired?: boolean;
  /** True when the message is an actionable next step, not a tool failure. */
  guided?: boolean;
}

/**
 * Side-effect surface used by the connection flows. `DcAdbDriver` only covers
 * device listing and input, so the connect/pair pair is provided by
 * `createDcMobileConnectionDriver`.
 */
export interface DcMobileConnectionDriver {
  isAvailable(): boolean;
  listDevices(): DcAdbDevice[];
  connect(address: string): string;
  pair(address: string, code: string): string;
  /**
   * mDNS-declared `host:port` endpoints (`_adb-tls-connect._tcp`). Optional:
   * without it the flow falls back to asking for the main-screen port.
   */
  discover?: () => string[];
}

/** A serial containing `:` belongs to wireless debugging (S11). */
export function classifyTransport(serial: string): DcMobileTransport {
  return (serial ?? "").includes(":") ? "wifi" : "usb";
}

/** USB devices are visible serials without `:` that adb reports as `device`. */
export function listUsbDevices(
  driver: Pick<DcMobileConnectionDriver, "listDevices">,
): DcAdbDevice[] {
  return driver
    .listDevices()
    .filter((device) => !device.serial.includes(":") && device.state === "device");
}

function isValidIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;

  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    return Number(part) <= 255;
  });
}

function isValidHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  // Dotted numeric hosts must be valid IPv4, never a fallback hostname.
  if (/^[0-9.]+$/.test(host)) return false;

  return host.split(".").every((label) =>
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label),
  );
}

/**
 * Validates `host:port` where host is IPv4 or a domain name and the port is
 * 1-65535 (S12). Whitespace, IPv6 and extra colons are rejected.
 */
export function isValidWifiAddress(address: string): boolean {
  if (typeof address !== "string") return false;

  const value = address.trim();
  const match = /^([^:\s]+):(\d{1,5})$/.exec(value);
  if (!match) return false;

  const host = match[1]!;
  const port = Number(match[2]!);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;

  return isValidIpv4(host) || isValidHostname(host);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Connects a USB device after making the attached Android nodes writable
 * (S11). Node permissions are fixed first, then adb is asked for devices.
 * When nothing is listed, the permission failure takes precedence over the
 * generic USB guidance.
 */
export interface DcMobileUsbConnectDeps {
  /** Injectable seam for tests. Defaults to `ensureAndroidUsbWritable`. */
  ensurePermissions?: () => UsbPermissionResult;
  /** Injectable seam for tests. Defaults to `restartAdbServer`. */
  restartServer?: () => boolean;
}

export function connectUsb(
  driver: Pick<DcMobileConnectionDriver, "listDevices">,
  deps: DcMobileUsbConnectDeps = {},
): DcMobileConnectionOutcome {
  const ensurePermissions = deps.ensurePermissions ?? ensureAndroidUsbWritable;
  const restartServer = deps.restartServer ?? restartAdbServer;

  let permissions: UsbPermissionResult = { ready: [], failed: [] };
  try {
    permissions = ensurePermissions();
  } catch {
    /* permission probing is best effort; adb detection still runs */
  }

  // The adb server caches the failed open of the node: a restart is required
  // after a successful chmod before adb can use the transport (verified on WSL).
  if (permissions.ready.length > 0) {
    try {
      restartServer();
    } catch {
      /* a failed restart is reported later by adb itself */
    }
  }

  try {
    const devices = listUsbDevices(driver);
    if (devices.length > 0) {
      const device = devices[0]!;
      return {
        ok: true,
        serial: device.serial,
        message: `Dispositivo USB detectado: ${device.serial} (${device.model}).`,
      };
    }

    const unauthorized = driver
      .listDevices()
      .find((device) => !device.serial.includes(":") && device.state === "unauthorized");

    if (unauthorized) {
      return {
        ok: false,
        serial: unauthorized.serial,
        guided: true,
        message: DC_MOBILE_USB_UNAUTHORIZED_MESSAGE,
      };
    }
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  if (permissions.failed.length > 0) {
    return { ok: false, message: DC_MOBILE_USB_PERMISSION_HELP };
  }

  return { ok: false, message: DC_MOBILE_USB_HELP };
}

function adbOutputLooksFailed(output: string): boolean {
  return /(failed|cannot|unable|error|refused|timed out|no route)/i.test(output);
}

/** Connects to `host:port` through adb. Never throws and never calls adb with an invalid address. */
export function connectWifi(
  driver: Pick<DcMobileConnectionDriver, "connect">,
  address: string,
): DcMobileConnectionOutcome {
  const value = typeof address === "string" ? address.trim() : "";

  if (!isValidWifiAddress(value)) {
    return {
      ok: false,
      message: `Dirección Wi-Fi inválida: "${value}". Usá host:puerto, por ejemplo 192.168.1.50:5555.`,
    };
  }

  try {
    const output = driver.connect(value);
    const text = (Buffer.isBuffer(output) ? output.toString("utf8") : String(output ?? "")).trim();

    if (adbOutputLooksFailed(text)) {
      return { ok: false, message: text };
    }

    return {
      ok: true,
      serial: value,
      message: text || `Conectado a ${value}.`,
    };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

/**
 * Pairs through adb and then attempts `adb connect` on the same address (S12).
 * When pairing works but the connect fails, the message explains that the
 * pairing port closes and asks for the main-screen port.
 */
export function pairWifi(
  driver: Pick<DcMobileConnectionDriver, "connect" | "pair"> & {
    discover?: () => string[];
  },
  address: string,
  code: string,
  fallbackAddress?: string,
): DcMobileConnectionOutcome {
  const value = typeof address === "string" ? address.trim() : "";
  const pairingCode = typeof code === "string" ? code.trim() : "";

  if (!isValidWifiAddress(value)) {
    return {
      ok: false,
      message: `Dirección Wi-Fi inválida: "${value}". Usá host:puerto, por ejemplo 192.168.1.50:37000.`,
    };
  }

  if (!/^\d{6}$/.test(pairingCode)) {
    return { ok: false, message: "Código de vinculación inválido: ingresá 6 dígitos." };
  }

  let pairOutput: string;
  try {
    const raw = driver.pair(value, pairingCode);
    pairOutput = (Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "")).trim();
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  if (!/successfully paired/i.test(pairOutput)) {
    return {
      ok: false,
      message: pairOutput || "adb pair falló: revisá la dirección y el código de vinculación.",
    };
  }

  const connected = connectWifi(driver, value);
  if (connected.ok) {
    return {
      ok: true,
      serial: connected.serial,
      paired: true,
      message: `Vinculado y conectado a ${value}.`,
    };
  }

  // The pairing port closes as soon as pairing ends, so the same address can
  // never accept the follow-up connect. Before asking the user to read the
  // main-screen port, ask the phone itself over mDNS. Only endpoints on the
  // same host are eligible: a discovered address belongs to whichever phone
  // announced it, never to a phone on another host.
  const discovered = resolveSameHostEndpoints(driver, value);
  for (const candidate of discovered) {
    const attempt = connectWifi(driver, candidate);
    if (attempt.ok) {
      return {
        ok: true,
        serial: attempt.serial,
        paired: true,
        message:
          `Vinculado y conectado a ${candidate}, puerto principal descubierto por mDNS.`,
      };
    }
  }

  // WSL's NAT drops multicast, so mDNS often answers nothing here. The last
  // address that worked is the next best source: wireless debugging keeps the
  // same port until it is toggled off.
  const saved = typeof fallbackAddress === "string" ? fallbackAddress.trim() : "";
  const host = value.slice(0, value.lastIndexOf(":"));
  if (saved && isValidWifiAddress(saved) && saved.startsWith(`${host}:`)) {
    const attempt = connectWifi(driver, saved);
    if (attempt.ok) {
      return {
        ok: true,
        serial: attempt.serial,
        paired: true,
        message: `Vinculado y conectado a ${saved}, la última dirección conocida.`,
      };
    }
  }

  return {
    ok: false,
    paired: true,
    message:
      `Vinculación correcta, pero el connect posterior falló: ${connected.message} ` +
      "El puerto de vinculación se cierra al terminar; ingresá el puerto que muestra la pantalla principal de depuración inalámbrica.",
  };
}

/**
 * Discovery is best-effort by design: a broken or slow `adb mdns` must never
 * turn a successful pairing into a failure. Any endpoint whose host differs
 * from the paired host is discarded.
 */
function resolveSameHostEndpoints(
  driver: { discover?: () => string[] },
  pairedAddress: string,
): string[] {
  if (!driver.discover) return [];

  const host = pairedAddress.slice(0, pairedAddress.lastIndexOf(":"));
  const seen = new Set<string>();
  const endpoints: string[] = [];

  let advertised: string[];
  try {
    const raw = driver.discover();
    advertised = Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }

  for (const entry of advertised) {
    const candidate = typeof entry === "string" ? entry.trim() : "";
    if (!candidate || !isValidWifiAddress(candidate) || seen.has(candidate)) continue;
    if (!candidate.startsWith(`${host}:`)) continue;
    seen.add(candidate);
    endpoints.push(candidate);
  }

  return endpoints;
}

/** S11: only non-empty trimmed strings survive; duplicates are dropped. */
function normalizePairedHosts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const hosts: string[] = [];

  for (const entry of raw) {
    if (typeof entry !== "string") continue;

    const host = entry.trim();
    if (!host || seen.has(host)) continue;

    seen.add(host);
    hosts.push(host);
  }

  return hosts;
}

function normalizePrefs(raw: unknown): DcMobileConnectionPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_DC_MOBILE_CONNECTION_PREFS, pairedHosts: [] };
  }

  const candidate = raw as Record<string, unknown>;

  return {
    lastSerial:
      typeof candidate.lastSerial === "string" ? candidate.lastSerial : "",
    mode: candidate.mode === "wifi" ? "wifi" : "usb",
    lastWifiAddress:
      typeof candidate.lastWifiAddress === "string" ? candidate.lastWifiAddress : "",
    pairedHosts: normalizePairedHosts(candidate.pairedHosts),
  };
}

/**
 * Reads dc-mobile preferences from `~/.pi/agent/dc-studio/dc-mobile.json`
 * (S13). Invalid JSON or unreadable files fall back to the defaults.
 */
export function loadConnectionPrefs(
  configPath: string = resolveDcConfigPath("dc-mobile"),
): DcMobileConnectionPrefs {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_DC_MOBILE_CONNECTION_PREFS, pairedHosts: [] };
  }
}

/**
 * Merges and persists the preferences with an atomic temp-file + rename write
 * (S13). Failures are swallowed: a broken config never breaks a connection.
 */
export function saveConnectionPrefs(
  patch: Partial<DcMobileConnectionPrefs> = {},
  configPath: string = resolveDcConfigPath("dc-mobile"),
): DcMobileConnectionPrefs {
  const current = loadConnectionPrefs(configPath);
  const next = normalizePrefs({ ...current, ...patch });

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, configPath);
  } catch {
    /* best effort: preferences never block a connection */
  }

  return next;
}

function defaultConnectionExecFn(
  file: string,
  args: string[],
  options: { encoding: "utf8" | "buffer"; timeout: number; maxBuffer: number },
): string | Buffer {
  const shared = { timeout: options.timeout, maxBuffer: options.maxBuffer };

  if (options.encoding === "buffer") {
    return execFileSync(file, args, shared);
  }

  return execFileSync(file, args, { ...shared, encoding: "utf8" });
}

function readErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function describeExecError(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { stderr?: string | Buffer; message?: string };
    if (candidate.stderr) {
      const stderr = String(candidate.stderr).trim();
      if (stderr.length > 0) return stderr;
    }
    if (candidate.message) return candidate.message;
  }
  return String(error);
}

function runAdbCommand(
  execFn: DcAdbExecFn,
  adbBin: string,
  args: string[],
  timeout: number,
): string {
  try {
    const result = execFn(adbBin, args, {
      encoding: "utf8",
      timeout,
      maxBuffer: 1024 * 1024,
    });
    return Buffer.isBuffer(result) ? result.toString("utf8") : String(result ?? "");
  } catch (error) {
    if (error instanceof DcAdbError) throw error;

    if (readErrorCode(error) === "ENOENT") {
      throw new DcAdbError(
        "ADB_UNAVAILABLE",
        DC_ADB_UNAVAILABLE_MESSAGE,
        describeExecError(error),
      );
    }

    throw new DcAdbError(
      "ADB_COMMAND_FAILED",
      `adb falló (${args.join(" ")}): ${describeExecError(error)}`,
      describeExecError(error),
    );
  }
}

/**
 * Production driver: device listing/availability come from `DcAdbDriver`,
 * while `connect`/`pair` run their own explicit-timeout adb calls.
 */
export function createDcMobileConnectionDriver(
  options: DcAdbDriverOptions = {},
): DcMobileConnectionDriver {
  const driver = new DcAdbDriver(options);
  const execFn = options.execFn ?? defaultConnectionExecFn;
  const adbBin = options.adbBin ?? "adb";
  const timeoutMs = options.defaultTimeoutMs ?? 15_000;

  return {
    isAvailable: () => driver.isAvailable(),
    listDevices: () => driver.listDevices(),
    connect: (address: string) =>
      runAdbCommand(execFn, adbBin, ["connect", address], Math.max(timeoutMs, 20_000)),
    pair: (address: string, code: string) =>
      runAdbCommand(execFn, adbBin, ["pair", address, code], Math.max(timeoutMs, 30_000)),
  };
}
