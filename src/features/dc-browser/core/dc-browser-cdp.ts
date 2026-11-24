import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { assertPathWithinRoots } from "../../../core/dc-path-confinement.ts";
import { validatePublicUrlResolved } from "../../dc-websearch/core/dc-websearch-security.ts";
import type {
  BrowserCdpStatus,
  BrowserNavigateOptions,
  BrowserNavigateResult,
  BrowserPageTarget,
  BrowserScreenshotOptions,
  BrowserScreenshotResult,
} from "./dc-browser-types.ts";

export const DEFAULT_CDP_URL = "http://127.0.0.1:9222";

const LOOPBACK_CDP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const HTTP_CDP_PROTOCOLS = new Set(["http:", "https:"]);
const WS_CDP_PROTOCOLS = new Set(["ws:", "wss:"]);

/**
 * Comprueba si el hostname corresponde estrictamente a un host loopback
 * permitido para Chrome DevTools Protocol (`localhost`, `127.0.0.1`, `::1`).
 */
export function isLoopbackCdpHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return LOOPBACK_CDP_HOSTS.has(normalized);
}

/**
 * Valida una URL de Chrome DevTools Protocol (HTTP/HTTPS o WS/WSS) restringiéndola
 * estrictamente a loopback para prevenir SSRF hacia hosts remotos, red interna o metadata cloud.
 */
export function validateCdpUrl(
  rawUrl: string,
  kind: "http" | "ws" | "any" = "any",
): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("URL CDP vacía o inválida");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error(
      `URL CDP inválida: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const allowedProtocols =
    kind === "http"
      ? HTTP_CDP_PROTOCOLS
      : kind === "ws"
        ? WS_CDP_PROTOCOLS
        : new Set([...HTTP_CDP_PROTOCOLS, ...WS_CDP_PROTOCOLS]);

  if (!allowedProtocols.has(parsed.protocol)) {
    throw new Error(
      `Protocolo CDP bloqueado por seguridad (SSRF): ${parsed.protocol}`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error("Credenciales embebidas en URL CDP bloqueadas por seguridad");
  }

  if (!isLoopbackCdpHost(parsed.hostname)) {
    throw new Error(
      `Host CDP bloqueado por seguridad (SSRF): solo se permite loopback (localhost, 127.0.0.1, [::1]), recibido "${parsed.hostname}"`,
    );
  }

  if (HTTP_CDP_PROTOCOLS.has(parsed.protocol)) {
    if (parsed.search || parsed.hash) {
      throw new Error("URL base CDP HTTP no debe contener query ni fragmento");
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${cleanPath}`;
  }

  return parsed.toString();
}

/**
 * Valida una URL WebSocket (`ws://` o `wss://`) de target CDP contra SSRF.
 */
export function validateCdpWebSocketUrl(rawWsUrl: string): string {
  return validateCdpUrl(rawWsUrl, "ws");
}

/**
 * Normaliza y valida la URL base HTTP/HTTPS de Chrome DevTools Protocol.
 */
