import type { ApiRestRequestOptions, ApiRestResponse } from "./dc-api-types.ts";
import { redactSecrets } from "../../dc-websearch/core/dc-websearch-security.ts";

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 100 * 1024; // 100 KB

/**
 * Ejecuta una petición HTTP REST segura con límite de tamaño de respuesta y sanitización.
 */
export async function executeRestRequest(options: ApiRestRequestOptions): Promise<ApiRestResponse> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_BYTES;

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "User-Agent": "DC-Studio-Api-Tools/1.0",
    ...options.headers,
  };

  let bodyPayload: string | undefined = undefined;
  if (options.body !== undefined && options.body !== null && method !== "GET" && method !== "HEAD") {
    if (typeof options.body === "object") {
      bodyPayload = JSON.stringify(options.body);
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
    } else {
      bodyPayload = String(options.body);
    }
  }

  const startTime = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(options.url, {
      method,
      headers,
      body: bodyPayload,
      signal: ctrl.signal,
    });

    const durationMs = Date.now() - startTime;
    const rawText = await res.text();
    const byteSize = Buffer.byteLength(rawText, "utf8");
    const truncated = byteSize > maxBytes;
    const safeText = truncated ? rawText.slice(0, maxBytes) : rawText;

    // Detectar si el contenido es JSON para formatearlo prolijo
    let isJson = false;
    let formattedBody = safeText;
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json") || safeText.trim().startsWith("{") || safeText.trim().startsWith("[")) {
      try {
        const parsed = JSON.parse(safeText);
        formattedBody = JSON.stringify(parsed, null, 2);
        isJson = true;
      } catch {
        /* continue */
      }
    }

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((val, key) => {
      responseHeaders[key] = val;
    });

    return {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      durationMs,
      body: redactSecrets(formattedBody),
      byteSize,
      truncated,
      isJson,
    };
  } finally {
    clearTimeout(timer);
  }
}
