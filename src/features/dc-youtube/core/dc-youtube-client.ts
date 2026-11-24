import { execFile, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { promisify } from "node:util";
import type {
  YoutubeChannelInfo,
  YoutubeSearchOptions,
  YoutubeSearchResultItem,
  YoutubeTranscriptOptions,
  YoutubeTranscriptResult,
  YoutubeVideoDetails,
} from "./dc-youtube-types.ts";
import { redactSecrets } from "../../dc-websearch/core/dc-websearch-security.ts";

const execFileAsync = promisify(execFile);

const ALLOWED_YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const SCHEME_PREFIX_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const UNSAFE_URL_CHARS_RE = /[\s\x00-\x1f\x7f]/;
const VALID_SUB_LANG_RE = /^[a-zA-Z0-9_.,*-]{1,64}$/;

/**
 * Valida estrictamente que una URL apunte a un host oficial de YouTube sobre `https:`,
 * bloqueando SSRF hacia metadata cloud, loopback, IPs privadas, credenciales embebidas
 * y esquemas peligrosos (`file://`, `ftp://`, `http://`, etc.).
 */
export function validateYoutubeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed || UNSAFE_URL_CHARS_RE.test(trimmed)) {
    throw new Error("URL de YouTube vacía o contiene caracteres inválidos");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error(
      `URL de YouTube inválida: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `Esquema bloqueado en dc-youtube (SSRF): solo se permite https:, recibido "${parsed.protocol}"`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error("Credenciales embebidas en URL de YouTube bloqueadas por seguridad");
  }

  if (parsed.port !== "") {
    throw new Error(`Puerto personalizado bloqueado en URL de YouTube: ${parsed.port}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
    throw new Error(
      `Host bloqueado en dc-youtube (SSRF): solo se permiten dominios oficiales de YouTube, recibido "${parsed.hostname}"`,
    );
  }

  return parsed.toString();
}

/**
 * Valida una URL oficial de YouTube o un ID de video de 11 caracteres y devuelve
 * la URL canónica validada sobre `https:`.
 */
export function validateYoutubeUrlOrId(urlOrId: string): string {
  const trimmed = urlOrId.trim();
  if (!trimmed || UNSAFE_URL_CHARS_RE.test(trimmed)) {
    throw new Error("URL o ID de YouTube vacío o con caracteres inválidos");
  }

  if (trimmed.includes("://") || SCHEME_PREFIX_RE.test(trimmed)) {
    return validateYoutubeUrl(trimmed);
  }

  if (YOUTUBE_VIDEO_ID_RE.test(trimmed) && !trimmed.startsWith("--")) {
    return validateYoutubeUrl(
      `https://www.youtube.com/watch?v=${encodeURIComponent(trimmed)}`,
    );
  }

  throw new Error(
    `URL o ID de YouTube inválido o bloqueado por seguridad: "${trimmed}"`,
  );
}

function validateSubtitleLanguage(rawLang: string): string {
  const clean = rawLang.trim();
  if (!clean || clean.startsWith("-") || !VALID_SUB_LANG_RE.test(clean)) {
    throw new Error(`Código de idioma de subtítulos inválido: "${rawLang}"`);
  }
  return clean;
}

export function buildYtDlpSearchArgs(query: string, limit = 5): string[] {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    throw new Error("La consulta de búsqueda de YouTube no puede estar vacía");
  }
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(1, Math.floor(limit)), 10)
    : 5;
  return [
    "--dump-json",
    "--flat-playlist",
    "--no-warnings",
    "--",
    `ytsearch${safeLimit}:${cleanQuery}`,
  ];
}

export function buildYtDlpVideoDetailsArgs(urlOrId: string): string[] {
  const target = validateYoutubeUrlOrId(urlOrId);
  return ["--dump-json", "--skip-download", "--no-warnings", "--", target];
}

