import { execFile, spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { promisify } from "node:util";
import { assertPathWithinRoots } from "../../../core/dc-path-confinement.ts";
import type { AudioSynthesisOptions, AudioSynthesisResult } from "./dc-audio-types.ts";

const execFileAsync = promisify(execFile);

const VALID_LANGUAGE_RE = /^[a-zA-Z][a-zA-Z0-9_+-]{0,31}$/;
const MAX_STDERR_BYTES = 4096;

export interface AudioTtsCheckResult {
  available: boolean;
  engine?: "piper" | "espeak-ng";
}

export interface AudioSynthesizerDeps {
  checkAvailable?: () => AudioTtsCheckResult;
  execFileFn?: (
    file: string,
    args: readonly string[],
    options: { timeout: number },
  ) => Promise<unknown>;
  spawnFn?: typeof spawn;
  piperModelPath?: string;
  piperCommand?: string;
  timeoutMs?: number;
}

function expandTildePath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

/**
 * Resuelve y confina una ruta de archivo de audio (lectura o escritura)
 * estrictamente dentro de `cwd` o `os.tmpdir()`.
 */
export function resolveConfinedAudioPath(
  rawPath: string,
  cwd: string,
  label = "ruta de audio (cwd o tmpdir)",
): string {
  const expanded = expandTildePath(rawPath);
  if (!expanded) {
    throw new Error(`Ruta inválida o vacía para ${label}`);
  }
  const resolvedCwd = path.resolve(cwd);
  const resolvedTmp = path.resolve(os.tmpdir());
  const candidate = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(resolvedCwd, expanded);

  return assertPathWithinRoots(candidate, [resolvedCwd, resolvedTmp], label);
}

function validateLanguage(language: string): string {
  const clean = language.trim();
  if (!VALID_LANGUAGE_RE.test(clean)) {
    throw new Error(`Código de idioma inválido para TTS: "${language}"`);
  }
  return clean;
}

function validateSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0 || speed > 600) {
    throw new Error(`Velocidad de habla inválida para TTS: ${speed}`);
  }
  return Math.round(speed);
}

/**
 * Construye los argumentos seguros de `espeak-ng` colocando `--` antes del texto
 * para impedir que textos iniciados con `-` sean interpretados como flags CLI.
 */
export function buildEspeakArgs(options: {
  language: string;
  speed: number;
  outputPath: string;
  text: string;
}): string[] {
  const language = validateLanguage(options.language);
  const speed = validateSpeed(options.speed);
  return [
    "-v",
    language,
    "-s",
    String(speed),
    "-w",
    options.outputPath,
    "--",
    options.text,
  ];
}

/**
 * Construye los argumentos seguros para `piper` (el texto se entrega vía stdin).
 */
export function buildPiperArgs(options: {
  modelPath: string;
  outputPath: string;
  speed: number;
}): string[] {
  const modelPath = options.modelPath.trim();
  if (!modelPath || modelPath.startsWith("-")) {
    throw new Error(`Ruta de modelo piper inválida: "${options.modelPath}"`);
  }
  const speed = validateSpeed(options.speed);
  const lengthScale = Math.min(2.0, Math.max(0.5, 160 / speed));
  return [
    "--model",
    modelPath,
    "--output_file",
    options.outputPath,
    "--length_scale",
    lengthScale.toFixed(2),
  ];
}

async function runPiperSynthesis(
  args: readonly string[],
  text: string,
  opts: {
    spawnFn?: typeof spawn;
    command?: string;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  const spawnImpl = opts.spawnFn ?? spawn;
  const command = opts.command ?? "piper";
  const timeoutMs = opts.timeoutMs ?? 30000;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let stderr = "";

    const child = spawnImpl(command, [...args], {
      stdio: ["pipe", "ignore", "pipe"],
    });

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      finish(new Error(`Timeout ejecutando motor TTS piper (${timeoutMs}ms)`));
    }, timeoutMs);
    timer.unref?.();

    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (stderr.length < MAX_STDERR_BYTES) {
        stderr += String(chunk).slice(0, MAX_STDERR_BYTES - stderr.length);
      }
    });

    child.on("error", (err) => {
      finish(new Error(`Error al iniciar motor TTS piper: ${err.message}`));
    });

    child.stdin?.on("error", () => {
      // Evitar EPIPE no capturado si el proceso termina antes de leer stdin;
      // el fallo real se reporta en 'close' o 'error'.
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        finish();
        return;
      }
      const detail = stderr.trim();
      const reason = signal ? `señal ${signal}` : `código ${code ?? "desconocido"}`;
      finish(
        new Error(
          `Motor TTS piper falló (${reason})${detail ? `: ${detail}` : ""}`,
        ),
      );
    });

    if (!child.stdin) {
      finish(new Error("No se pudo abrir stdin para el proceso piper"));
      return;
    }

    child.stdin.write(`${text}\n`, "utf8");
    child.stdin.end();
  });
}

let cachedAudioTtsResult: AudioTtsCheckResult | null = null;

/**
 * Comprueba si hay un motor TTS disponible (piper, espeak-ng, espeak).
 * El resultado se memoiza en memoria para evitar ejecutar múltiples procesos síncronos por llamada.
 */
