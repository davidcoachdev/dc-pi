import { InteractiveMode } from "@earendil-works/pi-coding-agent";

export const G_DIAGNOSTICS = Symbol.for("dc.env.diagnostics");
const LOADED_RESOURCES_PATCHED = Symbol.for("dc.notify.pi-loaded-resources-patched");

/**
 * Intercepta los avisos diagnósticos del core ([Extension issues], [Extensions], [Skill conflicts], etc.)
 * en `showLoadedResources` para que NO ensucien la pantalla principal de la terminal.
 * Se almacenan en el registro global `dc.env.diagnostics` para ser consultados en la
 * ventana modal de Estado del Entorno (`dc-status`, /estado, Alt+E).
 */
export function patchPiLoadedResources(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (!proto || (proto as Record<symbol, boolean>)[LOADED_RESOURCES_PATCHED]) return;
  const orig = proto.showLoadedResources as ((this: unknown, options?: unknown) => unknown) | undefined;
  if (typeof orig !== "function") return;

  // Parcheamos también showWarning del InteractiveMode para silenciar "No models available" en demos/smoke
  const origShowWarning = proto.showWarning as ((this: unknown, msg: string) => unknown) | undefined;
  if (typeof origShowWarning === "function") {
    proto.showWarning = function (this: unknown, msg: string): unknown {
      if (typeof msg === "string" && msg.includes("No models available")) {
        const diagnosticsList: string[] = ((globalThis as unknown as Record<symbol, string[]>)[G_DIAGNOSTICS] ??= []);
        if (!diagnosticsList.includes(msg)) diagnosticsList.push(msg);
        return undefined;
      }
      return origShowWarning.call(this, msg);
    };
  }

  proto.showLoadedResources = function (this: unknown, options?: unknown): unknown {
    const res = orig.call(this, options);
    try {
      const host = this as { loadedResourcesContainer?: { children?: unknown[] } };
      const container = host.loadedResourcesContainer;
      if (container && Array.isArray(container.children)) {
        const diagnosticsList: string[] = ((globalThis as unknown as Record<symbol, string[]>)[G_DIAGNOSTICS] ??= []);
        diagnosticsList.length = 0; // Limpiar diagnósticos previos para reflejar sólo el estado actual
        const filtered: unknown[] = [];
        for (const child of container.children) {
          let textContent = "";
          const c = child as { text?: string; render?: (w: number) => string[] };
          if (typeof c.text === "string") {
            textContent = c.text;
          } else if (typeof c.render === "function") {
            try {
              const r = c.render(120);
              if (Array.isArray(r)) textContent = r.join("\n");
            } catch {
              /* noop */
            }
          }

          const plain = textContent.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
          const trimmed = plain.trimStart();
          if (
            trimmed.startsWith("[Extension issues]") ||
            trimmed.startsWith("[Extensions]") ||
            trimmed.startsWith("[Skill conflicts]") ||
            trimmed.startsWith("[Prompt conflicts]") ||
            trimmed.startsWith("[Theme conflicts]")
          ) {
            const lines = plain
              .split("\n")
              .map((l) => l.trimEnd())
              .filter((l) => l.trim().length > 0);
            if (lines.length > 0) {
              const fullText = lines.join("\n");
              if (!diagnosticsList.includes(fullText)) {
                diagnosticsList.push(fullText);
              }
            }
          } else {
            filtered.push(child);
          }
        }
        container.children = filtered;
      }
    } catch {
      /* noop */
    }
    return res;
  };
  (proto as Record<symbol, boolean>)[LOADED_RESOURCES_PATCHED] = true;
}