export function normalizeCdpUrl(rawUrl?: string): string {
  const url = rawUrl?.trim() || process.env.CHROME_CDP_URL?.trim() || DEFAULT_CDP_URL;
  return validateCdpUrl(url, "http");
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
      redirect: "error",
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
    redirect: "error",
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: Falló consulta a ${cdpUrl}/json/list`);
  }

  const raw = (await res.json()) as any[];
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((item) => item?.type === "page")
    .map((item) => {
      const wsUrl = item.webSocketDebuggerUrl
        ? validateCdpWebSocketUrl(String(item.webSocketDebuggerUrl))
        : undefined;
      return {
        id: String(item.id),
        title: String(item.title ?? ""),
        url: String(item.url ?? ""),
        hasWebSocketDebuggerUrl: Boolean(wsUrl),
        webSocketDebuggerUrl: wsUrl,
      };
    });
}

function validateConfinedOutputPath(outputPath: string, cwd: string): string {
  const resolvedCwd = path.resolve(cwd);
  const resolvedTmp = path.resolve(os.tmpdir());
  const resolvedOut = path.isAbsolute(outputPath)
    ? path.resolve(outputPath)
    : path.resolve(resolvedCwd, outputPath);

  return assertPathWithinRoots(
    resolvedOut,
    [resolvedCwd, resolvedTmp],
    "ruta de captura (cwd o tmpdir)",
  );
}

async function validateNavigationUrl(
  rawUrl: string,
  allowPrivateNetwork = false,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new Error(`URL inválida para navegación CDP: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Esquema/protocolo bloqueado por seguridad en navigatePage: ${parsed.protocol}`);
  }

  if (!allowPrivateNetwork) {
    const verdict = await validatePublicUrlResolved(rawUrl);
    if (!verdict.safe) {
      throw new Error(`Navegación bloqueada por seguridad (SSRF): ${verdict.reason ?? "host no permitido"}`);
    }
  }
}

/**
 * Navega una pestaña existente hacia una URL HTTP/HTTPS y espera a que el documento termine de cargar.
 */
export async function navigatePage(
  options: BrowserNavigateOptions & { allowPrivateNetwork?: boolean },
): Promise<BrowserNavigateResult> {
  await validateNavigationUrl(options.url, Boolean(options.allowPrivateNetwork));

  const target = await resolveTarget(options);
  if (!target.webSocketDebuggerUrl) {
    throw new Error(`La pestaña ${target.id} no expone webSocketDebuggerUrl para control remoto`);
  }

  const wsUrl = validateCdpWebSocketUrl(target.webSocketDebuggerUrl);
  const startTime = Date.now();
  const ws = new WebSocket(wsUrl);

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
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const defaultOutDir = path.join(cwd, ".pi", "browser-screenshots");
  const filename = `screenshot-${Date.now()}.png`;
  const rawOutputPath = options.outputPath
    ? (path.isAbsolute(options.outputPath) ? options.outputPath : path.resolve(cwd, options.outputPath))
    : path.join(defaultOutDir, filename);
  const outputPath = validateConfinedOutputPath(rawOutputPath, cwd);

  const target = await resolveTarget(options);
  if (!target.webSocketDebuggerUrl) {
    throw new Error(`La pestaña ${target.id} no expone webSocketDebuggerUrl para captura`);
  }

  const wsUrl = validateCdpWebSocketUrl(target.webSocketDebuggerUrl);
  const ws = new WebSocket(wsUrl);

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

function sendCdpCommand<T = unknown>(
  ws: WebSocket,
  method: string,
  params?: Record<string, unknown>,
  timeoutMs = 15000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1000000);
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener("message", handler as any);
      ws.removeEventListener("close", onClose as any);
      ws.removeEventListener("error", onError as any);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout en comando CDP "${method}" (${timeoutMs}ms)`));
    }, timeoutMs);

    const onClose = () => {
      cleanup();
      reject(new Error(`WebSocket CDP cerrado mientras se esperaba respuesta de "${method}"`));
    };

    const onError = (err: Event) => {
      cleanup();
      reject(new Error(`Error en WebSocket CDP durante "${method}": ${String(err)}`));
    };

    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.id === id) {
          cleanup();
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
    ws.addEventListener("close", onClose as any);
    ws.addEventListener("error", onError as any);
    try {
      ws.send(JSON.stringify({ id, method, params }));
    } catch (err) {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function waitForCdpEvent(ws: WebSocket, eventName: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener("message", handler as any);
      ws.removeEventListener("close", onClose as any);
      ws.removeEventListener("error", onError as any);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout esperando evento CDP "${eventName}" (${timeoutMs}ms)`));
    }, timeoutMs);

    const onClose = () => {
      cleanup();
      reject(new Error(`WebSocket CDP cerrado mientras se esperaba evento "${eventName}"`));
    };

    const onError = (err: Event) => {
      cleanup();
      reject(new Error(`Error en WebSocket CDP esperando "${eventName}": ${String(err)}`));
    };

    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.method === eventName) {
          cleanup();
          resolve();
        }
      } catch {
        /* ignore */
      }
    };

    ws.addEventListener("message", handler as any);
    ws.addEventListener("close", onClose as any);
    ws.addEventListener("error", onError as any);
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
