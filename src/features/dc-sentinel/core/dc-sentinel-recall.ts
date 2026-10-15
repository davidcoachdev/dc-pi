import * as fs from "node:fs";
import * as path from "node:path";
import { getProjectObservations, type EngramObservation } from "../../dc-engram/dc-engram-db.ts";
import type { SentinelRecallItem, SentinelRecallResult } from "./dc-sentinel-types.ts";
import { SentinelDatabase } from "./dc-sentinel-db.ts";

/**
 * Presupuesto de caracteres para el bloque de Pre-Flight Recall en el prompt de sistema.
 * 800 caracteres equivalen aproximadamente a 180-200 tokens, protegiendo la ventana de atención.
 */
export const DEFAULT_MAX_RECALL_CHARS = 800;

/**
 * Extrae rutas o nombres de archivo candidatos referenciados en un texto de nota técnica.
 */
export function extractReferencedFiles(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const files = new Set<string>();

  // 1. Archivos con extensiones de código/configuración conocidas
  const extRegex = /\b([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9_-]+)\b/g;
  let match: RegExpExecArray | null;
  const KNOWN_EXTS = new Set([
    "ts", "js", "tsx", "jsx", "json", "md", "py", "go", "rs", "yml", "yaml", "sh", "html", "css", "sql", "toml", "env"
  ]);

  while ((match = extRegex.exec(text)) !== null) {
    const candidate = match[1]!;
    const parts = candidate.split(".");
    const ext = parts.pop()?.toLowerCase();
    if (ext && KNOWN_EXTS.has(ext)) {
      files.add(candidate.replace(/^[./]+/, ""));
    }
  }

  // 2. Rutas que inicien con carpetas convencionales
  const pathRegex = /\b((?:src|lib|test|tests|docs|config|features|native|core|scripts)\/[a-zA-Z0-9_\-./]+)\b/g;
  while ((match = pathRegex.exec(text)) !== null) {
    const candidate = match[1]!;
    files.add(candidate.replace(/^[./]+/, ""));
  }

  return Array.from(files);
}

/**
 * Grounding Gate: Verifica si los archivos referenciados en una nota existen en el disco del proyecto.
 * Previene inducir alucinaciones al agente con notas obsoletas de archivos ya eliminados o movidos.
 */
