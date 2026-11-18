import { validatePublicUrlResolved } from "../../features/dc-websearch/core/dc-websearch-security.ts";

export class DcHttpError extends Error {
  public readonly status?: number;
  public readonly url?: string;

  constructor(
    message: string,
    status?: number,
    url?: string,
  ) {
    super(message);
    this.name = "DcHttpError";
    this.status = status;
    this.url = url;
  }
}

export class DcHttpTimeoutError extends DcHttpError {
  constructor(timeoutMs: number, url?: string) {
    super(`Request timed out after ${timeoutMs}ms`, 408, url);
    this.name = "DcHttpTimeoutError";
  }
}

export interface FetchJsonOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  /** Timeout in milliseconds (default: 5000) */
  timeoutMs?: number;
  /** External AbortSignal to combine with internal timeout */
  signal?: AbortSignal;
  /** Maximum response body size in bytes (default: 5MB) */
  maxSizeBytes?: number;
  /** Optional custom validator/guard before issuing request (e.g. anti-SSRF) */
  validateUrl?: (url: string) => boolean | { safe: boolean; reason?: string } | Promise<boolean | { safe: boolean; reason?: string }>;
  /**
   * Enforce SSRF and DNS rebinding prevention via validatePublicUrlResolved.
   * Defaults to true if options.validateUrl is not explicitly provided.
   * Set to false only when targeting trusted internal local endpoints (e.g. CLIProxy localhost or mock server).
   */
  enforceSsrfProtection?: boolean;
  /** Explicit opt-out alias for trusted local/private network endpoints. */
  allowPrivateNetwork?: boolean;
  /** Maximum redirect hops to follow manually (default: 5). */
  maxRedirects?: number;
}

/** Sanitize URLs to prevent logging bearer tokens or query credentials in error traces. */
export function sanitizeUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    parsed.password = "";
    parsed.username = "";
    if (parsed.searchParams.has("key")) parsed.searchParams.set("key", "[REDACTED]");
    if (parsed.searchParams.has("token")) parsed.searchParams.set("token", "[REDACTED]");
    if (parsed.searchParams.has("apiKey")) parsed.searchParams.set("apiKey", "[REDACTED]");
    return parsed.toString();
  } catch {
    return urlStr.replace(/([?&](?:key|token|apiKey)=)[^&]+/gi, "$1[REDACTED]");
  }
}

function isTrustedInternalBridgeEndpoint(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:") return false;
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return false;
    if (parsed.pathname.startsWith("/v0/management/") || parsed.pathname === "/v1/models") return true;
    if (parsed.port === "8325" && parsed.pathname.startsWith("/quota/")) return true;
    if (parsed.port === "9877" && parsed.pathname === "/status") return true;
    return false;
  } catch {
    return false;
  }
}

async function validateTargetUrl(
  targetUrl: string,
  safeUrl: string,
  enforceSsrf: boolean,
  validateUrl?: FetchJsonOptions["validateUrl"],
  isRedirectHop = false,
): Promise<void> {
  if (enforceSsrf && !validateUrl) {
    const verdict = await validatePublicUrlResolved(targetUrl);
    if (!verdict.safe) {
      throw new DcHttpError(
        `SSRF protection blocked ${isRedirectHop ? "redirect" : "request"}: ${verdict.reason ?? "disallowed host"}`,
        undefined,
        safeUrl,
      );
    }
  }

  if (validateUrl) {
    const verdict = await validateUrl(targetUrl);
    if (typeof verdict === "boolean" && !verdict) {
      throw new DcHttpError("URL validation rejected request (SSRF guard)", undefined, safeUrl);
    } else if (typeof verdict === "object" && !verdict.safe) {
      throw new DcHttpError(`URL validation rejected request: ${verdict.reason ?? "SSRF guard"}`, undefined, safeUrl);
    }
  }
}

