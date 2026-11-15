import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Event-driven live viewer for dc-mobile (S1–S4, S7).
 *
 * Frames are written to `~/.cache/dc-mobile/<serial>/latest.png`. A single
 * detached Kitty window per serial runs `scripts/dc-mobile-viewer.mjs`, which
 * owns the capture loop: one `adb exec-out screencap -p` at a time, about one
 * frame per second (measured cost 0.75 s), atomic `latest.png` writes and text
 * errors inside the window. This module never starts a timer and never runs adb
 * inside `render()`: it validates adb once, then hands the work to the child.
 */

export const DC_MOBILE_CACHE_ROOT = path.join(os.homedir(), ".cache", "dc-mobile");

/** Measured cost of one capture is 0.75 s; one frame per second is the ceiling. */
export const DC_MOBILE_VIEWER_INTERVAL_MS = 1_000;

export const DC_MOBILE_DEFAULT_ADB = "adb";

export const DC_MOBILE_VIEWER_SCRIPT = fileURLToPath(
  new URL("../scripts/dc-mobile-viewer.mjs", import.meta.url),
);

export const DC_MOBILE_KITTY_OPTIONS: ReadonlyArray<string> = [
  "hide_window_decorations=yes",
  "remember_window_size=no",
  "confirm_os_window_close=0",
  "background=#100a0d",
  "linux_display_server=wayland",
];

export interface DcSavedFrame {
  serial: string;
  framePath: string;
  latestPath: string;
}

export type DcLiveViewerState = "started" | "reused" | "unavailable";

/**
 * Why the viewer could not start (T2/S4). A blank window with a silent spawn
 * error is the defect: every failure maps to one of these reasons and the card
 * records the resulting message in its activity log.
 */
export type DcLiveViewerFailureReason =
  | "serial-vacio"
  | "adb-no-disponible"
  | "kitty-no-disponible"
  | "script-ausente"
  | "spawn-fallido";

/** Records a failure that happens after `openLiveViewer` returned (async spawn). */
export type DcLiveViewerFailureHandler = (
  reason: DcLiveViewerFailureReason,
  message: string,
) => void;

export interface DcLiveViewerResult extends DcSavedFrame {
  viewer: DcLiveViewerState;
  message: string;
  pid?: number;
  /** Present only when `viewer` is `unavailable` (T2/S4). */
  failureReason?: DcLiveViewerFailureReason;
}

/** One reason → one Spanish line, so the card log and the window agree. */
export function formatViewerFailure(
  reason: DcLiveViewerFailureReason,
  detail = "",
): string {
  const suffix = detail ? `: ${detail}` : "";

  switch (reason) {
    case "serial-vacio":
      return "serial vacío: no se puede abrir el visor en vivo.";
    case "adb-no-disponible":
      return `adb no disponible${suffix}; conectá el dispositivo y verificá adb.`;
    case "kitty-no-disponible":
      return `kitty no está disponible${suffix}.`;
    case "script-ausente":
      return `no se encontró el script del visor${suffix}.`;
    case "spawn-fallido":
      return `no se pudo iniciar el visor Kitty${suffix}.`;
  }
}

export type DcViewerExecFn = (
  file: string,
  args: string[],
  options: { timeout: number },
) => string | Buffer;

export interface DcLiveViewerOptions {
  /** PNG bytes to persist before launching the viewer. */
  frame?: Buffer;
  /** Already-persisted frame (inspect writes it); refreshed into latest.png. */
  framePath?: string;
  cacheRoot?: string;
  scriptPath?: string;
  kittyBin?: string;
  /** adb binary handed to the child capture loop (S1/T1). */
  adbBin?: string;
  /** Capture cadence; clamped to >= 1 s by the child (S3). */
  intervalMs?: number;
  title?: string;
  spawnFn?: typeof spawn;
  execFn?: DcViewerExecFn;
  /** Async-only failures (spawn `error`); sync failures are in the result. */
  onFailure?: DcLiveViewerFailureHandler;
}

