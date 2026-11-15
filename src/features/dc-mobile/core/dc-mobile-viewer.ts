import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Event-driven live viewer for dc-mobile (S5).
 *
 * Frames are written to `~/.cache/dc-mobile/<serial>/latest.png`. A single
 * detached Kitty window per serial runs `scripts/dc-mobile-viewer.mjs`, which
 * watches the frame directory with `fs.watch` and redraws only on change.
 * No polling and no timers are used.
 */

export const DC_MOBILE_CACHE_ROOT = path.join(os.homedir(), ".cache", "dc-mobile");

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

export interface DcLiveViewerResult extends DcSavedFrame {
  viewer: DcLiveViewerState;
  message: string;
  pid?: number;
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
  title?: string;
  spawnFn?: typeof spawn;
  execFn?: DcViewerExecFn;
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

function refreshLatest(saved: DcSavedFrame): void {
  if (saved.framePath !== saved.latestPath && existsSync(saved.framePath)) {
    try {
      copyFileSync(saved.framePath, saved.latestPath);
    } catch {
      // Non-fatal: the timestamped frame is already on disk.
    }
  }
}

function buildKittyArgs(title: string, scriptPath: string, framePath: string): string[] {
  const options = DC_MOBILE_KITTY_OPTIONS.flatMap((option) => ["-o", option]);
  return [
    "--title",
    title,
    ...options,
    process.execPath,
    scriptPath,
    framePath,
  ];
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
      message: "serial vacío: no se puede abrir el visor en vivo.",
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

  if (!canRunKitty(kittyBin, execFn)) {
    return {
      ...saved,
      viewer: "unavailable",
      message: `kitty no está disponible. El frame quedó guardado en ${saved.latestPath}.`,
    };
  }

  const scriptPath = options.scriptPath ?? DC_MOBILE_VIEWER_SCRIPT;
  if (!existsSync(scriptPath)) {
    return {
      ...saved,
      viewer: "unavailable",
      message: `no se encontró el script del visor en ${scriptPath}.`,
    };
  }

  const title = options.title ?? `dc-mobile ${serialId}`;
  const args = buildKittyArgs(title, scriptPath, saved.latestPath);

  try {
    const spawnFn = options.spawnFn ?? spawn;
    const child = spawnFn(kittyBin, args, {
      detached: true,
      stdio: "ignore",
    });

    child.on?.("error", () => {
      // Asynchronous spawn failures (ENOENT/EACCES) are non-fatal.
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
    return {
      ...saved,
      viewer: "unavailable",
      message: `No se pudo abrir el visor Kitty: ${errorMessage(error)}`,
    };
  }
}
