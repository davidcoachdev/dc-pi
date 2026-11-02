import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliProxyClient, type CliProxyModelItem } from "../../../integrations/dc-cliproxy/dc-cliproxy-client.ts";
import { resolveRecommendedContextWindow, resolveSafeMaxTokens } from "./dc-model-calibration.ts";

export interface ModelItem {
  id: string;
  name?: string;
  provider: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

const MODELS_JSON_PATH = path.join(os.homedir(), ".pi", "agent", "models.json");

/**
 * Formatea un ID de modelo a un nombre legible, ej:
 * "ac01/claude-sonnet-4-6" -> "AC01 · Claude Sonnet 4 6"
 */
export function formatModelDisplayName(modelId: string): string {
  const parts = modelId.split("/");
  if (parts.length > 1) {
    const prefix = parts[0].toUpperCase();
    const rest = parts.slice(1).join("/");
    const cleanRest = rest
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    return `${prefix} · ${cleanRest}`;
  }
  return modelId
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Convierte un item de /v1/models de CLIProxy a la estructura de ModelItem de Pi.
 */
export function convertCliProxyToModelItem(raw: CliProxyModelItem, provider = "cpam"): ModelItem {
  const id = raw.id;
  const isReasoning =
    id.toLowerCase().includes("thinking") ||
    id.toLowerCase().includes("reasoning") ||
    id.toLowerCase().includes("opus") ||
    id.toLowerCase().includes("o1") ||
    id.toLowerCase().includes("o3");

  const contextWindow = resolveRecommendedContextWindow(id, typeof raw.context_window === "number" ? raw.context_window : undefined);
  const maxTokens = resolveSafeMaxTokens(typeof raw.max_tokens === "number" ? raw.max_tokens : undefined);

  return {
    id,
    name: formatModelDisplayName(id),
    provider,
    reasoning: isReasoning,
    input: ["text", "image"],
    contextWindow,
    maxTokens,
    modalities: {
      input: ["text", "image", "pdf"],
    },
    thinkingLevelMap: {
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      max: "max",
      off: null,
      xhigh: null,
    },
    options: {
      thinkingLevelMap: {
        minimal: null,
        low: "low",
        medium: "medium",
        high: "high",
        max: "max",
        off: null,
        xhigh: null,
      },
    },
  };
}

/**
 * Sincroniza dinámicamente los modelos en vivo de CLIProxy con la lista en memoria.
 * Opcionalmente persiste en ~/.pi/agent/models.json para que todo Pi conozca el catálogo completo.
 */
export async function syncLiveCliProxyModels(
  existingModels: ModelItem[],
  options: { persistToDisk?: boolean; apiKey?: string; client?: typeof cliProxyClient } = {},
): Promise<{ merged: ModelItem[]; addedCount: number }> {
  try {
    const client = options.client ?? cliProxyClient;
    const rawList = await client.getModels(options.apiKey);
    if (!rawList || rawList.length === 0) {
      return { merged: existingModels, addedCount: 0 };
    }

    const existingIds = new Set(existingModels.map((m) => m.id));
    const newItems: ModelItem[] = [];

    for (const raw of rawList) {
      if (!raw.id || existingIds.has(raw.id)) continue;
      const converted = convertCliProxyToModelItem(raw, "cpam");
      newItems.push(converted);
      existingIds.add(raw.id);
    }

    if (newItems.length === 0) {
      return { merged: existingModels, addedCount: 0 };
    }

    const merged = [...existingModels, ...newItems];

    if (options.persistToDisk) {
      try {
        if (fs.existsSync(MODELS_JSON_PATH)) {
          const content = fs.readFileSync(MODELS_JSON_PATH, "utf8");
          const parsed = JSON.parse(content);
          if (parsed?.providers?.cpam) {
            const currentList = Array.isArray(parsed.providers.cpam.models) ? parsed.providers.cpam.models : [];
            const diskIds = new Set(currentList.map((m: any) => m.id));
            let diskAdded = 0;

            for (const item of newItems) {
              if (!diskIds.has(item.id)) {
                currentList.push(item);
                diskIds.add(item.id);
                diskAdded++;
              }
            }

            if (diskAdded > 0) {
              parsed.providers.cpam.models = currentList;
              fs.writeFileSync(MODELS_JSON_PATH, JSON.stringify(parsed, null, 2) + "\n", "utf8");
            }
          }
        }
      } catch {
        // Safe fallback: no romper si falla la escritura a disco
      }
    }

    return { merged, addedCount: newItems.length };
  } catch {
    return { merged: existingModels, addedCount: 0 };
  }
}