/** Live viewer PID per serial, tracked in-process (S5: reuse, never duplicate). */
const liveViewers = new Map<string, number>();

const defaultExecFn: DcViewerExecFn = (file, args, options) =>
  execFileSync(file, args, {
    encoding: "utf8",
    timeout: options.timeout,
    stdio: ["ignore", "pipe", "ignore"],
  });

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    return code === "EPERM";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Filesystem-safe cache entry name. Normal serials are returned unchanged. */
export function sanitizeSerialForPath(serial: string): string {
  const safe = (serial ?? "").trim().replace(/[^A-Za-z0-9._-]/g, "_");
  return safe.length > 0 ? safe : "device";
}

export function resolveFrameDir(serial: string, cacheRoot = DC_MOBILE_CACHE_ROOT): string {
  return path.join(cacheRoot, sanitizeSerialForPath(serial));
}

export function getLatestFramePath(serial: string, cacheRoot = DC_MOBILE_CACHE_ROOT): string {
  return path.join(resolveFrameDir(serial, cacheRoot), "latest.png");
}

/**
 * mtime of `latest.png`, the only freshness source for the card's
 * `último frame hace Ns` (S5/T3). Undefined when no frame file exists.
 */
export function getLatestFrameMtime(
  serial: string,
  cacheRoot = DC_MOBILE_CACHE_ROOT,
): number | undefined {
  try {
    const stats = statSync(getLatestFramePath(serial, cacheRoot));
    return stats.mtimeMs;
  } catch {
    return undefined;
  }
}

