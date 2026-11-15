import { execFile } from "node:child_process";
import { DC_ADB_UNAVAILABLE_MESSAGE } from "./dc-adb-driver.ts";
import {
  connectWifi,
  isValidWifiAddress,
  pairWifi,
  type DcMobileConnectionOutcome,
} from "./dc-mobile-connection.ts";

/**
 * Asynchronous Wi-Fi connect/pair for the single-path wizard (S5).
 *
 * The synchronous `connectWifi`/`pairWifi` helpers stay untouched because the
 * tools need a blocking result. The wizard cannot block the TUI while adb
 * runs, so this module runs `adb` with `execFile` and reports each command and
 * its output through a log callback that repaints the modal.
 *
 * Outcome formatting is not duplicated: once adb's output is available, the
 * sync helpers interpret it through a throw-away driver, so both code paths
 * share the same failure detection and messages.
 */

export type DcMobileLog = (line: string) => void;

export interface DcMobileAdbRunner {
  (args: string[], log: DcMobileLog): Promise<{ ok: boolean; output: string }>;
}

/** adb gives up on a connect attempt after 20s, pairing gets 30s. */
export const DC_MOBILE_ASYNC_CONNECT_TIMEOUT_MS = 20_000;
export const DC_MOBILE_ASYNC_PAIR_TIMEOUT_MS = 30_000;

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function describeRunnerError(error: unknown): string {
  if (errorCode(error) === "ENOENT") return DC_ADB_UNAVAILABLE_MESSAGE;

  if (error && typeof error === "object") {
    const candidate = error as { message?: string };
    if (candidate.message) return candidate.message;
  }

  return String(error);
}

function oneLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" · ");
}

function asText(value: unknown): string {
  return (Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? "")).trim();
}

/** Reuses the sync validator's exact message without running adb. */
function invalidConnectAddress(address: string): DcMobileConnectionOutcome {
  return connectWifi({ connect: () => "" }, address);
}

/** Reuses the sync validator's exact address/code messages without running adb. */
function validatePairInput(address: string, code: string): DcMobileConnectionOutcome | undefined {
  const noopDriver = { connect: () => "", pair: () => "" };

  if (!isValidWifiAddress(address)) return pairWifi(noopDriver, address, code);
  if (!/^\d{6}$/.test(code)) return pairWifi(noopDriver, address, code);
  return undefined;
}

/**
 * Production runner. Every call logs the exact command and a single line with
 * the trimmed stdout/stderr so the progress screen shows what adb is doing.
 */
export function createAdbRunner(adbPath = "adb"): DcMobileAdbRunner {
  return (args, log) => {
    const timeout = args[0] === "pair"
      ? DC_MOBILE_ASYNC_PAIR_TIMEOUT_MS
      : DC_MOBILE_ASYNC_CONNECT_TIMEOUT_MS;

    log(`$ ${adbPath} ${args.join(" ")}`);

    return new Promise((resolve) => {
      execFile(
        adbPath,
        args,
        { timeout, maxBuffer: 1024 * 1024, encoding: "utf8" },
        (error, stdout, stderr) => {
          const combined = [stdout, stderr]
            .map((value) => String(value ?? ""))
            .filter((value) => value.trim().length > 0)
            .join("\n")
            .trim();
          const output = combined || (error ? describeRunnerError(error) : "");

          log(oneLine(output) || "(sin salida)");
          resolve({ ok: !error, output });
        },
      );
    });
  };
}

/**
 * Async counterpart of `connectWifi`: validates the address, runs one
 * `adb connect` and returns the same outcome shape without throwing.
 */
export async function connectWifiAsync(
  runner: DcMobileAdbRunner,
  address: string,
  log: DcMobileLog,
): Promise<DcMobileConnectionOutcome> {
  const value = typeof address === "string" ? address.trim() : "";

  if (!isValidWifiAddress(value)) return invalidConnectAddress(value);

  log(`▶ Conectando a ${value}…`);

  let result: { ok: boolean; output: string };
  try {
    result = await runner(["connect", value], log);
  } catch (error) {
    return { ok: false, message: describeRunnerError(error) };
  }

  const text = asText(result.output);

  // A process error (timeout, missing adb, rejected promise) is never a
  // successful connect, even when adb printed nothing useful before dying.
  if (!result.ok) {
    return { ok: false, message: text || `No se pudo conectar a ${value}.` };
  }

  // The sync helper owns the "failed to connect…" detection and messages.
  return connectWifi({ connect: () => text }, value);
}

/**
 * Async counterpart of the pairing half of `pairWifi` (S4/S7). It only runs
 * `adb pair`; the wizard retries the connect against the main-screen address
 * it already has. `paired: true` tells the wizard the retry is worthwhile.
 */
export async function pairWifiAsync(
  runner: DcMobileAdbRunner,
  address: string,
  code: string,
  log: DcMobileLog,
): Promise<DcMobileConnectionOutcome> {
  const value = typeof address === "string" ? address.trim() : "";
  const pairingCode = typeof code === "string" ? code.trim() : "";

  const invalid = validatePairInput(value, pairingCode);
  if (invalid) return invalid;

  log(`▶ Vinculando ${value}…`);

  let result: { ok: boolean; output: string };
  try {
    result = await runner(["pair", value, pairingCode], log);
  } catch (error) {
    return { ok: false, message: describeRunnerError(error) };
  }

  const text = asText(result.output);

  // The sync helper owns the "adb pair falló" fallback message.
  if (!/successfully paired/i.test(text)) {
    return pairWifi({ connect: () => "", pair: () => text }, value, pairingCode);
  }

  return {
    ok: true,
    serial: value,
    paired: true,
    message: `Vinculado a ${value}.`,
  };
}