async function readResponseTextBounded(
  response: Response,
  maxSizeBytes: number,
  safeUrl: string,
): Promise<string> {
  const contentLength = response.headers?.get?.("content-length");
  if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
    try {
      await response.body?.cancel();
    } catch {
      /* ignore */
    }
    throw new DcHttpError(
      `Response size ${contentLength} bytes exceeds limit of ${maxSizeBytes} bytes`,
      response.status,
      safeUrl,
    );
  }

  if (response.body && typeof (response.body as any).getReader === "function") {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxSizeBytes) {
            await reader.cancel().catch(() => {});
            throw new DcHttpError(
              `Response size ${totalBytes} bytes exceeds limit of ${maxSizeBytes} bytes`,
              response.status,
              safeUrl,
            );
          }
          chunks.push(value);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }

    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  }

  const text = await response.text();
  const byteLen = Buffer.byteLength(text, "utf8");
  if (byteLen > maxSizeBytes) {
    throw new DcHttpError(
      `Response length ${byteLen} bytes exceeds limit of ${maxSizeBytes} bytes`,
      response.status,
      safeUrl,
    );
  }
  return text;
}

/**
 * Robust JSON fetch client with timeout, combined abort signals,
 * payload size limit and secret redaction.
 */
export async function fetchJson<T = unknown>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<T> {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 5000,
    signal: externalSignal,
    maxSizeBytes = 5 * 1024 * 1024,
    maxRedirects = 5,
  } = options;

  const enforceSsrfProtection =
    options.allowPrivateNetwork === true
      ? false
      : (options.enforceSsrfProtection ?? (!options.validateUrl && !isTrustedInternalBridgeEndpoint(url)));

  const safeUrl = sanitizeUrl(url);

  await validateTargetUrl(url, safeUrl, enforceSsrfProtection, options.validateUrl, false);

  // Combine external signal and internal timeout controller
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  const onExternalAbort = () => {
    timeoutController.abort();
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new DcHttpError("Request aborted by caller", undefined, safeUrl);
    }
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    let currentUrl = url;
    let currentMethod: string = method;
    let serializedBody =
      body !== undefined && typeof body !== "string"
        ? JSON.stringify(body)
        : (body as string | undefined);

    const reqHeaders: Record<string, string> = {
      Accept: "application/json",
      ...headers,
    };
    if (serializedBody && !reqHeaders["Content-Type"]) {
      reqHeaders["Content-Type"] = "application/json";
    }

    let response: Response | undefined;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      response = await fetch(currentUrl, {
        method: currentMethod,
        headers: reqHeaders,
        body: serializedBody,
        signal: timeoutController.signal,
        redirect: "manual",
      });

      if (response.status >= 300 && response.status < 400 && [301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers?.get?.("location");
        try {
          await response.body?.cancel();
        } catch {
          /* ignore */
        }
        if (!location) {
          throw new DcHttpError(`Redirect HTTP ${response.status} missing Location header`, response.status, safeUrl);
        }
        if (hop === maxRedirects) {
          throw new DcHttpError(`Too many redirects (exceeded ${maxRedirects} hops)`, response.status, safeUrl);
        }
        const nextUrl = new URL(location, currentUrl).toString();
        const enforceRedirectSsrf =
          options.allowPrivateNetwork === true ? false : (options.enforceSsrfProtection ?? true);
        await validateTargetUrl(
          nextUrl,
          sanitizeUrl(nextUrl),
          enforceRedirectSsrf,
          options.validateUrl,
          true,
        );
        currentUrl = nextUrl;
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === "POST")) {
          currentMethod = "GET";
          serializedBody = undefined;
          delete reqHeaders["Content-Type"];
        }
        continue;
      }
      break;
    }

    if (!response) {
      throw new DcHttpError("No response received", undefined, safeUrl);
    }

    if (!response.ok) {
      throw new DcHttpError(
        `HTTP ${response.status} ${response.statusText}`,
        response.status,
        safeUrl,
      );
    }

    const text = await readResponseTextBounded(response, maxSizeBytes, safeUrl);

    if (!text.trim()) {
      return {} as T;
    }

    return JSON.parse(text) as T;
  } catch (err: unknown) {
    if (timedOut) {
      throw new DcHttpTimeoutError(timeoutMs, safeUrl);
    }
    if (err instanceof DcHttpError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new DcHttpError(`Network request failed: ${message}`, undefined, safeUrl);
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}
