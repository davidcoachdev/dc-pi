import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  BrowserCdpStatus,
  BrowserNavigateOptions,
  BrowserNavigateResult,
  BrowserPageTarget,
  BrowserScreenshotOptions,
  BrowserScreenshotResult,
} from "./dc-browser-types.ts";

export const DEFAULT_CDP_URL = "http://127.0.0.1:9222";

/**
 * Normaliza la URL base de Chrome DevTools Protocol.
 */
export function normalizeCdpUrl(rawUrl?: string): string {
  const url = rawUrl?.trim() || process.env.CHROME_CDP_URL || DEFAULT_CDP_URL;
  return url.replace(/\/+$/, "");
}

/**
 * Consulta la disponibilidad de Chrome DevTools Protocol.
 */
export async function getCdpStatus(rawCdpUrl?: string): Promise<BrowserCdpStatus> {
  const cdpUrl = normalizeCdpUrl(rawCdpUrl);
  const warnings: string[] = [];
  let connected = false;
  let browser: string | undefined;
  let protocolVersion: string | undefined;
  let pageTargetCount = 0;

  try {
    const versionRes = await fetch(`${cdpUrl}/json/version`, {
      signal: AbortSignal.timeout(3000),
    });
    if (versionRes.ok) {
      connected = true;
      const vData = (await versionRes.json()) as any;
      browser = vData?.Browser;
      protocolVersion = vData?.["Protocol-Version"];
    }
  } catch {
    warnings.push(`No se pudo conectar a Chrome CDP en ${cdpUrl}. Verificá que Chrome esté corriendo con --remote-debugging-port=9222`);
  }

  if (connected) {
    try {
      const targets = await listPageTargets(cdpUrl);
      pageTargetCount = targets.length;
    } catch {
      warnings.push("No se pudo obtener la lista de pestañas de Chrome");
    }
  }

  return {
    cdpUrl,
    connected,
    browser,
    protocolVersion,
    pageTargetCount,
    warnings,
  };
}

/**
 * Lista las pestañas de navegación (targets tipo 'page') abiertas en Chrome.
 */
