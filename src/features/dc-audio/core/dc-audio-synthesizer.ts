import { execFile, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { promisify } from "node:util";
import type { AudioSynthesisOptions, AudioSynthesisResult } from "./dc-audio-types.ts";

const execFileAsync = promisify(execFile);

export interface AudioTtsCheckResult {
  available: boolean;
  engine?: "piper" | "espeak-ng";
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
export async function synthesizeAudio(options: AudioSynthesisOptions): Promise<AudioSynthesisResult> {
  const ttsCheck = isAudioTtsAvailable();
  if (!ttsCheck.available) {
    throw new Error(
      "No se encontró ningún motor TTS disponible en el sistema. Instalalo con: brew install espeak-ng",
    );
  }

  const engine = (options.engine === "piper" && ttsCheck.engine === "piper") ? "piper" : "espeak-ng";
  const language = options.language ?? "es";
  const speed = options.speed ?? 160;

  const cwd = options.cwd ?? process.cwd();
  const defaultDir = path.join(cwd, ".pi", "audio");
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }

  const filename = `speech-${Date.now()}.wav`;
  const outputPath = options.outputPath
    ? (path.isAbsolute(options.outputPath) ? options.outputPath : path.resolve(cwd, options.outputPath))
    : path.join(defaultDir, filename);

  const cleanText = options.text.trim();
  if (!cleanText) {
    throw new Error("El texto a sintetizar no puede estar vacío");
  }

  if (engine === "espeak-ng") {
    // Sintetizar con espeak-ng
    // -v <lang> -s <speed> -w <output.wav> "texto"
    const args = [
      "-v",
      language,
      "-s",
      String(speed),
      "-w",
      outputPath,
      cleanText,
    ];

    try {
      await execFileAsync("espeak-ng", args, { timeout: 30000 });
    } catch {
      // Fallback a comando 'espeak'
      await execFileAsync("espeak", args, { timeout: 30000 });
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
