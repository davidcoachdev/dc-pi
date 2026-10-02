/**
 * dc-effort-policy.ts — Calibración adaptativa de reasoning effort y resolución de modelos.
 *
 * Determina el nivel de thinking según la complejidad cognitiva de la tarea o preset,
 * y aplica las políticas de proveedor (ej: forzar Gemini en subagentes aunque el padre use GPT).
 * Cumple con la Directiva 1 (cero dependencias de Pi) y Directiva 2 (aislado en dc-studio/).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  DcAgentsConfigFile,
  DcEphemeralToolPreset,
  DcReasoningEffort,
} from "./dc-ephemeral-types.ts";
import { DEFAULT_DC_AGENTS_CONFIG } from "./dc-ephemeral-types.ts";

const CONFIG_FILE_PATH = path.join(os.homedir(), ".pi", "agent", "dc-studio", "dc-agents.json");

function ensureDirectory(targetPath: string): void {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Carga la configuración del subsistema de agentes desde dc-studio/dc-agents.json.
 */
export function loadDcAgentsConfig(configPath: string = CONFIG_FILE_PATH): DcAgentsConfigFile {
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_DC_AGENTS_CONFIG };
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_DC_AGENTS_CONFIG };

    return {
      routing: {
        ...DEFAULT_DC_AGENTS_CONFIG.routing,
        ...(parsed.routing || {}),
      },
      ephemeral: {
        ...DEFAULT_DC_AGENTS_CONFIG.ephemeral,
        ...(parsed.ephemeral || {}),
      },
      accountPool: {
        ...DEFAULT_DC_AGENTS_CONFIG.accountPool,
        ...(parsed.accountPool || {}),
      },
    };
  } catch {
    return { ...DEFAULT_DC_AGENTS_CONFIG };
  }
}

/**
 * Guarda la configuración persistente en dc-studio/dc-agents.json.
 */
export function saveDcAgentsConfig(
  config: DcAgentsConfigFile,
  configPath: string = CONFIG_FILE_PATH,
): void {
  try {
    ensureDirectory(configPath);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  } catch {
    /* defensive */
  }
}

/**
 * Comprueba si un modelo pertenece a la familia Gemini.
 */
export function isGeminiModel(modelName: string): boolean {
  if (!modelName) return false;
  const lower = modelName.toLowerCase();
  return lower.includes("gemini");
}

/**
 * Calibra el esfuerzo cognitivo (thinking) según el preset de herramientas o la naturaleza de la tarea.
 * Para modelos con razonamiento profundo (-high), asegura esfuerzo 'high' para evitar salidas vacías.
 */
export function calibrateEffortForTask(
  task: string,
  preset?: DcEphemeralToolPreset,
  explicitEffort?: DcReasoningEffort,
  parentEffort?: string,
  modelName?: string,
): DcReasoningEffort {
  // 1. Prioridad: override explícito en la llamada
  if (explicitEffort) {
    return explicitEffort;
  }

  // 2. Calibración según Preset de herramientas
  if (preset) {
    switch (preset) {
      case "youtube":
      case "audio":
      case "services":
        return "low";

      case "browser":
      case "api":
        return "medium";

      case "docs":
      case "research":
      case "scout":
      case "codegraph":
        return "high";
    }
  }

  // 3. Heurística contextual por palabras clave en el prompt
  const lower = (task || "").toLowerCase();

  const heavyKeywords = [
    "architect", "refactor", "concurrency", "deadlock", "race condition",
    "codegraph", "blast radius", "audit", "security", "vulnerability",
    "complex", "redesign", "investigate bug", "performance bottleneck",
    "explora", "explore", "inspect", "inspecciona", "analiza",
  ];
  if (heavyKeywords.some((kw) => lower.includes(kw))) {
    return "high";
  }

  const mechanicalKeywords = [
    "transcribe", "transcript", "download", "audio", "speak", "tts",
    "screenshot", "restart service", "service logs", "format", "clean",
    "convert", "ping", "status check",
  ];
  if (mechanicalKeywords.some((kw) => lower.includes(kw))) {
    return "low";
  }

  // 4. Fallback al effort actual del orquestador padre
  if (parentEffort) {
    const normalized = parentEffort.toLowerCase();
    if (normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "off") {
      return normalized as DcReasoningEffort;
    }
  }

  // 5. Default canónico para subagentes: "high" (evita paradas prematuras y fallos en tools)
  return "high";
}

export interface ResolvedExecutionModel {
  provider: string;
  baseModelName: string;
  requestedAccount?: string;
  fullModelId: string;
}

/**
 * Resuelve el modelo exacto a ejecutar respetando la política de proveedor y cuentas.
 */
export function resolveExecutionModel(
  options: {
    requestedModel?: string;
    parentModel?: string;
    config?: DcAgentsConfigFile;
  },
): ResolvedExecutionModel {
  const config = options.config || loadDcAgentsConfig();
  const { routing } = config;

  // 1. Si hay un modelo explícito solicitado en la llamada
  if (options.requestedModel && options.requestedModel.trim().length > 0) {
    const trimmed = options.requestedModel.trim();
    const parts = trimmed.split("/");

    let parsedProvider = routing.defaultSubagentProvider;
    let parsedAccount: string | undefined;
    let parsedBaseModel = trimmed;

    if (parts.length >= 3) {
      // Formato provider/account/model (ej: cpam/ac01/gemini-3.8-flash-high)
      parsedProvider = parts[0];
      parsedAccount = parts[1];
      parsedBaseModel = parts.slice(2).join("/");
    } else if (parts.length === 2) {
      // Formato provider/model o account/model
      if (parts[0].startsWith("ac") || parts[0].startsWith("cc")) {
        parsedAccount = parts[0];
        parsedBaseModel = parts[1];
      } else {
        parsedProvider = parts[0];
        parsedBaseModel = parts[1];
      }
    }

    // Regla estricta: los subagentes deben usar exclusivamente modelos de la familia Gemini
    // para preservar cuotas de Claude y OpenAI.
    if (!isGeminiModel(parsedBaseModel)) {
      parsedBaseModel = routing.defaultSubagentModel;
      parsedProvider = routing.defaultSubagentProvider;
    }

    return {
      provider: parsedProvider,
      requestedAccount: parsedAccount,
      baseModelName: parsedBaseModel,
      fullModelId: parsedAccount
        ? `${parsedProvider}/${parsedAccount}/${parsedBaseModel}`
        : `${parsedProvider}/${parsedBaseModel}`,
    };
  }

  // 2. Política de proveedor forzado (ej: force_gemini)
  if (routing.enforceProviderPolicy === "force_gemini") {
    return {
      provider: routing.defaultSubagentProvider,
      baseModelName: routing.defaultSubagentModel,
      fullModelId: `${routing.defaultSubagentProvider}/${routing.defaultSubagentModel}`,
    };
  }

  // 3. Política inherit_or_fallback (hereda del padre si es posible)
  if (routing.enforceProviderPolicy === "inherit_or_fallback" && options.parentModel) {
    const parentParts = options.parentModel.split("/");
    if (parentParts.length >= 2) {
      const baseName = parentParts[parentParts.length - 1];
      const prov = parentParts[0] || routing.defaultSubagentProvider;
      return {
        provider: prov,
        baseModelName: baseName,
        fullModelId: options.parentModel,
      };
    }
  }

  // 4. Default canónico
  return {
    provider: routing.defaultSubagentProvider,
    baseModelName: routing.defaultSubagentModel,
    fullModelId: `${routing.defaultSubagentProvider}/${routing.defaultSubagentModel}`,
  };
}
