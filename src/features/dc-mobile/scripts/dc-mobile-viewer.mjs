#!/usr/bin/env node
/**
 * dc-mobile live viewer (S1–S6).
 *
 * Usage:
 *   node dc-mobile-viewer.mjs --serial <serial> --frame <frame.png> \
 *                             [--adb <bin>] [--interval <ms>]
 *   node dc-mobile-viewer.mjs <frame.png>     # legacy display-only form (S7)
 *
 * The capture loop lives here, in the detached child, never in the extension
 * process (S2): the TUI stays adb-free and timer-free.
 *
 * S3: one `adb -s <serial> exec-out screencap -p` at a time; a tick that lands
 * while the previous capture is still running is skipped, never queued. The
 * frame is written to a temp file and renamed into `latest.png`, so
 * `kitten icat` never reads a half-written PNG. The loop reuses that single
 * path — it never writes `frame-<ts>.png` — and only removes its own leftover
 * temp files, so `dc_mobile_screen_inspect`'s timestamped evidence is never
 * deleted (S7).
 *
 * S4: every failure is drawn as text: adb unavailable, exit status, the first
 * stderr line, or a failing/absent `kitten icat`.
 *
 * S6: SIGTERM/SIGINT/SIGHUP and a lost stdout stop the loop and kill the live
 * `adb` child, leaving no orphan capture behind.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, renameSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Measured cost of `adb exec-out screencap -p` is 0.75 s; never go faster. */
const DEFAULT_INTERVAL_MS = 1_000;
const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 10_000;
const DEFAULT_ADB = "adb";

const RESET = "\x1b[0m";
const CLEAR = "\x1b[2J\x1b[H";
const BG = "\x1b[48;2;16;10;13m";
const ACCENT = "\x1b[38;2;255;51;51m";
const FOREGROUND = "\x1b[38;2;255;204;204m";
const DEEP_RED = "\x1b[48;2;51;0;0m";

function usage() {
  process.stderr.write(
    "uso: dc-mobile-viewer.mjs --serial <serial> --frame <frame.png> [--adb <bin>] [--interval <ms>]\n" +
      "     dc-mobile-viewer.mjs <frame.png>\n",
  );
}

function parseArgs(argv) {
  const parsed = {
    serial: "",
    framePath: undefined,
    adbBin: DEFAULT_ADB,
    intervalMs: DEFAULT_INTERVAL_MS,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => (index + 1 < argv.length ? argv[(index += 1)] : undefined);

    switch (argument) {
      case "--serial":
        parsed.serial = String(value() ?? "").trim();
        break;
      case "--frame":
        parsed.framePath = value();
        break;
      case "--adb":
        parsed.adbBin = String(value() ?? "").trim() || DEFAULT_ADB;
        break;
      case "--interval": {
        const raw = Number(value());
        if (Number.isFinite(raw) && raw > 0) parsed.intervalMs = raw;
        break;
      }
      default:
        if (!argument.startsWith("-")) positional.push(argument);
        break;
    }
  }

  if (!parsed.framePath) parsed.framePath = positional[0];
  return parsed;
}

function firstLine(value) {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
}

const { serial, framePath, adbBin, intervalMs } = parseArgs(process.argv.slice(2));

if (!framePath) {
  usage();
  process.exit(2);
}

const cadence = Math.max(MIN_INTERVAL_MS, Math.min(intervalMs, MAX_INTERVAL_MS));
const frameDir = dirname(framePath);
const frameName = basename(framePath);
const tempPrefix = `.${frameName}.tmp-`;
const tempPath = join(frameDir, `${tempPrefix}${process.pid}`);

let closed = false;
let drawing = false;
let capturing = false;
let adbChild;
let captureTimer;
let watcher;
let statusText = "";
let lastDrawKey = "";

function terminalSize() {
  return {
    columns: Math.max(20, process.stdout.columns || 100),
    rows: Math.max(6, process.stdout.rows || 40),
  };
}

function writeStdout(text) {
  try {
    process.stdout.write(text);
  } catch {
    // The window may already be gone; nothing left to draw on.
  }
}

function writeLine(text) {
  writeStdout(`${text}\n`);
}

function drawWaiting(message) {
  writeStdout(`${DEEP_RED}${FOREGROUND} ${message}${RESET}\n`);
}

/** S4: the reason is text in the window, never a blank surface. */
function drawStatus() {
  if (!statusText) return;
  writeLine(`${DEEP_RED}${ACCENT} ${statusText}${RESET}`);
}

function frameStamp() {
  try {
    const stats = statSync(framePath);
    return String(stats.mtimeMs);
  } catch {
    return "missing";
  }
}

