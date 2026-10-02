import { getProjectObservations, type EngramObservation } from "../../dc-engram/dc-engram-db.ts";
import type { SentinelRecallItem, SentinelRecallResult } from "./dc-sentinel-types.ts";

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

  const loader = options.observationsLoader || (() => getProjectObservations(150, options.projectName, options.cwd));
  let observations: EngramObservation[] = [];
  try {
    observations = loader();
  } catch {
    return { prompt, keywords, items: [] };
  }

  const minScore = options.minScore ?? 3; // Al menos 1 match en título o 3 en contenido
  const maxItems = options.limit ?? 3;

  const scoredItems: SentinelRecallItem[] = [];

  for (const obs of observations) {
    const score = scoreObservation(obs, keywords);
    if (score >= minScore) {
      scoredItems.push({
        id: obs.id,
        type: obs.type,
        title: obs.title,
        content: obs.content,
        scope: obs.scope,
        score,
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
 */
export function formatRecallPromptSection(items: SentinelRecallItem[]): string {
  if (!items || items.length === 0) return "";

  const lines: string[] = [
    "<!-- dc:sentinel:recall:start -->",
    "## ⛩️ Memoria Histórica del Proyecto (DC Sentinel Pre-Flight Recall)",
    "> Lecciones, decisiones y arquitectura relevantes recuperadas de Engram para guiar esta respuesta y evitar alucinaciones:",
  ];

  for (const item of items) {
    // Truncar contenido para que no sea un dump gigante
    const cleanContent = (item.content || "")
      .replace(/\r?\n+/g, " ")
      .trim();
    const snippet = cleanContent.length > 250 ? `${cleanContent.slice(0, 247)}...` : cleanContent;
    lines.push(`- **[${item.type.toUpperCase()}] ${item.title}**: ${snippet}`);
  }

  lines.push("<!-- dc:sentinel:recall:end -->");
  return lines.join("\n");
}