export async function listPageTargets(rawCdpUrl?: string): Promise<BrowserPageTarget[]> {
  const cdpUrl = normalizeCdpUrl(rawCdpUrl);
  const res = await fetch(`${cdpUrl}/json/list`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: Falló consulta a ${cdpUrl}/json/list`);
  }

  const raw = (await res.json()) as any[];
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item) => item?.type === "page")
    .map((item) => ({
      id: String(item.id),
      title: String(item.title ?? ""),
      url: String(item.url ?? ""),
      hasWebSocketDebuggerUrl: Boolean(item.webSocketDebuggerUrl),
      webSocketDebuggerUrl: item.webSocketDebuggerUrl ? String(item.webSocketDebuggerUrl) : undefined,
    }));
}

/**
 * Navega una pestaña existente hacia una URL HTTP/HTTPS y espera a que el documento termine de cargar.
 */
export async function navigatePage(options: BrowserNavigateOptions): Promise<BrowserNavigateResult> {
  const target = await resolveTarget(options);
  if (!target.webSocketDebuggerUrl) {
    throw new Error(`La pestaña ${target.id} no expone webSocketDebuggerUrl para control remoto`);
  }

  const startTime = Date.now();
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  try {
    await waitForWsOpen(ws, 5000);

    // 1. Habilitar eventos de página
    await sendCdpCommand(ws, "Page.enable");

    // 2. Preparar espera del evento Page.loadEventFired
    const loadPromise = waitForCdpEvent(ws, "Page.loadEventFired", options.timeoutMs ?? 30000);

    // 3. Ordenar navegación
    const navResult = (await sendCdpCommand(ws, "Page.navigate", { url: options.url })) as any;
    if (navResult?.errorText) {
      throw new Error(`Fallo de navegación CDP: ${navResult.errorText}`);
    }

    await loadPromise;

    return {
      targetId: target.id,
      title: target.title,
      url: options.url,
      durationMs: Date.now() - startTime,
    };
  } finally {
    safeCloseWebSocket(ws);
  }
}

/**
 * Captura una pantalla en formato PNG de la pestaña seleccionada.
 */
export async function capturePageScreenshot(options: BrowserScreenshotOptions): Promise<BrowserScreenshotResult> {
  const target = await resolveTarget(options);
  if (!target.webSocketDebuggerUrl) {
    throw new Error(`La pestaña ${target.id} no expone webSocketDebuggerUrl para captura`);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);

  try {
    await waitForWsOpen(ws, 5000);
    await sendCdpCommand(ws, "Page.enable");

    // Obtener métricas de layout
    const metrics = (await sendCdpCommand(ws, "Page.getLayoutMetrics")) as any;
    const contentWidth = Math.max(1, Math.ceil(metrics?.contentSize?.width ?? metrics?.cssContentSize?.width ?? 1280));
    const contentHeight = Math.max(1, Math.ceil(metrics?.contentSize?.height ?? metrics?.cssContentSize?.height ?? 800));

    const clip = options.fullPage !== false
      ? { x: 0, y: 0, width: contentWidth, height: contentHeight, scale: 1 }
      : undefined;

    const screenshotData = (await sendCdpCommand(ws, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: Boolean(clip),
      clip,
    })) as { data?: string };

    if (!screenshotData?.data) {
      throw new Error("CDP no devolvió datos de imagen en Page.captureScreenshot");
    }

    const imageBytes = Buffer.from(screenshotData.data, "base64");

    const cwd = options.cwd ?? process.cwd();
    const defaultOutDir = path.join(cwd, ".pi", "browser-screenshots");
    const filename = `screenshot-${Date.now()}.png`;
    const outputPath = options.outputPath
      ? (path.isAbsolute(options.outputPath) ? options.outputPath : path.resolve(cwd, options.outputPath))
      : path.join(defaultOutDir, filename);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, imageBytes);

    return {
      targetId: target.id,
      title: target.title,
      url: target.url,
      outputPath,
      outputSizeBytes: imageBytes.byteLength,
      width: clip?.width ?? 1280,
      height: clip?.height ?? 800,
    };
  } finally {
    safeCloseWebSocket(ws);
  }
}

// ── Helpers internos de WebSocket y CDP ──

async function resolveTarget(selectors: {
  cdpUrl?: string;
  targetId?: string;
  urlContains?: string;
  titleContains?: string;
}): Promise<BrowserPageTarget> {
  const targets = await listPageTargets(selectors.cdpUrl);
  if (targets.length === 0) {
    throw new Error("No hay pestañas abiertas en Chrome");
  }

  if (selectors.targetId) {
    const found = targets.find((t) => t.id === selectors.targetId);
    if (!found) throw new Error(`Pestaña con id "${selectors.targetId}" no encontrada`);
    return found;
  }

  const uMatch = selectors.urlContains?.toLowerCase();
  const tMatch = selectors.titleContains?.toLowerCase();

  const filtered = targets.filter((t) => {
    if (uMatch && !t.url.toLowerCase().includes(uMatch)) return false;
    if (tMatch && !t.title.toLowerCase().includes(tMatch)) return false;
    return true;
  });

  if (filtered.length === 0) {
    throw new Error("Ninguna pestaña coincidió con los filtros de búsqueda");
  }

  return filtered[0]!;
}

function waitForWsOpen(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout de conexión WebSocket a Chrome (${timeoutMs}ms)`));
    }, timeoutMs);

    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(new Error(`Fallo al conectar WebSocket CDP: ${String(err)}`));
    };
  });
}

function sendCdpCommand<T = unknown>(ws: WebSocket, method: string, params?: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.id === id) {
          ws.removeEventListener("message", handler as any);
          if (msg.error) {
            reject(new Error(`CDP Error [${method}]: ${msg.error.message}`));
          } else {
            resolve(msg.result as T);
          }
        }
      } catch {
        /* ignore parse errors */
      }
    };

    ws.addEventListener("message", handler as any);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function waitForCdpEvent(ws: WebSocket, eventName: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", handler as any);
      reject(new Error(`Timeout esperando evento CDP "${eventName}" (${timeoutMs}ms)`));
    }, timeoutMs);

    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.method === eventName) {
          clearTimeout(timer);
          ws.removeEventListener("message", handler as any);
          resolve();
        }
      } catch {
        /* ignore */
      }
    };

    ws.addEventListener("message", handler as any);
  });
}

function safeCloseWebSocket(ws: WebSocket): void {
  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  } catch {
    /* ignore */
  }
}