export function isAudioTtsAvailable(forceRefresh = false): AudioTtsCheckResult {
  if (cachedAudioTtsResult !== null && !forceRefresh) {
    return cachedAudioTtsResult;
  }

  try {
    const piper = spawnSync("piper", ["--help"], { stdio: "ignore" });
    if (piper.status === 0) {
      cachedAudioTtsResult = { available: true, engine: "piper" };
      return cachedAudioTtsResult;
    }
  } catch {
    /* check next */
  }

  try {
    const espeak = spawnSync("espeak-ng", ["--version"], { stdio: "ignore" });
    if (espeak.status === 0) {
      cachedAudioTtsResult = { available: true, engine: "espeak-ng" };
      return cachedAudioTtsResult;
    }
  } catch {
    /* check next */
  }

  try {
    const espeakOld = spawnSync("espeak", ["--version"], { stdio: "ignore" });
    if (espeakOld.status === 0) {
      cachedAudioTtsResult = { available: true, engine: "espeak-ng" };
      return cachedAudioTtsResult;
    }
  } catch {
    /* none */
  }

  cachedAudioTtsResult = { available: false };
  return cachedAudioTtsResult;
}

/**
 * Invalida la caché de disponibilidad de TTS (útil para pruebas unitarias).
 */
export function resetAudioTtsAvailabilityCache(): void {
  cachedAudioTtsResult = null;
}

/**
 * Sintetiza un texto a un archivo de audio WAV.
 */
export async function synthesizeAudio(
  options: AudioSynthesisOptions,
  deps?: AudioSynthesizerDeps,
): Promise<AudioSynthesisResult> {
  const cleanText = options.text.trim();
  if (!cleanText) {
    throw new Error("El texto a sintetizar no puede estar vacío");
  }

  const language = validateLanguage(options.language ?? "es");
  const speed = validateSpeed(options.speed ?? 160);

  const cwd = path.resolve(options.cwd ?? process.cwd());
  const defaultDir = path.join(cwd, ".pi", "audio");
  const filename = `speech-${Date.now()}.wav`;
  const rawOutputPath = options.outputPath ?? path.join(defaultDir, filename);
  const outputPath = resolveConfinedAudioPath(
    rawOutputPath,
    cwd,
    "ruta de salida de audio (cwd o tmpdir)",
  );

  const ttsCheck = (deps?.checkAvailable ?? isAudioTtsAvailable)();
  if (!ttsCheck.available) {
    throw new Error(
      "No se encontró ningún motor TTS disponible en el sistema. Instalalo con: brew install espeak-ng",
    );
  }

  const rawPiperModel =
    deps?.piperModelPath ?? process.env.PIPER_MODEL_PATH ?? process.env.DC_PIPER_MODEL;

  let engine: "piper" | "espeak-ng";
  if (options.engine === "piper") {
    if (ttsCheck.engine !== "piper") {
      throw new Error("El motor TTS 'piper' fue solicitado pero no está disponible en el sistema");
    }
    engine = "piper";
  } else if (options.engine === "espeak-ng") {
    engine = "espeak-ng";
  } else if (ttsCheck.engine === "piper" && rawPiperModel?.trim()) {
    engine = "piper";
  } else {
    engine = "espeak-ng";
  }

  const timeoutMs = deps?.timeoutMs ?? 30000;

  if (engine === "piper") {
    if (!rawPiperModel?.trim()) {
      throw new Error(
        "El motor TTS 'piper' requiere configurar PIPER_MODEL_PATH (o DC_PIPER_MODEL) con un modelo .onnx válido",
      );
    }
    const resolvedModelPath = path.resolve(expandTildePath(rawPiperModel));
    if (!fs.existsSync(resolvedModelPath)) {
      throw new Error(`Modelo piper no encontrado: ${resolvedModelPath}`);
    }

    const piperArgs = buildPiperArgs({
      modelPath: resolvedModelPath,
      outputPath,
      speed,
    });

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await runPiperSynthesis(piperArgs, cleanText, {
      spawnFn: deps?.spawnFn,
      command: deps?.piperCommand,
      timeoutMs,
    });
  } else {
    // Sintetizar con espeak-ng usando `--` antes del texto para evitar inyección de flags
    const args = buildEspeakArgs({
      language,
      speed,
      outputPath,
      text: cleanText,
    });

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const execFn =
      deps?.execFileFn ??
      ((file: string, execArgs: readonly string[], execOpts: { timeout: number }) =>
        execFileAsync(file, [...execArgs], execOpts));

    try {
      await execFn("espeak-ng", args, { timeout: timeoutMs });
    } catch {
      // Fallback a comando 'espeak'
      await execFn("espeak", args, { timeout: timeoutMs });
    }
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error("El motor TTS no generó el archivo de audio esperado");
  }

  const stat = fs.statSync(outputPath);
  // Estimación de duración en segundos: ~150 palabras por minuto
  const wordCount = cleanText.split(/\s+/).length;
  const estimatedSeconds = Math.max(1, Math.round((wordCount / (speed / 60))));

  return {
    outputPath,
    engineUsed: engine,
    language,
    byteSize: stat.size,
    durationEstimateSeconds: estimatedSeconds,
    textCharCount: cleanText.length,
  };
}
