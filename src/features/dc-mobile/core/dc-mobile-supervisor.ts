import { execFileSync, spawn, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";

import {
  DC_MOBILE_USB_HELP,
  DC_MOBILE_USB_UNAUTHORIZED_MESSAGE,
  DEFAULT_DC_MOBILE_CONNECTION_PREFS,
  classifyTransport,
  connectWifi,
  createDcMobileConnectionDriver,
  loadConnectionPrefs,
  type DcMobileConnectionDriver,
  type DcMobileConnectionPrefs,
  type DcMobileTransport,
} from "./dc-mobile-connection.ts";
import {
  DC_MOBILE_USB_PERMISSION_HELP,
  ensureAndroidUsbWritable,
  restartAdbServer,
  type UsbPermissionResult,
} from "./dc-usb-permissions.ts";

/**
 * Connection supervisor for dc-mobile (S15–S17).
 *
 * Every tool starts by asking the supervisor for a usable device. The
 * supervisor runs at most one permission repair and at most one Wi-Fi
 * `adb connect`; it never polls, never retries periodically and never throws.
 */

const ANDROID_VENDOR_IDS = new Set(["18d1", "04e8"]);

/** S16 fallback used when `DC_USBIPD_PATH` is not set. */
export const DC_USBIPD_DEFAULT_PATH =
  "/mnt/c/Program Files/usbipd-win/usbipd.exe";

/** Guidance returned when usbipd cannot be launched automatically. */
export const DC_USBIPD_MANUAL_HELP =
  "No se pudo iniciar usbipd attach automáticamente. Ejecutá manualmente: usbipd bind --busid <BUSID> y usbipd attach --wsl --busid <BUSID>.";

/** Fallback when no transport can be started and no address was persisted. */
export const DC_MOBILE_NO_DEVICE_MESSAGE =
  "No hay dispositivos conectados. Conectá el cable USB o ingresá una dirección Wi-Fi.";

export interface DcMobileSupervisorResult {
  ok: boolean;
  serial?: string;
  transport?: DcMobileTransport;
  message: string;
  guided?: boolean;
}

export interface DcMobileSupervisorDeps {
  /** Injectable seam for tests. Defaults to `ensureAndroidUsbWritable`. */
  ensurePermissions?: () => UsbPermissionResult;
  /** Injectable seam for tests. Defaults to `restartAdbServer`. */
  restartServer?: () => boolean;
  /** Injectable seam for tests. Defaults to `loadConnectionPrefs`. */
  loadPrefs?: () => DcMobileConnectionPrefs;
}

function activeDevice(
  driver: Pick<DcMobileConnectionDriver, "listDevices">,
): { serial: string; model?: string } | undefined {
  const device = driver
    .listDevices()
    .find((candidate) => candidate.state === "device" && candidate.serial.length > 0);

  return device ? { serial: device.serial, model: device.model } : undefined;
}

function success(serial: string, message: string): DcMobileSupervisorResult {
  return {
    ok: true,
    serial,
    transport: classifyTransport(serial),
    message,
  };
}

function unauthorizedUsb(
  driver: Pick<DcMobileConnectionDriver, "listDevices">,
): string | undefined {
  return driver
    .listDevices()
    .find(
      (device) =>
        !device.serial.includes(":") && device.state === "unauthorized",
    )?.serial;
}

/**
 * Resolves a usable Android device (S15).
 *
 * Order:
 * 1. A device adb already reports as `device` wins.
 * 2. In USB mode, Android nodes are made writable and, only when a node became
 *    ready, the adb server is restarted before listing again.
 * 3. If nothing is visible and the last mode was Wi-Fi, one `adb connect` is
 *    attempted against the remembered address.
 */
export function ensureConnection(
  driver: Pick<DcMobileConnectionDriver, "listDevices" | "connect">,
  prefs?: DcMobileConnectionPrefs,
  deps: DcMobileSupervisorDeps = {},
): DcMobileSupervisorResult {
  const loadPrefs = deps.loadPrefs ?? loadConnectionPrefs;
  let resolved: DcMobileConnectionPrefs;

  try {
    resolved = prefs ?? loadPrefs();
  } catch {
    resolved = { ...DEFAULT_DC_MOBILE_CONNECTION_PREFS };
  }

  try {
    const connected = activeDevice(driver);
    if (connected) {
      return success(
        connected.serial,
        `Dispositivo ya conectado: ${connected.serial}${connected.model ? ` (${connected.model})` : ""}.`,
      );
    }

    if (resolved.mode !== "wifi") {
      const ensurePermissions = deps.ensurePermissions ?? ensureAndroidUsbWritable;
      const restartServer = deps.restartServer ?? restartAdbServer;

      let permissions: UsbPermissionResult = { ready: [], failed: [] };
      try {
        permissions = ensurePermissions();
      } catch {
        /* permission probing is best effort; adb detection still runs */
      }

      // The adb server caches the failed open of the node, so a restart is
      // only useful (and only performed) when a node became ready (L10).
      if (permissions.ready.length > 0) {
        try {
          restartServer();
        } catch {
          /* a failed restart is reported later by adb itself */
        }
      }

      const repaired = activeDevice(driver);
      if (repaired) {
        return success(
          repaired.serial,
          `Dispositivo USB detectado: ${repaired.serial}${repaired.model ? ` (${repaired.model})` : ""}.`,
        );
      }

      const unauthorized = unauthorizedUsb(driver);
      if (unauthorized) {
        return {
          ok: false,
          serial: unauthorized,
          transport: "usb",
          guided: true,
          message: DC_MOBILE_USB_UNAUTHORIZED_MESSAGE,
        };
      }

      if (permissions.failed.length > 0) {
        return { ok: false, transport: "usb", message: DC_MOBILE_USB_PERMISSION_HELP };
      }

      return { ok: false, transport: "usb", message: DC_MOBILE_USB_HELP };
    }

    const lastAddress =
      typeof resolved.lastWifiAddress === "string"
        ? resolved.lastWifiAddress.trim()
        : "";

    if (lastAddress) {
      // Exactly one attempt: a failed connect is reported, never retried here.
      const wifi = connectWifi(driver, lastAddress);
      if (wifi.ok) {
        return {
          ok: true,
          serial: wifi.serial ?? lastAddress,
          transport: "wifi",
          message: wifi.message,
        };
      }

      return { ok: false, transport: "wifi", message: wifi.message };
    }

    return { ok: false, transport: "wifi", message: DC_MOBILE_NO_DEVICE_MESSAGE };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Parses `adb mdns services` output (S17).
 *
 * Only `_adb-tls-connect._tcp` entries are usable for `adb connect`; pairing
 * entries and the header line are ignored. Handles tabs, runs of spaces and
 * CRLF line endings.
 */
export function parseMdnsServices(output: string): string[] {
  const addresses: string[] = [];

  for (const rawLine of String(output ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;

    const service = parts.find((part) =>
      /^_adb-tls-[a-z-]+\._tcp$/i.test(part),
    );
    if (!service) continue;
    if (service.toLowerCase() !== "_adb-tls-connect._tcp") continue;

    const address = parts[parts.length - 1];
    if (!address || !/^[^\s:]+:\d{1,5}$/.test(address)) continue;
    if (!addresses.includes(address)) addresses.push(address);
  }

  return addresses;
}

export interface DcMobileMdnsDeps {
  adbBin?: string;
  /** Injectable seam for tests. */
  execFn?: (file: string, args: string[]) => string;
}

/**
 * Runs `adb mdns services` and returns the connectable `ip:port` addresses.
 * Discovery is best effort: a missing adb or malformed output yields `[]`.
 */
export function discoverMdnsAddresses(deps: DcMobileMdnsDeps = {}): string[] {
  const execFn =
    deps.execFn ??
    ((file: string, args: string[]): string =>
      String(
        execFileSync(file, args, {
          encoding: "utf8",
          timeout: 5_000,
          maxBuffer: 1024 * 1024,
        }) ?? "",
      ));

  try {
    return parseMdnsServices(execFn(deps.adbBin ?? "adb", ["mdns", "services"]));
  } catch {
    return [];
  }
}

/**
 * Production connection driver with mDNS discovery attached (S12).
 *
 * Pairing alone never yields a usable serial: `adb pair` closes its port as
 * soon as it finishes, and the port that accepts `adb connect` is the one the
 * phone advertises over mDNS. Wiring discovery here keeps the pair flow to a
 * single address typed by the user; without it the wizard has to ask again.
 */
export function createDcMobileSupervisedDriver(
  options: Parameters<typeof createDcMobileConnectionDriver>[0] = {},
): DcMobileConnectionDriver {
  return {
    ...createDcMobileConnectionDriver(options),
    discover: () => discoverMdnsAddresses(),
  };
}

export interface DcMobileUsbipdDeps {
  env?: NodeJS.ProcessEnv;
  /** Injectable seam for tests. Defaults to `fs.existsSync`. */
  exists?: (path: string) => boolean;
  /** Injectable seam for tests; runs `usbipd list`. */
  execFn?: (file: string, args: string[]) => string;
  /** Injectable seam for tests; spawns the detached attach process. */
  spawnFn?: (
    command: string,
    args: string[],
    options: SpawnOptions,
  ) => { unref: () => void; on?: (event: string, listener: () => void) => unknown };
}

/** Resolves usbipd from `DC_USBIPD_PATH` and then the WSL default (S16). */
export function resolveUsbipdPath(deps: DcMobileUsbipdDeps = {}): string {
  const env = deps.env ?? process.env;
  const configured = typeof env.DC_USBIPD_PATH === "string"
    ? env.DC_USBIPD_PATH.trim()
    : "";

  return configured.length > 0 ? configured : DC_USBIPD_DEFAULT_PATH;
}

/**
 * Parses `usbipd list` and returns the BUSIDs whose vendor id belongs to
 * Android (`18d1` Google, `04e8` Samsung). Never throws.
 */
export function listUsbipdBusIds(
  usbipdPath: string,
  deps: Pick<DcMobileUsbipdDeps, "execFn"> = {},
): string[] {
  const execFn =
    deps.execFn ??
    ((file: string, args: string[]): string =>
      String(
        execFileSync(file, args, {
          encoding: "utf8",
          timeout: 5_000,
          maxBuffer: 1024 * 1024,
        }) ?? "",
      ));

  let output: string;
  try {
    output = execFn(usbipdPath, ["list"]);
  } catch {
    return [];
  }

  const busIds: string[] = [];
  for (const line of String(output ?? "").split(/\r?\n/)) {
    const match = /^\s*(\S+)\s+([0-9a-f]{4}):[0-9a-f]{4}\b/i.exec(line);
    if (!match) continue;

    const busId = match[1]!;
    const vendorId = match[2]!.toLowerCase();
    if (!ANDROID_VENDOR_IDS.has(vendorId)) continue;
    if (!busIds.includes(busId)) busIds.push(busId);
  }

  return busIds;
}

const activeAutoAttach = new Set<string>();

/**
 * Starts `usbipd attach --wsl --auto-attach --busid <BUSID>` detached so a
 * replug re-attaches without UAC (S16). Never throws and never blocks.
 */
export function startUsbAutoAttach(
  busid: string,
  deps: DcMobileUsbipdDeps = {},
): { started: boolean; message: string } {
  const busId = typeof busid === "string" ? busid.trim() : "";
  if (!busId) {
    return { started: false, message: DC_USBIPD_MANUAL_HELP };
  }

  if (activeAutoAttach.has(busId)) {
    return {
      started: false,
      message: `USB auto-attach ya activo para BUSID ${busId}.`,
    };
  }

  const usbipdPath = resolveUsbipdPath(deps);
  const exists = deps.exists ?? existsSync;

  try {
    if (!exists(usbipdPath)) {
      return { started: false, message: DC_USBIPD_MANUAL_HELP };
    }
  } catch {
    return { started: false, message: DC_USBIPD_MANUAL_HELP };
  }

  try {
    const spawnFn =
      deps.spawnFn ??
      ((command: string, args: string[], options: SpawnOptions) =>
        spawn(command, args, options));
    const child = spawnFn(
      usbipdPath,
      ["attach", "--wsl", "--auto-attach", "--busid", busId],
      { detached: true, stdio: "ignore", windowsHide: true },
    );

    child.on?.("error", () => {
      activeAutoAttach.delete(busId);
    });
    child.unref();
    activeAutoAttach.add(busId);

    return {
      started: true,
      message: `USB auto-attach activo para BUSID ${busId}.`,
    };
  } catch {
    return { started: false, message: DC_USBIPD_MANUAL_HELP };
  }
}

/**
 * Resolves the Android BUSID and starts the auto-attach process. Used by the
 * modal and `/dc-mobile` after a successful USB connection.
 */
export function ensureUsbAutoAttach(
  deps: DcMobileUsbipdDeps = {},
): { started: boolean; message: string } {
  const usbipdPath = resolveUsbipdPath(deps);
  const busIds = listUsbipdBusIds(usbipdPath, deps);
  const busId = busIds[0];

  if (!busId) {
    return { started: false, message: DC_USBIPD_MANUAL_HELP };
  }

  return startUsbAutoAttach(busId, deps);
}
