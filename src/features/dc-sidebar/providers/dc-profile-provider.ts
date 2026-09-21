import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";
import { getSidebarContext } from "../dc-sidebar.ts";

export interface ProfileEntry {
  name: string;
  isActive: boolean;
  model?: string;
}

export interface ProfilesInfo {
  activeProfile: string;
  profiles: ProfileEntry[];
}

/**
 * Resuelve la ruta al archivo profiles.json (gentle-ai o agent).
 */
export function resolveProfilesFilePath(): string {
  const customHome = process.env.GENTLE_PI_CONFIG_HOME;
  if (customHome) {
    const customPath = path.join(customHome, "profiles.json");
    if (fs.existsSync(customPath)) return customPath;
  }

  const gentleAiPath = path.join(os.homedir(), ".pi", "gentle-ai", "profiles.json");
  if (fs.existsSync(gentleAiPath)) return gentleAiPath;

  const agentPath = path.join(os.homedir(), ".pi", "agent", "profiles.json");
  if (fs.existsSync(agentPath)) return agentPath;

  return gentleAiPath;
}

/**
 * Resuelve la ruta a settings.json de Pi.
 */
export function resolveSettingsFilePath(): string {
  return path.join(os.homedir(), ".pi", "agent", "settings.json");
}

/**
 * Lee la información de perfiles configurados y cuál es el activo.
 */
export function readProfilesInfo(customFilePath?: string): ProfilesInfo {
  const filePath = customFilePath || resolveProfilesFilePath();
  if (!fs.existsSync(filePath)) {
    return {
      activeProfile: "default",
      profiles: [{ name: "default", isActive: true }],
    };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    const active = typeof data.active === "string" ? data.active : "";
    const profilesObj = (data.profiles && typeof data.profiles === "object") ? data.profiles : {};

    const entries: ProfileEntry[] = [];
    const names = Object.keys(profilesObj);

    if (names.length === 0) {
      const activeName = active || "current";
      return {
        activeProfile: activeName,
        profiles: [{ name: activeName, isActive: true }],
      };
    }

    for (const name of names) {
      const p = profilesObj[name];
      const model = p?.orchestrator?.model || p?.model;
      entries.push({
        name,
        isActive: name === active,
        model: typeof model === "string" ? model : undefined,
      });
    }

    // Aseguramos que al menos uno esté marcado como activo
    const hasActive = entries.some((e) => e.isActive);
    if (!hasActive && entries.length > 0) {
      entries[0]!.isActive = true;
    }

    const resolvedActive = entries.find((e) => e.isActive)?.name || active || names[0] || "default";

    return {
      activeProfile: resolvedActive,
      profiles: entries,
    };
  } catch {
    return {
      activeProfile: "current",
      profiles: [{ name: "current", isActive: true }],
    };
  }
}

/**
 * Cambia el perfil activo en profiles.json y actualiza el modelo en settings.json
 * si el perfil especifica un modelo para el orquestador.
 */
export function switchActiveProfile(
  profileName: string,
  customProfilesPath?: string,
  customSettingsPath?: string
): boolean {
  const profilesPath = customProfilesPath || resolveProfilesFilePath();
  if (!fs.existsSync(profilesPath)) return false;

  try {
    const raw = fs.readFileSync(profilesPath, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return false;

    if (!data.profiles || typeof data.profiles !== "object" || !data.profiles[profileName]) {
      return false;
    }

    data.active = profileName;

    // 1. Guardar profiles.json atómicamente
    writeJsonAtomically(profilesPath, data);

    // 2. Si el perfil tiene un modelo asignado para orchestrator, actualizar settings.json
    const targetProfile = data.profiles[profileName];
    const targetModel = targetProfile?.orchestrator?.model;

    if (typeof targetModel === "string" && targetModel.includes("/")) {
      const [provider, ...modelParts] = targetModel.split("/");
      const modelId = modelParts.join("/");

      const settingsPath = customSettingsPath || resolveSettingsFilePath();
      if (fs.existsSync(settingsPath)) {
        try {
          const sRaw = fs.readFileSync(settingsPath, "utf8");
          const settings = JSON.parse(sRaw);
          if (settings && typeof settings === "object") {
            settings.defaultProvider = provider;
            settings.defaultModel = modelId;
            writeJsonAtomically(settingsPath, settings);
          }
        } catch {
          /* noop */
        }
      }
    }

    // 3. Notificar en UI si hay contexto activo
    try {
      const ctx = getSidebarContext();
      if (ctx) {
        dcNotifier.notify(ctx, "Perfiles", `Perfil activo cambiado a: ${profileName}`, "info");
      }
    } catch {
      /* noop */
    }

    return true;
  } catch {
    return false;
  }
}

function writeJsonAtomically(filePath: string, data: any): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}