export function buildYtDlpTranscriptArgs(
  urlOrId: string,
  lang: string,
  outputTemplate: string,
): string[] {
  const target = validateYoutubeUrlOrId(urlOrId);
  const safeLang = validateSubtitleLanguage(lang);
  return [
    "--write-subs",
    "--write-auto-subs",
    "--sub-lang",
    safeLang,
    "--sub-format",
    "vtt/srt",
    "--skip-download",
    "--no-warnings",
    "-o",
    outputTemplate,
    "--",
    target,
  ];
}

let cachedYtDlpAvailable: boolean | null = null;

/**
 * Comprueba si el binario `yt-dlp` está disponible en el sistema.
 * El resultado se memoiza en memoria para evitar llamadas síncronas bloqueantes repetidas.
 */
export function isYtDlpAvailable(forceRefresh = false): boolean {
  if (cachedYtDlpAvailable !== null && !forceRefresh) {
    return cachedYtDlpAvailable;
  }
  try {
    const { status } = spawnSync("yt-dlp", ["--version"], { stdio: "ignore" });
    cachedYtDlpAvailable = status === 0;
  } catch {
    cachedYtDlpAvailable = false;
  }
  return cachedYtDlpAvailable;
}

/**
 * Invalida la caché de disponibilidad de `yt-dlp` (útil para tests o reconfiguración).
 */
export function resetYtDlpAvailabilityCache(): void {
  cachedYtDlpAvailable = null;
}

export function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const sPad = String(s).padStart(2, "0");
  if (h > 0) {
    const mPad = String(m).padStart(2, "0");
    return `${h}:${mPad}:${sPad}`;
  }
  return `${m}:${sPad}`;
}

export async function searchYoutube(options: YoutubeSearchOptions): Promise<YoutubeSearchResultItem[]> {
  const args = buildYtDlpSearchArgs(options.query, options.limit ?? 5);
  const timeout = options.timeoutMs ?? 20000;

  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      args,
      { timeout, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" },
    );

    const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
    const results: YoutubeSearchResultItem[] = [];

    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        const id = item.id || "";
        const url = item.url || `https://www.youtube.com/watch?v=${id}`;
        const durationSec = typeof item.duration === "number" ? item.duration : undefined;

        results.push({
          id,
          title: item.title ?? "Sin título",
          url,
          channelTitle: item.uploader || item.channel || undefined,
          channelUrl: item.uploader_url || item.channel_url || undefined,
          durationSeconds: durationSec,
          durationFormatted: formatDuration(durationSec),
          viewCount: typeof item.view_count === "number" ? item.view_count : undefined,
          descriptionSnippet: redactSecrets((item.description ?? "").slice(0, 250)),
        });
      } catch {
        /* skip invalid json line */
      }
    }

    return results;
  } catch (err: any) {
    throw new Error(`Fallo al buscar en YouTube con yt-dlp: ${err.message}`);
  }
}

export async function getVideoDetails(urlOrId: string, timeoutMs = 25000): Promise<YoutubeVideoDetails> {
  const target = validateYoutubeUrlOrId(urlOrId);
  const args = buildYtDlpVideoDetailsArgs(target);

  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      args,
      { timeout: timeoutMs, maxBuffer: 15 * 1024 * 1024, encoding: "utf8" },
    );

    const data = JSON.parse(stdout);
    const durationSec = typeof data.duration === "number" ? data.duration : undefined;

    const chapters = Array.isArray(data.chapters)
      ? data.chapters.map((c: any) => ({
          title: c.title ?? "",
          startTime: c.start_time ?? 0,
          endTime: c.end_time,
        }))
      : undefined;

    const availableSubtitles = data.subtitles ? Object.keys(data.subtitles) : [];
    const availableAutoSubtitles = data.automatic_captions ? Object.keys(data.automatic_captions) : [];

    return {
      id: data.id ?? "",
      title: data.title ?? "Sin título",
      url: data.webpage_url ?? target,
      channelTitle: data.uploader ?? data.channel ?? "Desconocido",
      channelUrl: data.uploader_url ?? data.channel_url,
      description: redactSecrets(data.description ?? ""),
      durationSeconds: durationSec,
      durationFormatted: formatDuration(durationSec),
      viewCount: data.view_count,
      likeCount: data.like_count,
      uploadDate: data.upload_date,
      tags: Array.isArray(data.tags) ? data.tags : undefined,
      chapters,
      availableSubtitles,
      availableAutoSubtitles,
    };
  } catch (err: any) {
    throw new Error(`Fallo al obtener detalles del video: ${err.message}`);
  }
}