/** Writes the timestamped frame and refreshes latest.png (S3/S5). */
export function saveFrame(
  serial: string,
  png: Buffer,
  cacheRoot = DC_MOBILE_CACHE_ROOT,
): DcSavedFrame {
  const directory = resolveFrameDir(serial, cacheRoot);
  mkdirSync(directory, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const framePath = path.join(directory, `frame-${stamp}.png`);
  const latestPath = path.join(directory, "latest.png");

  writeFileSync(framePath, png);
  writeFileSync(latestPath, png);

  return { serial, framePath, latestPath };
}

export function getLiveViewerPid(serial: string): number | undefined {
  const pid = liveViewers.get(serial);
  if (pid === undefined) return undefined;

  if (isProcessAlive(pid)) return pid;

  liveViewers.delete(serial);
  return undefined;
}

export function isLiveViewerRunning(serial: string): boolean {
  return getLiveViewerPid(serial) !== undefined;
}

/** Test hook: forget tracked viewers without touching processes. */
export function resetLiveViewerTracking(): void {
  liveViewers.clear();
}

function canRunKitty(kittyBin: string, execFn: DcViewerExecFn): boolean {
  try {
    execFn(kittyBin, ["--version"], { timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

/** T2: adb is validated up front so a missing adb never opens a blank window. */
function canRunAdb(adbBin: string, execFn: DcViewerExecFn): boolean {
  try {
    execFn(adbBin, ["version"], { timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

function refreshLatest(saved: DcSavedFrame): void {
  if (saved.framePath !== saved.latestPath && existsSync(saved.framePath)) {
    try {
      copyFileSync(saved.framePath, saved.latestPath);
    } catch {
      // Non-fatal: the timestamped frame is already on disk.
    }
  }
}

function failLiveViewer(
  saved: DcSavedFrame,
  reason: DcLiveViewerFailureReason,
  detail = "",
): DcLiveViewerResult {
  return {
    ...saved,
    viewer: "unavailable",
    failureReason: reason,
    message: formatViewerFailure(reason, detail),
  };
}

/**
 * Script arguments for the detached capture loop (T1/T2): the child receives the
 * raw serial (adb needs it verbatim), the shared frame path, the adb binary and
 * the cadence. Exported so the mapping is testable without spawning anything.
 */
export function buildViewerScriptArgs(params: {
  serial: string;
  framePath: string;
  adbBin?: string;
  intervalMs?: number;
}): string[] {
  return [
    "--serial",
    params.serial,
    "--frame",
    params.framePath,
    "--adb",
    params.adbBin ?? DC_MOBILE_DEFAULT_ADB,
    "--interval",
    String(params.intervalMs ?? DC_MOBILE_VIEWER_INTERVAL_MS),
  ];
}

function buildKittyArgs(title: string, scriptPath: string, scriptArgs: string[]): string[] {
  const options = DC_MOBILE_KITTY_OPTIONS.flatMap((option) => ["-o", option]);
  return ["--title", title, ...options, process.execPath, scriptPath, ...scriptArgs];
}

/**
 * Opens (or reuses) the live Kitty viewer for a serial.
 *
 * Never throws: when Kitty is unavailable the result carries a soft failure
 * message while the captured frame stays on disk.
 */
export function openLiveViewer(
  serial: string,
  options: DcLiveViewerOptions = {},
): DcLiveViewerResult {
  const serialId = (serial ?? "").trim();
  const cacheRoot = options.cacheRoot ?? DC_MOBILE_CACHE_ROOT;

  if (!serialId) {
    const latestPath = path.join(cacheRoot, "device", "latest.png");
    return {
      serial: "",
      framePath: latestPath,
      latestPath,
      viewer: "unavailable",
      failureReason: "serial-vacio",
      message: formatViewerFailure("serial-vacio"),
    };
  }

  let saved: DcSavedFrame;

  if (options.frame && options.frame.length > 0) {
    saved = saveFrame(serialId, options.frame, cacheRoot);
  } else {
    const directory = resolveFrameDir(serialId, cacheRoot);
    mkdirSync(directory, { recursive: true });
    const latestPath = path.join(directory, "latest.png");
    saved = {
      serial: serialId,
      framePath: options.framePath ?? latestPath,
      latestPath,
    };
    refreshLatest(saved);
  }

  const runningPid = getLiveViewerPid(serialId);
  if (runningPid !== undefined) {
    return {
      ...saved,
      viewer: "reused",
      pid: runningPid,
      message: `Visor en vivo ya activo para ${serialId}; frame actualizado.`,
    };
  }

  const execFn = options.execFn ?? defaultExecFn;
  const kittyBin = options.kittyBin ?? "kitty";
  const adbBin = options.adbBin ?? DC_MOBILE_DEFAULT_ADB;

  if (!canRunAdb(adbBin, execFn)) {
    return failLiveViewer(saved, "adb-no-disponible", `(${adbBin})`);
  }

  if (!canRunKitty(kittyBin, execFn)) {
    return failLiveViewer(
      saved,
      "kitty-no-disponible",
      `el frame quedó guardado en ${saved.latestPath}`,
    );
  }

  const scriptPath = options.scriptPath ?? DC_MOBILE_VIEWER_SCRIPT;
  if (!existsSync(scriptPath)) {
    return failLiveViewer(saved, "script-ausente", scriptPath);
  }

  const title = options.title ?? `dc-mobile ${serialId}`;
  const scriptArgs = buildViewerScriptArgs({
    serial: serialId,
    framePath: saved.latestPath,
    adbBin,
    intervalMs: options.intervalMs,
  });
  const args = buildKittyArgs(title, scriptPath, scriptArgs);

  try {
    const spawnFn = options.spawnFn ?? spawn;
    const child = spawnFn(kittyBin, args, {
      detached: true,
      stdio: "ignore",
    });

    child.on?.("error", (error: unknown) => {
      // Async spawn failures (ENOENT/EACCES) never reach the caller's return
      // value, so they are recorded through the handler instead of discarded.
      try {
        options.onFailure?.(
          "spawn-fallido",
          formatViewerFailure("spawn-fallido", errorMessage(error)),
        );
      } catch {
        // A broken handler must never surface as a throw.
      }
    });
    child.unref?.();

    if (typeof child.pid === "number") {
      liveViewers.set(serialId, child.pid);
    }

    return {
      ...saved,
      viewer: "started",
      pid: child.pid,
      message: `Visor en vivo iniciado para ${serialId}.`,
    };
  } catch (error) {
    return failLiveViewer(saved, "spawn-fallido", errorMessage(error));
  }
}
