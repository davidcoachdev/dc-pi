import type { ApiRestRequestOptions, ApiRestResponse } from "./dc-api-types.ts";
import { redactSecrets, validatePublicUrlResolved } from "../../dc-websearch/core/dc-websearch-security.ts";

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BYTES = 100 * 1024; // 100 KB
const DEFAULT_MAX_REDIRECTS = 5;

async function readStreamBounded(
  res: Response,
  maxBytes: number,
): Promise<{ safeText: string; byteSize: number; truncated: boolean }> {
  if (res.body && typeof (res.body as any).getReader === "function") {
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let truncated = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          const buf = Buffer.from(value);
          totalBytes += buf.byteLength;
          if (totalBytes > maxBytes) {
            const overage = totalBytes - maxBytes;
            const keepLen = buf.byteLength - overage;
            if (keepLen > 0) {
              chunks.push(buf.subarray(0, keepLen));
            }
            truncated = true;
            await reader.cancel().catch(() => {});
            break;
          }
          chunks.push(buf);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }

    const combined = Buffer.concat(chunks);
    const safeText = combined.toString("utf8");
    return {
      safeText,
      byteSize: totalBytes,
      truncated,
    };
  }

  const rawText = await res.text();
  const byteSize = Buffer.byteLength(rawText, "utf8");
  const truncated = byteSize > maxBytes;
  const safeText = truncated ? Buffer.from(rawText, "utf8").subarray(0, maxBytes).toString("utf8") : rawText;
  return { safeText, byteSize, truncated };
}

/**
 * Ejecuta una petición HTTP REST segura con límite de tamaño de respuesta y sanitización.
 */
export async function executeRestRequest(
  options: ApiRestRequestOptions & {
    allowPrivateNetwork?: boolean;
    enforceSsrfProtection?: boolean;
    maxRedirects?: number;
  },
): Promise<ApiRestResponse> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const enforceSsrf =
    options.allowPrivateNetwork === true ? false : (options.enforceSsrfProtection ?? true);

  if (enforceSsrf) {
    const verdict = await validatePublicUrlResolved(options.url);
    if (!verdict.safe) {
      throw new Error(`SSRF protection blocked request: ${verdict.reason ?? "disallowed host"}`);
    }
  }

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
    let currentUrl = options.url;
    let currentMethod: string = method;
    let currentBody = bodyPayload;
    let res: Response | undefined;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      res = await fetch(currentUrl, {
        method: currentMethod,
        headers,
        body: currentBody,
        signal: ctrl.signal,
        redirect: "manual",
      });

      if (res.status >= 300 && res.status < 400 && [301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get("location");
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
        if (!location) {
          throw new Error(`Redirect HTTP ${res.status} sin cabecera Location`);
        }
        if (hop === maxRedirects) {
          throw new Error(`Demasiadas redirecciones (límite: ${maxRedirects})`);
        }
        const nextUrl = new URL(location, currentUrl).toString();
        if (enforceSsrf) {
          const verdict = await validatePublicUrlResolved(nextUrl);
          if (!verdict.safe) {
            throw new Error(`SSRF protection blocked redirect: ${verdict.reason ?? "disallowed host"}`);
          }
        }
        currentUrl = nextUrl;
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === "POST")) {
          currentMethod = "GET";
          currentBody = undefined;
          delete headers["Content-Type"];
        }
        continue;
      }
      break;
    }

    if (!res) {
      throw new Error("No se recibió respuesta HTTP");
    }

    const durationMs = Date.now() - startTime;
    const { safeText, byteSize, truncated } = await readStreamBounded(res, maxBytes);

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

    // Sanitizar cabeceras de respuesta sensibles (ej: Set-Cookie, Authorization)
    const sanitizedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(responseHeaders)) {
      if (/cookie|auth|token|key|secret/i.test(k)) {
        sanitizedHeaders[k] = "[REDACTED_HEADER]";
      } else {
        sanitizedHeaders[k] = redactSecrets(v);
      }
    }

    return {
      status: res.status,
      statusText: res.statusText,
      headers: sanitizedHeaders,
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