function draw(force = false) {
  if (closed || drawing) return;

  const key = `${statusText}\u0000${frameStamp()}`;
  if (!force && key === lastDrawKey) return;
  lastDrawKey = key;
  drawing = true;

  try {
    const { columns, rows } = terminalSize();
    const label = serial ? `${serial} \u00b7 ${frameName}` : frameName;

    writeStdout(CLEAR);
    writeLine(
      `${BG}${ACCENT}\u258c${FOREGROUND} DC MOBILE ${ACCENT}\u00b7${FOREGROUND} ${label}${RESET}`,
    );
    writeLine(`${DEEP_RED}${ACCENT}${"\u2500".repeat(columns)}${RESET}`);

    if (!existsSync(framePath)) {
      drawStatus();
      drawWaiting(statusText ? "sin frame todavía" : "esperando frame...");
      return;
    }

    drawStatus();

    const place = `${Math.max(1, columns - 2)}x${Math.max(1, rows - 3)}@1x2`;
    const result = spawnSync(
      "kitten",
      ["icat", "--stdin", "no", "--place", place, framePath],
      {
        stdio: ["ignore", "inherit", "pipe"],
        encoding: "utf8",
      },
    );

    if (result.error) {
      statusText = `kitten icat no está disponible: ${firstLine(result.error.message)}`;
      drawStatus();
      lastDrawKey = `${statusText}\u0000${frameStamp()}`;
      return;
    }

    if (typeof result.status === "number" && result.status !== 0) {
      const detail = firstLine(result.stderr) || "sin detalle";
      statusText = `kitten icat falló (exit ${result.status}): ${detail}`;
      drawStatus();
      lastDrawKey = `${statusText}\u0000${frameStamp()}`;
      return;
    }

    if (statusText.startsWith("kitten icat")) {
      statusText = "";
      lastDrawKey = `${statusText}\u0000${frameStamp()}`;
    }
  } catch (error) {
    statusText = `visor: ${firstLine(error?.message) || "error inesperado"}`;
    drawStatus();
  } finally {
    drawing = false;
  }
}

/** Removes the temp files this viewer owns; inspect's frames stay untouched. */
function pruneOwnArtifacts() {
  let entries;
  try {
    entries = readdirSync(frameDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.startsWith(tempPrefix)) continue;
    try {
      rmSync(join(frameDir, entry), { force: true });
    } catch {
      // Best effort: a leftover temp file never breaks the viewer.
    }
  }
}

/** S3: temp file + same-directory rename, so icat never reads a partial PNG. */
function writeFrameAtomically(png) {
  writeFileSync(tempPath, png);
  renameSync(tempPath, framePath);
}

function setStatus(message) {
  const next = String(message ?? "").trim();
  if (next === statusText) return;
  statusText = next;
  draw();
}

function stopCapture() {
  if (captureTimer !== null && captureTimer !== undefined) {
    clearInterval(captureTimer);
    captureTimer = undefined;
  }

  if (adbChild) {
    const child = adbChild;
    adbChild = undefined;
    try {
      child.kill("SIGTERM");
    } catch {
      // The capture may have already exited.
    }
  }
}

function cleanup(exitCode = 0) {
  if (closed) return;
  closed = true;

  stopCapture();

  try {
    watcher?.close();
  } catch {
    // Watcher may already be closed.
  }

  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best effort.
  }

  writeStdout(`${RESET}${CLEAR}`);
  process.exit(exitCode);
}

/** S3: one capture in flight; a tick that arrives meanwhile is skipped. */
function captureTick() {
  if (closed || !serial || capturing) return;
  capturing = true;

  let child;
  const stdoutChunks = [];
  const stderrChunks = [];

  try {
    child = spawn(adbBin, ["-s", serial, "exec-out", "screencap", "-p"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    capturing = false;
    setStatus(`adb no disponible (${adbBin}): ${firstLine(error?.message) || "no se pudo ejecutar"}`);
    return;
  }

  adbChild = child;

  child.stdout?.on("data", (chunk) => stdoutChunks.push(chunk));
  child.stderr?.on("data", (chunk) => stderrChunks.push(chunk));

  child.on("error", (error) => {
    adbChild = undefined;
    capturing = false;
    if (closed) return;
    setStatus(`adb no disponible (${adbBin}): ${firstLine(error?.message) || "spawn falló"}`);
  });

  child.on("close", (code, signal) => {
    adbChild = undefined;
    capturing = false;
    if (closed) return;

    const stderr = Buffer.concat(stderrChunks).toString("utf8");

    if (code !== 0) {
      const detail = firstLine(stderr) || (signal ? `señal ${signal}` : "sin stderr");
      const status = typeof code === "number" ? `exit ${code}` : `terminado por ${signal}`;
      setStatus(`adb falló (${status}): ${detail}`);
      return;
    }

    const png = Buffer.concat(stdoutChunks);
    if (png.length === 0) {
      setStatus("adb devolvió un frame vacío.");
      return;
    }

    try {
      writeFrameAtomically(png);
    } catch (error) {
      setStatus(`no se pudo escribir ${frameName}: ${firstLine(error?.message) || "error de fs"}`);
      return;
    }

    setStatus("");
    draw();
  });
}

function startCapture() {
  captureTick();
  captureTimer = setInterval(captureTick, cadence);
}

pruneOwnArtifacts();

try {
  watcher = watch(frameDir, (_event, filename) => {
    if (!filename) return;
    if (filename.toString() !== frameName) return;
    draw();
  });
} catch (error) {
  process.stderr.write(
    `dc-mobile-viewer: no se pudo observar ${frameDir}: ${firstLine(error?.message)}\n`,
  );
  process.exit(1);
}

watcher.on("error", () => cleanup(1));

process.stdout.on("resize", () => draw(true));
process.stdout.on("error", () => cleanup(0));

process.on("SIGTERM", () => cleanup(0));
process.on("SIGINT", () => cleanup(0));
process.on("SIGHUP", () => cleanup(0));
process.on("exit", () => stopCapture());

draw(true);

if (serial) {
  startCapture();
}
