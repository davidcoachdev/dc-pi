export class DcHttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = "DcHttpError";
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
  } = options;

  const safeUrl = sanitizeUrl(url);

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
    const serializedBody =
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

    const response = await fetch(url, {
      method,
      headers: reqHeaders,
      body: serializedBody,
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      throw new DcHttpError(
        `HTTP ${response.status} ${response.statusText}`,
        response.status,
        safeUrl,
      );
    }

    // Check content-length header if provided
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxSizeBytes) {
      throw new DcHttpError(
        `Response size ${contentLength} bytes exceeds limit of ${maxSizeBytes} bytes`,
        response.status,
        safeUrl,
      );
    }

    const text = await response.text();
    if (text.length > maxSizeBytes) {
      throw new DcHttpError(
        `Response length ${text.length} characters exceeds limit of ${maxSizeBytes}`,
        response.status,
        safeUrl,
      );
    }

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
