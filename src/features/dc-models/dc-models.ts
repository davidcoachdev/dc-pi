import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../ui/dc-modal.ts";
import { cliProxyClient } from "../../integrations/dc-cliproxy/dc-cliproxy-client.ts";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { DcModelsPanel, type ModelAccountTab, type ModelItem, type EffortLevel } from "./dc-models-panel.ts";

export const SETTINGS_FILE = path.join(os.homedir(), ".pi/agent/settings.json");

/**
 * Guarda el modelo y nivel de thinking seleccionados en settings.json para que
 * persista como default de forma permanente entre sesiones y reloads.
 */
export function persistDefaultModel(
  m: ModelItem,
  thinkingLevel?: string,
  onError?: (msg: string) => void,
  settingsFilePath: string = SETTINGS_FILE,
): void {
  try {
    if (!fs.existsSync(settingsFilePath)) return;
    const raw = fs.readFileSync(settingsFilePath, "utf8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    settings.defaultProvider = m.provider ? String(m.provider) : "cpam";
    settings.defaultModel = m.id;
    if (thinkingLevel !== undefined) {
      const map = ((settings.modelThinkingLevels as Record<string, string>) ?? {}) as Record<string, string>;
      const key = m.provider ? `${String(m.provider)}/${m.id}` : m.id;
      map[key] = thinkingLevel;
      settings.modelThinkingLevels = map;
    }
    fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2) + "\n", "utf8");
  } catch (err) {
    onError?.(`No se pudo guardar como default: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface OpenModelsOptions {
  currentModelId?: string;
  currentThinkingLevel?: string;
}

/**
 * Open the DC Studio 3-panel Model & Reasoning Selector modal.
 */
export async function openModelsSelector(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  options: OpenModelsOptions = {},
): Promise<void> {
  // 1. Fetch available models from Pi model registry / runtime (respetando scopedModels si existen)
  let models: ModelItem[] = [];
  try {
    await (ctx as any).modelRegistry?.refresh?.({ allowNetwork: false });
  } catch {
    /* ignore refresh error */
  }
  try {
    const scoped = (ctx as any).scopedModels as unknown as Array<{ model?: ModelItem } | ModelItem> | undefined;
    if (scoped && scoped.length) {
      models = scoped.map((s) => (s as { model?: ModelItem }).model ?? (s as ModelItem));
    } else {
      const available = await (ctx as any).modelRegistry?.getAvailable?.();
      if (Array.isArray(available)) {
        models = available;
      }
    }
  } catch {
    /* fallback to empty */
  }

  // Fallback: algunos providers builtin (como opencode-go) pueden no aparecer en
  // getAvailable() aunque tengan credenciales y modelos en models-store.json.
  // Completamos la lista leyendo el store directamente.
  const MODELS_STORE_FILE = path.join(os.homedir(), ".pi/agent/models-store.json");
  const AUTH_FILE = path.join(os.homedir(), ".pi/agent/auth.json");
  try {
    const providersInModels = new Set(models.map((m) => String(m.provider ?? "")));
    const rawStore = fs.readFileSync(MODELS_STORE_FILE, "utf8");
    const store = JSON.parse(rawStore) as Record<string, { models?: ModelItem[] }>;
    const rawAuth = fs.readFileSync(AUTH_FILE, "utf8");
    const auth = JSON.parse(rawAuth) as Record<string, unknown>;

    for (const [providerId, entry] of Object.entries(store)) {
      if (providersInModels.has(providerId)) continue;
      if (!auth[providerId]) continue;
      const storeModels = entry?.models ?? [];
      for (const m of storeModels) {
        if (!m.provider) (m as any).provider = providerId;
        models.push(m as ModelItem);
      }
    }
  } catch {
    /* si falla el fallback, seguimos con lo que tenemos */
  }

  // 2. Discover accounts / prefixes via CLIProxy
  const prefixEmails = await cliProxyClient.fetchPrefixEmails();
  const tabs: ModelAccountTab[] = [];

  // Group prefixes found in model IDs
  const discoveredPrefixes = new Set<string>();
  for (const m of models) {
    const parts = m.id.split("/");
    if (parts.length > 1 && parts[0]) {
      discoveredPrefixes.add(parts[0].toLowerCase());
    }
  }

  for (const prefix of Array.from(discoveredPrefixes).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const email = prefixEmails.get(prefix);
    tabs.push({
      id: prefix,
      title: prefix.toUpperCase(),
      email,
    });
  }

  // 3. Discover providers without prefixes (e.g. opencode-go, openai, etc.)
  const providerHasPrefixes = new Set<string>();
  for (const m of models) {
    if (m.provider && m.id.includes("/")) {
      providerHasPrefixes.add(m.provider);
    }
  }
  const discoveredProviders = new Set<string>();
  for (const m of models) {
    if (m.provider && !providerHasPrefixes.has(m.provider)) {
      discoveredProviders.add(m.provider);
    }
  }
  for (const provider of Array.from(discoveredProviders).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    tabs.push({
      id: provider,
      title: provider.toUpperCase(),
    });
  }

  // Leer modelThinkingLevels de settings.json para pasarlos al panel
  let configuredThinkingLevels: Record<string, string> = {};
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed.modelThinkingLevels && typeof parsed.modelThinkingLevels === "object") {
        configuredThinkingLevels = parsed.modelThinkingLevels;
      }
    }
  } catch {
    /* ignore */
  }

  let panelRef: DcModelsPanel | undefined;

  await openDcModal<void>(ctx, {
    title: () => panelRef?.isShowingInfo() ? "Dc Studio - Info del Modelo" : "Dc Studio - Modelos",
    glyph: "⛩ ",
    frame: "double",
    paddingX: 0,
    width: "62%",
    maxHeight: "85%",
    scrollable: false,
    footer: (theme) => ({
      left: `  ${theme.fg("accent", "Tab/←→")} panel   ${theme.fg("accent", "↑↓/PgUp/Dn/Clic")} elegir   ${theme.fg("accent", "Espacio")} info   ${theme.fg("accent", "Enter")} aplicar   ${theme.fg("accent", "esc")} cerrar`,
      right: `${theme.fg("accent", "[ Enter aplicar ]")}  `,
    }),
    content: (done, theme, tui) => {
      const panel = new DcModelsPanel({
        theme,
        models,
        tabs,
        currentModelId: options.currentModelId ?? ctx.model?.id,
        currentThinkingLevel: options.currentThinkingLevel,
        modelThinkingLevels: configuredThinkingLevels,
        maxRows: () => Math.max(10, Math.min(26, Math.floor((tui.terminal.rows || 40) * 0.85) - 8)),
        onApply: async (selectedModel: ModelItem, effort?: string) => {
          done();
          try {
            const ok = await (pi as any).setModel(selectedModel);
            if (ok) {
              if (effort && effort !== "off") {
                try {
                  pi.setThinkingLevel(effort as any);
                } catch {
                  /* ignore */
                }
              }

              // Guardar de forma persistente en settings.json
              persistDefaultModel(selectedModel, effort, (msg) => {
                dcNotifier.notify(ctx, "Error default", msg, "error");
              });

              let effectiveLvl: string | undefined;
              try {
                effectiveLvl = pi.getThinkingLevel();
              } catch {
                /* ignore */
              }
              const effText = effectiveLvl && effectiveLvl !== "off" ? ` [🧠 ${effectiveLvl}]` : "";
              const providerStr = selectedModel.provider ? `${selectedModel.provider}/` : "";
              dcNotifier.notify(
                ctx,
                "Modelo default",
                `${providerStr}${selectedModel.id}${effText}`,
                "info",
              );
            } else {
              dcNotifier.notify(ctx, "Error de modelo", `No se pudo activar ${selectedModel.id}`, "error");
            }
          } catch (e: any) {
            dcNotifier.notify(ctx, "Error", String(e?.message ?? e), "error");
          }
        },
        onCancel: () => done(),
        requestRender: () => tui.requestRender(),
      });
      panelRef = panel;
      return panel;
    },
  });
}

export default function dcModelsExtension(pi: ExtensionAPI): void {
  async function showModels(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      dcNotifier.notify(ctx, "DC Modelos", "dc-modelos necesita TUI (no hay UI en este modo).", "error");
      return;
    }
    await openModelsSelector(ctx, pi);
  }

  pi.registerCommand("dc-models", {
    description: "Three-panel models & reasoning selector (CLIProxy accounts, models and reasoning effort)",
    handler: async (_args, ctx) => {
      await showModels(ctx);
    },
  });

  try {
    pi.registerShortcut("alt+m" as never, {
      description: "Selector de modelos DC Studio",
      handler: async (ctx) => {
        await showModels(ctx);
      },
    });
  } catch {
    // Graceful fallback
  }
}