export function verifyItemFreshness(
  item: { title?: string; content?: string; filesAffected?: string[] },
  projectRoot?: string,
): { isStale: boolean; reason?: string } {
  const root = projectRoot || process.cwd();
  const text = `${item.title || ""} ${item.content || ""}`;
  const extracted = extractReferencedFiles(text);
  const declared = item.filesAffected || [];
  const allFiles = Array.from(new Set([...extracted, ...declared]));

  if (allFiles.length === 0) {
    return { isStale: false };
  }

  const missing: string[] = [];
  for (const file of allFiles) {
    const fullPath = path.isAbsolute(file) ? file : path.resolve(root, file);
    if (!fs.existsSync(fullPath)) {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    return {
      isStale: true,
      reason: `Archivos referenciados no encontrados en disco: ${missing.join(", ")}`,
    };
  }

  return { isStale: false };
}

const STOP_WORDS = new Set([
  // Español
  "a", "al", "algo", "algunas", "algunos", "ante", "antes", "como", "con", "contra",
  "cual", "cuando", "de", "del", "desde", "donde", "durante", "e", "el", "ella",
  "ellos", "en", "entre", "era", "esa", "ese", "eso", "esta", "estas", "este",
  "estos", "fue", "ha", "habia", "hacer", "hacia", "hasta", "hay", "la", "las",
  "le", "les", "lo", "los", "mas", "me", "mi", "mis", "mucho", "muchos", "muy",
  "nada", "ni", "no", "nos", "nosotros", "o", "otra", "otras", "otro", "otros",
  "para", "pero", "poco", "por", "porque", "que", "quien", "quienes", "se", "ser",
  "si", "sin", "sobre", "son", "su", "sus", "tambien", "tanto", "te", "tiene",
  "tienen", "toda", "todas", "todo", "todos", "un", "una", "unas", "uno", "unos",
  "va", "vamos", "y", "ya", "yo",
  // English
  "about", "after", "all", "also", "an", "and", "any", "are", "as", "at", "be",
  "because", "been", "before", "being", "between", "both", "but", "by", "can",
  "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for",
  "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers",
  "herself", "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it",
  "its", "itself", "just", "me", "more", "most", "my", "myself", "no", "nor",
  "not", "now", "of", "off", "on", "once", "only", "or", "other", "our", "ours",
  "ourselves", "out", "over", "own", "same", "she", "should", "so", "some", "such",
  "than", "that", "the", "their", "theirs", "them", "themselves", "then", "there",
  "these", "they", "this", "those", "through", "to", "too", "under", "until", "up",
  "very", "was", "we", "were", "what", "when", "where", "which", "while", "who",
  "whom", "why", "with", "would", "you", "your", "yours", "yourself", "yourselves",
]);

/**
 * Normaliza y extrae palabras clave significativas de un texto de prompt.
 */
export function extractKeywords(text: string, minLength: number = 3): string[] {
  if (!text || typeof text !== "string") return [];

  // Remover URLs y comandos slash
  const clean = text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/^\/[a-z0-9-_]+/gi, " ");

  const tokens = clean
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remover tildes para búsqueda flexible
    .replace(/[^a-z0-9_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= minLength && !STOP_WORDS.has(w));

  return Array.from(new Set(tokens));
}

/**
 * Calcula el puntaje de relevancia de una observación contra una lista de palabras clave.
 * Título tiene mayor peso (3x) que el contenido (1x).
 */
export function scoreObservation(obs: EngramObservation, keywords: string[]): number {
  if (!keywords || keywords.length === 0) return 0;

  const titleNorm = (obs.title || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const contentNorm = (obs.content || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  let score = 0;

  for (const kw of keywords) {
    if (titleNorm.includes(kw)) {
      score += 3;
    }
    if (contentNorm.includes(kw)) {
      score += 1;
    }
  }

  // Bonus si la observación es del tipo decisión o arquitectura o bugfix
  if (score > 0) {
    const t = (obs.type || "").toLowerCase();
    if (t === "decision" || t === "architecture" || t === "bugfix") {
      score += 1.5;
    }
  }

  return score;
}

export interface PerformRecallOptions {
  limit?: number;
  minScore?: number;
  projectName?: string;
  cwd?: string;
  observationsLoader?: () => EngramObservation[];
}

/**
 * Ejecuta el Pre-Flight Recall buscando en la memoria de Engram observaciones
 * relevantes al prompt actual del usuario.
 */
export function performPreFlightRecall(
  prompt: string,
  options: PerformRecallOptions = {},
): SentinelRecallResult {
  const keywords = extractKeywords(prompt);
  if (keywords.length === 0) {
    return { prompt, keywords: [], items: [] };
  }

  const maxItems = options.limit ?? 3;

  // 1. Motor Soberano Local: Buscar primero en SentinelDatabase (SQLite FTS5 trigrams)
  if (!options.observationsLoader) {
    try {
      const db = new SentinelDatabase(options.projectName, options.cwd);
      const dbResults = db.searchNotes(prompt, { limit: maxItems * 2 });
      db.close();

      if (dbResults.length > 0) {
        // Grounding Gate: evaluar frescura de los ítems de base de datos
        const evaluatedItems = dbResults.map((n) => {
          const freshness = verifyItemFreshness(n, options.cwd);
          return {
            item: {
              id: n.id ?? 0,
              type: n.type,
              title: n.title,
              content: n.content,
              scope: n.scope || "project",
              score: freshness.isStale ? 1 : 5,
              createdAt: n.createdAt,
            },
            isStale: freshness.isStale,
          };
        });

        // Priorizar notas frescas sobre las obsoletas
        evaluatedItems.sort((a, b) => {
          if (a.isStale !== b.isStale) return a.isStale ? 1 : -1;
          return b.item.score - a.item.score;
        });

        const topItems = evaluatedItems.slice(0, maxItems).map((e) => e.item);
        const formattedBlock = formatRecallPromptSection(topItems);
        return { prompt, keywords, items: topItems, formattedBlock };
      }
    } catch {
      /* fallback a loader */
    }
  }

  // 2. Fallback / Custom loader (compatibilidad)
  const loader = options.observationsLoader || (() => getProjectObservations(150, options.projectName, options.cwd));
  let observations: EngramObservation[] = [];
  try {
    observations = loader();
  } catch {
    return { prompt, keywords, items: [] };
  }

  const minScore = options.minScore ?? 3; // Al menos 1 match en título o 3 en contenido
  const scoredItems: SentinelRecallItem[] = [];

  for (const obs of observations) {
    const score = scoreObservation(obs, keywords);
    if (score >= minScore) {
      // Grounding Gate: evaluar frescura contra el filesystem
      const freshness = verifyItemFreshness(obs, options.cwd);
      const adjustedScore = freshness.isStale ? score - 10 : score;

      scoredItems.push({
        id: obs.id,
        type: obs.type,
        title: obs.title,
        content: obs.content,
        scope: obs.scope,
        score: adjustedScore,
        createdAt: obs.created_at,
      });
    }
  }

  scoredItems.sort((a, b) => b.score - a.score);
  const topItems = scoredItems.slice(0, maxItems);

  if (topItems.length === 0) {
    return { prompt, keywords, items: [] };
  }

  const formattedBlock = formatRecallPromptSection(topItems);
  return {
    prompt,
    keywords,
    items: topItems,
    formattedBlock,
  };
}

/**
 * Formatea las observaciones recuperadas en un bloque Markdown conciso
 * para inyectar en event.systemPromptOptions.appendSystemPrompt sin desperdiciar tokens.
 * Aplica un presupuesto estricto (maxChars) para garantizar que el recall nunca desborde la atención.
 */
export function formatRecallPromptSection(
  items: SentinelRecallItem[],
  maxChars: number = DEFAULT_MAX_RECALL_CHARS,
): string {
  if (!items || items.length === 0) return "";

  const header = [
    "<!-- dc:sentinel:recall:start -->",
    "## ⛩️ Memoria Histórica del Proyecto (DC Sentinel Pre-Flight Recall)",
    "> Lecciones, decisiones y arquitectura relevantes recuperadas de Engram para guiar esta respuesta y evitar alucinaciones:",
  ].join("\n");

  const footer = "\n<!-- dc:sentinel:recall:end -->";
  const overhead = header.length + footer.length + 1; // +1 por \n

  if (overhead >= maxChars) {
    return `<!-- dc:sentinel:recall:start -->\n## ⛩️ Memoria (Recall)${footer}`;
  }

  const availableForItems = maxChars - overhead;
  let currentItemsText = "";

  for (const item of items) {
    const cleanContent = (item.content || "")
      .replace(/\r?\n+/g, " ")
      .trim();

    const titlePrefix = `- **[${item.type.toUpperCase()}] ${item.title}**: `;
    const remaining = availableForItems - currentItemsText.length - (currentItemsText ? 1 : 0);

    if (remaining <= titlePrefix.length + 10) {
      break;
    }

    const maxSnippetLen = remaining - titlePrefix.length;
    const snippet = cleanContent.length > maxSnippetLen
      ? `${cleanContent.slice(0, Math.max(0, maxSnippetLen - 3))}...`
      : cleanContent;

    const line = `${titlePrefix}${snippet}`;
    currentItemsText = currentItemsText ? `${currentItemsText}\n${line}` : line;
  }

  if (!currentItemsText) return "";

  return `${header}\n${currentItemsText}${footer}`;
}