export async function getTranscript(options: YoutubeTranscriptOptions): Promise<YoutubeTranscriptResult> {
  const target = validateYoutubeUrlOrId(options.urlOrId);
  const lang = validateSubtitleLanguage(options.language ?? "es,en");
  const timeout = options.timeoutMs ?? 35000;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-yt-transcript-"));

  try {
    const outputTemplate = path.join(tmpDir, "%(id)s.%(ext)s");
    const args = buildYtDlpTranscriptArgs(target, lang, outputTemplate);

    await execFileAsync(
      "yt-dlp",
      args,
      { timeout, encoding: "utf8" },
    );

    const files = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".vtt") || f.endsWith(".srt"));
    if (files.length === 0) {
      throw new Error(`No se encontraron subtítulos ni transcripción disponible para el idioma (${lang}) en este video`);
    }

    // Priorizar subtítulo manual antes de auto si hay varios
    let chosenFile = files.find((f) => !f.includes(".auto.")) ?? files[0]!;
    const filePath = path.join(tmpDir, chosenFile);
    const rawContent = fs.readFileSync(filePath, "utf8");

    const isAuto = chosenFile.includes(".auto.") || !files.some((f) => !f.includes(".auto."));
    const langDetected = chosenFile.split(".").slice(-2, -1)[0] ?? "unknown";

    const clean = options.clean !== false;
    const transcriptText = clean ? cleanVttText(rawContent) : rawContent;

    return {
      videoId: options.urlOrId,
      language: langDetected,
      isAutoGenerated: isAuto,
      transcriptText: redactSecrets(transcriptText.trim()),
      byteSize: Buffer.byteLength(transcriptText, "utf8"),
    };
  } catch (err: any) {
    throw new Error(`Fallo al extraer transcripción de YouTube: ${err.message}`);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export async function searchChannels(query: string, limit = 5): Promise<YoutubeChannelInfo[]> {
  try {
    const results = await searchYoutube({ query, limit, type: "channel" });
    return results.map((r) => ({
      id: r.id,
      title: r.channelTitle ?? r.title,
      url: r.channelUrl ?? r.url,
      description: r.descriptionSnippet,
    }));
  } catch {
    return [];
  }
}

/**
 * Limpia el formato WebVTT/SRT: remueve cabeceras WEBVTT, números de cue,
 * timestamps (00:00:00.000 --> 00:00:05.000), tags <c> y deduplica líneas repetidas.
 */
export function cleanVttText(vtt: string): string {
  const lines = vtt.split("\n");
  const cleanedLines: string[] = [];
  let prevLine = "";

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    if (line.startsWith("WEBVTT") || line.startsWith("Kind:") || line.startsWith("Language:")) continue;
    if (/^\d+$/.test(line)) continue; // número de cue
    if (line.includes("-->")) continue; // timestamp

    // Eliminar etiquetas de formato como <c> </c> o <00:00:00.000>
    const stripped = line.replace(/<[^>]+>/g, "").trim();
    if (!stripped) continue;

    // Deduplicar repeticiones consecutivas comunes en subtítulos generados
    if (stripped !== prevLine) {
      cleanedLines.push(stripped);
      prevLine = stripped;
    }
  }

  // Agrupar en párrafos de lectura natural
  return cleanedLines.join(" ");
}
