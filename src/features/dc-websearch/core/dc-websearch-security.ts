import { URL } from "node:url";

const SENSITIVE_PATTERNS = [
  /bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi,
  /(?:api[_-]?key|secret|token|password|auth)['"]?\s*[:=]\s*['"]?([a-zA-Z0-9_\-\.]{16,})['"]?/gi,
  /ghp_[a-zA-Z0-9]{36}/g,
  /gho_[a-zA-Z0-9]{36}/g,
  /sk-[a-zA-Z0-9]{48}/g,
];

/**
 * Sanitiza cadenas de texto enmascarando posibles credenciales filtradas.
 */
export function redactSecrets(text: string): string {
  if (!text) return "";
  let sanitized = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED_SECRET]");
  }
  return sanitized;
}

/**
 * Valida si una URL es segura para fetching contra ataques SSRF.
 * Bloquea esquemas no-http, localhost, IPs privadas y metadatos de cloud.
 */
export function isSafeWebUrl(rawUrl: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { safe: false, reason: `Protocolo no permitido: ${parsed.protocol}` };
    }

    const host = parsed.hostname.toLowerCase();

    // Localhost y loopbacks
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return { safe: false, reason: "Acceso a loopback/localhost denegado por seguridad" };
    }

    // IPs privadas (RFC 1918)
    if (
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      host.startsWith("169.254.") // link-local y cloud metadata
    ) {
      return { safe: false, reason: "Acceso a IP privada denegado por seguridad" };
    }

    return { safe: true };
  } catch (err) {
    return { safe: false, reason: `URL inválida: ${err instanceof Error ? err.message : String(err)}` };
  }
}
