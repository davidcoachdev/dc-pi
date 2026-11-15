import type {
  DcMobileAdbRunner,
  DcMobileLog,
} from "./dc-mobile-async-connection.ts";
import {
  parseUiHierarchy,
  type DcMobileElement,
} from "./dc-ui-hierarchy-parser.ts";

/**
 * Reads the current wireless-debugging `IP:port` from the phone itself (S2/S3).
 *
 * The only entry point is the public Development settings screen: the direct
 * fragment intent throws a SecurityException on the verified device, so it is
 * never used. Every adb call goes through the injected async runner, which
 * keeps the TUI responsive and lets tests record the exact argument lists.
 *
 * Failure is silent (S4): a missing row, a missing value or an address that
 * does not validate returns `undefined`. The caller keeps its previous
 * behaviour and no new error surface is introduced.
 */

export interface DcMobileWirelessDebuggingAddress {
  address: string;
  host: string;
  port: number;
}

/** S3: strict `IPv4:port` shape; validation happens after the match. */
const ADDRESS_PATTERN = /\b(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})\b/g;

const WIRELESS_ROW_PATTERN = /depuraci[oó]n inal[aá]mbrica|wireless debugging/i;
const ADDRESS_LABEL_PATTERN = /direcci[oó]n ip y puerto|ip address/i;

const DEVELOPMENT_SETTINGS_ARGS = [
  "shell",
  "am",
  "start",
  "-a",
  "android.settings.APPLICATION_DEVELOPMENT_SETTINGS",
];
const DUMP_ARGS = ["exec-out", "uiautomator", "dump", "/dev/tty"];
const SWIPE_UP_ARGS = ["shell", "input", "swipe", "540", "1600", "540", "600", "300"];
const BACK_ARGS = ["shell", "input", "keyevent", "KEYCODE_BACK"];

/** S2: the row can sit below the fold; six swipes are enough on the device. */
const MAX_SCROLLS = 6;
/** S6: the detection opens at most two screens, so at most two backs. */
const MAX_BACKS = 2;
/** Settings transitions are animated; give uiautomator time to see the new screen. */
const SCREEN_SETTLE_MS = 300;

const noLog: DcMobileLog = () => {};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DcMobileCommandResult {
  ok: boolean;
  output: string;
}

/** A rejected promise or a thrown runner is a failed command, never a crash. */
async function runCommand(
  runner: DcMobileAdbRunner,
  args: string[],
  log: DcMobileLog,
): Promise<DcMobileCommandResult> {
  try {
    const result = await runner(args, log);
    return { ok: result.ok, output: result.output };
  } catch {
    return { ok: false, output: "" };
  }
}

async function dumpHierarchy(
  runner: DcMobileAdbRunner,
  log: DcMobileLog,
): Promise<DcMobileElement[]> {
  const result = await runCommand(runner, DUMP_ARGS, log);
  if (!result.ok) return [];
  return parseUiHierarchy(result.output);
}

function isPrivateOrLinkLocal(host: string): boolean {
  const octets = host.split(".").map(Number);
  if (octets.length !== 4) return false;
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets as [number, number, number, number];
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

/** S3: only private/link-local hosts and ports 1-65535 are accepted. */
function parseWirelessDebuggingAddress(
  text: string,
): DcMobileWirelessDebuggingAddress | undefined {
  if (typeof text !== "string" || text.length === 0) return undefined;

  // A fresh regex per call keeps the shared `lastIndex` out of the way.
  const pattern = new RegExp(ADDRESS_PATTERN.source, "g");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const host = match[1]!;
    const port = Number(match[2]!);

    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (!isPrivateOrLinkLocal(host)) continue;

    return { address: `${host}:${port}`, host, port };
  }

  return undefined;
}

/**
 * A Settings row exposes its label twice: as `text` on the title (not clickable)
 * and as `content-desc` on the switch, which the parser folds into `text` as
 * well. The switch must never be tapped: it turns wireless debugging off.
 */
function findWirelessRow(elements: DcMobileElement[]): DcMobileElement | undefined {
  return elements.find(
    (element) => WIRELESS_ROW_PATTERN.test(element.text) && !isToggle(element),
  );
}

function isToggle(element: DcMobileElement): boolean {
  return /switch|toggle|checkbox/i.test(element.resourceId);
}

/**
 * S2: the value row lives next to the `Dirección IP y puerto` label. When the
 * label is present, nodes after it are preferred so another screen never wins.
 */
function findAddressValue(
  elements: DcMobileElement[],
): DcMobileWirelessDebuggingAddress | undefined {
  const labelIndex = elements.findIndex((element) =>
    ADDRESS_LABEL_PATTERN.test(element.text),
  );
  const ordered =
    labelIndex > 0
      ? [...elements.slice(labelIndex), ...elements.slice(0, labelIndex)]
      : elements;

  for (const element of ordered) {
    const parsed = parseWirelessDebuggingAddress(element.text);
    if (parsed) return parsed;
  }

  return undefined;
}

/**
 * Opens Development settings, scrolls to `Depuración inalámbrica` (Spanish or
 * English label), taps it and reads the first valid `IP:port`. Returns
 * `undefined` on any failure and leaves the phone on the previous screen by
 * pressing back once per screen the detection opened (S6).
 */
export async function readWirelessDebuggingAddress(
  runner: DcMobileAdbRunner,
  log: DcMobileLog = noLog,
): Promise<DcMobileWirelessDebuggingAddress | undefined> {
  let screensOpened = 0;

  try {
    const started = await runCommand(runner, DEVELOPMENT_SETTINGS_ARGS, log);
    if (!started.ok) return undefined;
    screensOpened = 1;

    await sleep(SCREEN_SETTLE_MS);
    let elements = await dumpHierarchy(runner, log);
    let row = findWirelessRow(elements);

    for (let scroll = 0; !row && scroll < MAX_SCROLLS; scroll++) {
      await runCommand(runner, SWIPE_UP_ARGS, log);
      await sleep(SCREEN_SETTLE_MS);
      elements = await dumpHierarchy(runner, log);
      row = findWirelessRow(elements);
    }

    if (!row) return undefined;

    const tap = ["shell", "input", "tap", String(row.center.x), String(row.center.y)];
    await runCommand(runner, tap, log);
    screensOpened = 2;

    await sleep(SCREEN_SETTLE_MS);
    const addressElements = await dumpHierarchy(runner, log);
    return findAddressValue(addressElements);
  } catch {
    return undefined;
  } finally {
    for (let back = 0; back < Math.min(screensOpened, MAX_BACKS); back++) {
      await runCommand(runner, BACK_ARGS, log);
    }
  }
}
