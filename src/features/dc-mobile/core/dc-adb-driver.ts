import { execFileSync } from "node:child_process";

/**
 * Thin ADB driver used by the dc-mobile tools.
 *
 * Every call carries an explicit timeout and every failure is converted into a
 * typed `DcAdbError` so the tool layer can answer with `isError: true` instead
 * of tearing down the session (S9).
 */

export const DC_ADB_UNAVAILABLE_MESSAGE =
  "adb no está disponible. Instalá Android platform-tools y reintentá.";

export const DC_EMPTY_TEXT_MESSAGE = "texto vacío: nada que escribir.";

export type DcAdbEncoding = "utf8" | "buffer";

export interface DcAdbExecOptions {
  encoding: DcAdbEncoding;
  timeout: number;
  maxBuffer: number;
}

/** Injectable command runner (tests replace this, production uses execFileSync). */
export type DcAdbExecFn = (
  file: string,
  args: string[],
  options: DcAdbExecOptions,
) => string | Buffer;

export type DcAdbErrorCode =
  | "ADB_UNAVAILABLE"
  | "ADB_COMMAND_FAILED"
  | "INVALID_ARGUMENT"
  | "INVALID_RESPONSE";

export class DcAdbError extends Error {
  readonly code: DcAdbErrorCode;
  readonly detail?: string;

  constructor(code: DcAdbErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "DcAdbError";
    this.code = code;
    this.detail = detail;
  }
}

export interface DcAdbDevice {
  serial: string;
  state: string;
  model: string;
}

export interface DcAdbDriverOptions {
  execFn?: DcAdbExecFn;
  adbBin?: string;
  defaultTimeoutMs?: number;
}

/** Key names accepted by `inputKey`, mapped to Android keycodes (S4). */
export const ADB_KEYCODES: Readonly<Record<string, string>> = {
  back: "KEYCODE_BACK",
  home: "KEYCODE_HOME",
  enter: "KEYCODE_ENTER",
  tab: "KEYCODE_TAB",
};

