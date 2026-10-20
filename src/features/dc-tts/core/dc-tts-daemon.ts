import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getDcStudioDir } from "../../../core/dc-paths.ts";
import { callTtsBridge, checkTtsHealth } from "./dc-tts-client.ts";
import { readTtsPrefs } from "./dc-tts-prefs.ts";
import { DEFAULT_TTS_HTTP_URL, DEFAULT_TTS_TCP_ADDR } from "./dc-tts-types.ts";

export interface TtsDaemonPaths {
  nativeSourceDir: string;
  binDir: string;
  cliBinPath: string;
  daemonBinPath: string;
  logFilePath: string;
  pidFilePath: string;
}

export function resolveTtsDaemonPaths(customSourceDir?: string, customBinDir?: string): TtsDaemonPaths {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  // Desde src/features/dc-tts/core/ (o .test-build/src/features/dc-tts/core/) subir hasta la raíz de dc-pi
  const candidate1 = path.resolve(currentDir, "../../../../native/dc-tts");
  const candidate2 = path.resolve(currentDir, "../../../../../native/dc-tts");
  const nativeSourceDir =
    customSourceDir ?? (fs.existsSync(path.join(candidate1, "go.mod")) ? candidate1 : candidate2);

  const binDir = customBinDir ?? path.join(getDcStudioDir(), "bin");
  return {
    nativeSourceDir,
    binDir,
    cliBinPath: path.join(binDir, "dc-tts"),
    daemonBinPath: path.join(binDir, "dc-tts-win"),
    logFilePath: path.join(binDir, "dc-tts-win.log"),
    pidFilePath: path.join(binDir, "dc-tts-win.pid"),
  };
}

function execGoBuild(sourceDir: string, outPath: string, pkg: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = execFile(
      "go",
      ["build", "-ldflags=-s -w", "-o", outPath, pkg],
      {
        cwd: sourceDir,
        env: { ...process.env, CGO_ENABLED: "0" },
        timeout: 25000,
      },
      (err) => {
        resolve(!err);
      },
    );
    child.unref?.();
  });
}

let buildInFlight: Promise<boolean> | null = null;

/**
 * Asegura que los binarios estáticos Go (`dc-tts` y `dc-tts-win`) existan en `~/.pi/agent/dc-studio/bin/`.
 * Si no existen (o `forceRebuild === true`), los compila desde `dc-pi/native/dc-tts/`.
 */
export async function ensureTtsBinaries(
  forceRebuild = false,
  paths = resolveTtsDaemonPaths(),
): Promise<boolean> {
  if (!forceRebuild && fs.existsSync(paths.daemonBinPath) && fs.existsSync(paths.cliBinPath)) {
    return true;
  }
  if (buildInFlight) return buildInFlight;

  buildInFlight = (async () => {
    try {
      if (!fs.existsSync(path.join(paths.nativeSourceDir, "go.mod"))) {
        return fs.existsSync(paths.daemonBinPath);
      }
      fs.mkdirSync(paths.binDir, { recursive: true });
      const [okCli, okDaemon] = await Promise.all([
        execGoBuild(paths.nativeSourceDir, paths.cliBinPath, "./cmd/dc-tts"),
        execGoBuild(paths.nativeSourceDir, paths.daemonBinPath, "./cmd/dc-tts-win"),
      ]);
      try {
        if (okCli && !fs.existsSync("/tmp/dc-tts")) {
          fs.symlinkSync(paths.cliBinPath, "/tmp/dc-tts");
        }
      } catch {
        /* best effort symlink */
      }
      return okCli && okDaemon;
    } finally {
      buildInFlight = null;
    }
  })();

  return buildInFlight;
}

/**
 * Sincroniza las preferencias guardadas en `dc-tts.json` hacia el daemon activo.
 */
export async function syncPrefsToDaemon(baseUrl = DEFAULT_TTS_HTTP_URL): Promise<void> {
  const prefs = readTtsPrefs();
  if (prefs.voice) {
    await callTtsBridge("/voice", "POST", { voice: prefs.voice }, 2000, baseUrl);
  }
  if (typeof prefs.rate === "number" && prefs.rate !== 1.0) {
    await callTtsBridge("/rate", "POST", { rate: prefs.rate }, 2000, baseUrl);
  }
  if (typeof prefs.volume === "number" && prefs.volume !== 100) {
    await callTtsBridge("/volume", "POST", { volume: prefs.volume }, 2000, baseUrl);
  }
  if (typeof prefs.autoRead === "boolean") {
    await callTtsBridge("/autoread", "POST", { enabled: prefs.autoRead }, 2000, baseUrl);
  }
}

let startInFlight: Promise<boolean> | null = null;

/**
 * Garantiza que el daemon `dc-tts-win` esté corriendo y respondiendo en `127.0.0.1:9877`.
 * Si ya responde, retorna `true` inmediatamente.
 * Si está apagado, asegura los binarios Go y levanta el proceso en segundo plano (`.unref()`).
 */
export async function ensureTtsDaemonRunning(options?: {
  baseUrl?: string;
  tcpAddr?: string;
  paths?: TtsDaemonPaths;
}): Promise<boolean> {
  const baseUrl = options?.baseUrl ?? DEFAULT_TTS_HTTP_URL;
  if (await checkTtsHealth(baseUrl, 500)) {
    return true;
  }
  if (startInFlight) return startInFlight;

  startInFlight = (async () => {
    try {
      const paths = options?.paths ?? resolveTtsDaemonPaths();
      const built = await ensureTtsBinaries(false, paths);
      if (!built || !fs.existsSync(paths.daemonBinPath)) {
        return false;
      }

      const tcpAddr = options?.tcpAddr ?? DEFAULT_TTS_TCP_ADDR;
      const httpUrlObj = new URL(baseUrl);
      const httpAddr = `${httpUrlObj.hostname}:${httpUrlObj.port || "9877"}`;

      fs.mkdirSync(paths.binDir, { recursive: true });
      const outFd = fs.openSync(paths.logFilePath, "a");

      const child = spawn(paths.daemonBinPath, ["-addr", tcpAddr, "-http", httpAddr], {
        detached: true,
        stdio: ["ignore", outFd, outFd],
      });
      child.on("error", () => {});
      child.unref();
      try {
        fs.closeSync(outFd);
      } catch {
        /* ignore */
      }

      if (child.pid) {
        try {
          fs.writeFileSync(paths.pidFilePath, String(child.pid), "utf8");
        } catch {
          /* ignore */
        }
      }

      for (let i = 0; i < 20; i++) {
        await new Promise((r) => {
          const t = setTimeout(r, 150);
          (t as any).unref?.();
        });
        if (await checkTtsHealth(baseUrl, 400)) {
          await syncPrefsToDaemon(baseUrl);
          return true;
        }
      }
      return false;
    } catch {
      return false;
    } finally {
      startInFlight = null;
    }
  })();

  return startInFlight;
}
