import { InteractiveMode } from "@earendil-works/pi-coding-agent";

export const G_DIAGNOSTICS = Symbol.for("dc.env.diagnostics");
const LOADED_RESOURCES_PATCHED = Symbol.for("dc.notify.pi-loaded-resources-patched");

/** Extrae texto representativo de cualquier componente del TUI (ThemedText, Text, etc.) */
export function extractChildText(child: unknown): string {
  if (!child || typeof child !== "object") return "";
  const comp = child as {
    build?: () => string;
    getText?: () => string;
    text?: string;
    render?: (w: number) => string[];
  };

  // 1. ThemedText o componentes dinámicos con build()
  if (typeof comp.build === "function") {
    try {
      const res = comp.build();
      if (typeof res === "string" && res.length > 0) return res;
    } catch {
      /* ignore */
    }
  }

  // 2. Componentes con método getText()
  if (typeof comp.getText === "function") {
    try {
      const res = comp.getText();
      if (typeof res === "string" && res.length > 0) return res;
    } catch {
      /* ignore */
    }
  }

  // 3. Propiedad text estática
  if (typeof comp.text === "string" && comp.text.length > 0) {
    return comp.text;
  }

  // 4. Fallback al render() de pi-tui
  if (typeof comp.render === "function") {
    try {
      const r = comp.render(120);
      if (Array.isArray(r) && r.length > 0) return r.join("\n");
    } catch {
      /* ignore */
    }
  }

  return "";
}

/** Determina si un componente es un Spacer de pi-tui */
export function isChildSpacer(child: unknown): boolean {
  return Boolean(
    child &&
    typeof child === "object" &&
    ((child as { constructor?: { name?: string } }).constructor?.name === "Spacer" ||
      typeof (child as { lines?: number }).lines === "number")
  );
}

/** Determina si un bloque de texto pertenece a una cabecera de diagnóstico de showLoadedResources */
export function isDiagnosticBlock(plain: string): boolean {
  const trimmed = plain.trimStart();
  return (
    trimmed.startsWith("[Extension issues]") ||
    trimmed.startsWith("[Skill conflicts]") ||
    trimmed.startsWith("[Prompt conflicts]") ||
    trimmed.startsWith("[Theme conflicts]")
  );
}

/** Determina si una advertencia o error del InteractiveMode debe capturarse en vez de enviarse al body */
export function isDiagnosticWarningOrError(msg: string): boolean {
  if (typeof msg !== "string") return false;
  const m = msg.toLowerCase();

  // No models available
  if (m.includes("no models available")) return true;

  // Advertencias y diagnósticos de extensiones y paquetes
  if (
    m.includes("extension package") ||
    m.startsWith("failed to load extension") ||
    m.includes("unknown built-in extension") ||
    m.includes("so built-in extension") ||
    m.includes("registers command") ||
    m.includes("registers tool") ||
    m.includes("registers flag")
  ) {
    return true;
  }

  // Conflictos de recursos
  if (
    m.includes("[extension issues]") ||
    m.includes("[skill conflicts]") ||
    m.includes("[prompt conflicts]") ||
    m.includes("[theme conflicts]") ||
    m.includes("skill conflict") ||
    m.includes("prompt conflict") ||
    m.includes("theme conflict")
  ) {
    return true;
  }

  return false;
}

/**
 * Almacena un diagnóstico en G_DIAGNOSTICS deduplicando inteligentemente:
 * Si llega un bloque estructurado ([Extension issues]...) y ya existía una advertencia plana
 * del mismo paquete, la reemplaza con el formato jerárquico.
 * Si ya existe el bloque estructurado y llega la advertencia plana redundante, la descarta.
 */
export function recordDiagnostic(rawText: string): void {
  const plain = rawText.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
  if (!plain) return;

  const diagnosticsList: string[] = ((globalThis as unknown as Record<symbol, string[]>)[G_DIAGNOSTICS] ??= []);

  // Si ya es exactamente idéntico, no duplicar
  if (diagnosticsList.includes(plain)) return;

  const isStructured = plain.startsWith("[");
  const normalizedNew = plain.replace(/\s+/g, " ");

  const getCoreMessage = (str: string): string => {
    return str
      .replace(/^warning:\s*/i, "")
      .replace(/^error:\s*/i, "")
      .replace(/^extension package\s+"[^"]+":\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
  };

  const coreNew = getCoreMessage(plain);

  if (isStructured) {
    let replaced = false;
    for (let i = 0; i < diagnosticsList.length; i++) {
      const existing = diagnosticsList[i]!;
      if (!existing.startsWith("[")) {
        const coreExisting = getCoreMessage(existing);
        if (coreExisting.length > 15 && normalizedNew.includes(coreExisting)) {
          diagnosticsList[i] = plain;
          replaced = true;
          break;
        }
      }
    }
    if (!replaced) {
      diagnosticsList.push(plain);
    }
  } else {
    const alreadyCovered = diagnosticsList.some((existing) => {
      if (existing.startsWith("[")) {
        const normalizedExisting = existing.replace(/\s+/g, " ");
        if (coreNew.length > 15 && normalizedExisting.includes(coreNew)) {
          return true;
        }
      }
      return false;
    });

    if (!alreadyCovered) {
      diagnosticsList.push(plain);
    }
  }
}