const SHELL_SPECIALS = /([\\'"`$&|;<>()[\]*?{}~#])/g;

function defaultExecFn(
  file: string,
  args: string[],
  options: DcAdbExecOptions,
): string | Buffer {
  const shared = {
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
  };

  if (options.encoding === "buffer") {
    return execFileSync(file, args, shared);
  }

  return execFileSync(file, args, { ...shared, encoding: "utf8" });
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

function readErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Escapes user text for `adb shell input text` (S4).
 * - Spaces become `%s`.
 * - Shell metacharacters are backslash-escaped because `adb shell` re-parses
 *   its arguments on the device side.
 */
export function escapeAdbInputText(text: string): string {
  if (!text || text.trim().length === 0) {
    throw new DcAdbError("INVALID_ARGUMENT", DC_EMPTY_TEXT_MESSAGE);
  }

  return text.replace(/ /g, "%s").replace(SHELL_SPECIALS, "\\$1");
}

/** Resolves a symbolic key name to an Android keycode (S4). */
export function resolveAdbKeycode(key: string): string {
  const normalized = (key ?? "").trim().toLowerCase();
  const keycode = ADB_KEYCODES[normalized];

  if (!keycode) {
    throw new DcAdbError(
      "INVALID_ARGUMENT",
      `key desconocido: ${key}. Usá back, home, enter o tab.`,
    );
  }

  return keycode;
}

export class DcAdbDriver {
  private readonly execFn: DcAdbExecFn;
  private readonly adbBin: string;
  private readonly timeoutMs: number;

  constructor(options: DcAdbDriverOptions = {}) {
    this.execFn = options.execFn ?? defaultExecFn;
    this.adbBin = options.adbBin ?? "adb";
    this.timeoutMs = options.defaultTimeoutMs ?? 15_000;
  }

  /** True when the adb binary exists and answers. Never throws. */
  isAvailable(): boolean {
    try {
      this.run(["version"], { timeout: Math.min(3_000, this.timeoutMs) });
      return true;
    } catch {
      return false;
    }
  }

  listDevices(): DcAdbDevice[] {
    const raw = this.run(["devices", "-l"]);
    const output = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
    const devices: DcAdbDevice[] = [];

    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("List of devices")) continue;
      if (trimmed.startsWith("*")) continue;
      if (trimmed.startsWith("adb ")) continue;

      const parts = trimmed.split(/\s+/);
      const serial = parts[0];
      if (!serial) continue;

      const state = parts[1] ?? "unknown";
      const modelToken = parts.find((part) => part.startsWith("model:"));
      const model = modelToken
        ? modelToken.slice("model:".length).replace(/_/g, " ")
        : "-";

      devices.push({ serial, state, model });
    }

    return devices;
  }

  captureScreen(serial: string): Buffer {
    const result = this.run(this.serialArgs(serial, ["exec-out", "screencap", "-p"]), {
      encoding: "buffer",
      timeout: Math.max(30_000, this.timeoutMs),
      maxBuffer: 64 * 1024 * 1024,
    });

    return Buffer.isBuffer(result) ? result : Buffer.from(String(result), "utf8");
  }

  dumpHierarchy(serial: string): string {
    const result = this.run(
      this.serialArgs(serial, ["exec-out", "uiautomator", "dump", "/dev/tty"]),
      { timeout: Math.max(30_000, this.timeoutMs) },
    );

    return Buffer.isBuffer(result) ? result.toString("utf8") : result;
  }

  inputTap(serial: string, x: number, y: number): void {
    this.run(
      this.serialArgs(serial, [
        "shell",
        "input",
        "tap",
        String(this.coordinate(x, "x")),
        String(this.coordinate(y, "y")),
      ]),
    );
  }

  inputText(serial: string, text: string): void {
    const escaped = escapeAdbInputText(text);
    this.run(this.serialArgs(serial, ["shell", "input", "text", escaped]));
  }

  inputKey(serial: string, key: string): void {
    const keycode = resolveAdbKeycode(key);
    this.run(this.serialArgs(serial, ["shell", "input", "keyevent", keycode]));
  }

  swipe(
    serial: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs = 300,
  ): void {
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new DcAdbError(
        "INVALID_ARGUMENT",
        "duración inválida: usá milisegundos mayores a cero.",
      );
    }

    this.run(
      this.serialArgs(serial, [
        "shell",
        "input",
        "swipe",
        String(this.coordinate(x1, "x1")),
        String(this.coordinate(y1, "y1")),
        String(this.coordinate(x2, "x2")),
        String(this.coordinate(y2, "y2")),
        String(Math.round(duration)),
      ]),
    );
  }

  launch(serial: string, packageName: string): void {
    const pkg = this.packageName(packageName);
    this.run(
      this.serialArgs(serial, [
        "shell",
        "monkey",
        "-p",
        pkg,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
      ]),
    );
  }

  forceStop(serial: string, packageName: string): void {
    const pkg = this.packageName(packageName);
    this.run(this.serialArgs(serial, ["shell", "am", "force-stop", pkg]));
  }

  private run(
    args: string[],
    overrides: Partial<DcAdbExecOptions> = {},
  ): string | Buffer {
    const options: DcAdbExecOptions = {
      encoding: overrides.encoding ?? "utf8",
      timeout: overrides.timeout ?? this.timeoutMs,
      maxBuffer: overrides.maxBuffer ?? 64 * 1024 * 1024,
    };

    try {
      return this.execFn(this.adbBin, args, options);
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

  private serialArgs(serial: string, args: string[]): string[] {
    const trimmed = (serial ?? "").trim();
    if (!trimmed) {
      throw new DcAdbError(
        "INVALID_ARGUMENT",
        "serial vacío: indicá el serial del dispositivo.",
      );
    }
    return ["-s", trimmed, ...args];
  }

  private coordinate(value: number, name: string): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new DcAdbError(
        "INVALID_ARGUMENT",
        `coordenada inválida: ${name} debe ser un número.`,
      );
    }
    return Math.round(numeric);
  }

  private packageName(value: string): string {
    const pkg = (value ?? "").trim();
    if (!pkg) {
      throw new DcAdbError("INVALID_ARGUMENT", "package vacío: indicá el paquete Android.");
    }
    if (!/^[A-Za-z0-9._-]+$/.test(pkg)) {
      throw new DcAdbError("INVALID_ARGUMENT", `package inválido: ${pkg}`);
    }
    return pkg;
  }
}