/**
 * Intercepta los avisos diagnósticos del core ([Extension issues], [Skill conflicts], etc.)
 * en `showLoadedResources`, `showWarning`, `showError` y `showExtensionError` para que NO ensucien
 * la pantalla principal (el body) de la terminal.
 * Se almacenan en el registro global `dc.env.diagnostics` para ser consultados en la
 * pestaña [2] Alertas de la ventana de Información (`dc-status`, /dc-status, Alt+E).
 */
export function patchPiLoadedResources(): void {
  const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (!proto || (proto as Record<symbol, boolean>)[LOADED_RESOURCES_PATCHED]) return;

  const orig = proto.showLoadedResources as ((this: unknown, options?: unknown) => unknown) | undefined;
  if (typeof orig === "function") {
    proto.showLoadedResources = function (this: unknown, options?: unknown): unknown {
      let res: unknown;
      try {
        res = orig.call(this, options);
      } catch (err) {
        // En tests o entornos simulados donde no hay un InteractiveMode completo, capturamos el error
        // para permitir la limpieza defensiva de loadedResourcesContainer
        if (!process.env.NODE_ENV?.includes("test") && !process.argv.some((a) => a.includes("test"))) {
          throw err;
        }
      }
      try {
        const host = this as { loadedResourcesContainer?: { children?: unknown[] } };
        const container = host.loadedResourcesContainer;
        if (container && Array.isArray(container.children)) {
          const filtered: unknown[] = [];
          let skipNextSpacer = false;

          for (let i = 0; i < container.children.length; i++) {
            const child = container.children[i];
            const rawText = extractChildText(child);
            const plain = rawText.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

            if (isDiagnosticBlock(plain)) {
              const lines = plain
                .split("\n")
                .map((l) => l.trimEnd())
                .filter((l) => l.trim().length > 0);
              if (lines.length > 0) {
                recordDiagnostic(lines.join("\n"));
              }
              skipNextSpacer = true;
              continue;
            }

            if (skipNextSpacer && isChildSpacer(child)) {
              skipNextSpacer = false;
              continue;
            }
            skipNextSpacer = false;
            filtered.push(child);
          }

          // Eliminar Spacers redundantes al inicio y final
          while (filtered.length > 0 && isChildSpacer(filtered[0])) {
            filtered.shift();
          }
          while (filtered.length > 0 && isChildSpacer(filtered[filtered.length - 1])) {
            filtered.pop();
          }

          container.children = filtered;
        }
      } catch {
        /* noop */
      }
      return res;
    };
  }

  // 1. Interceptar showWarning de InteractiveMode
  const origShowWarning = proto.showWarning as ((this: unknown, msg: string) => unknown) | undefined;
  if (typeof origShowWarning === "function") {
    proto.showWarning = function (this: unknown, msg: string): unknown {
      if (typeof msg === "string" && isDiagnosticWarningOrError(msg)) {
        recordDiagnostic(msg);
        return undefined;
      }
      return origShowWarning.call(this, msg);
    };
  }

  // 2. Interceptar showError de InteractiveMode
  const origShowError = proto.showError as ((this: unknown, msg: string) => unknown) | undefined;
  if (typeof origShowError === "function") {
    proto.showError = function (this: unknown, msg: string): unknown {
      if (typeof msg === "string" && isDiagnosticWarningOrError(msg)) {
        recordDiagnostic(msg);
        return undefined;
      }
      return origShowError.call(this, msg);
    };
  }

  // 3. Interceptar showExtensionError de InteractiveMode
  const origShowExtError = proto.showExtensionError as
    | ((this: unknown, extPath: string, error: unknown, stack?: string) => unknown)
    | undefined;
  if (typeof origShowExtError === "function") {
    proto.showExtensionError = function (
      this: unknown,
      extPath: string,
      error: unknown,
      stack?: string,
    ): unknown {
      const errorMsg = `Extension "${extPath}" error: ${String(error)}`;
      const full = stack ? `${errorMsg}\n${stack}` : errorMsg;
      recordDiagnostic(full);
      return undefined;
    };
  }

  (proto as Record<symbol, boolean>)[LOADED_RESOURCES_PATCHED] = true;
}

