import { URL } from "node:url";
import dns from "node:dns/promises";
import net from "node:net";

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
 * Comprueba si una dirección IP (IPv4 o IPv6) pertenece a un rango privado,
 * loopback, link-local, multicast o reservado.
 */
export function isPrivateIp(ip: string): boolean {
  if (!net.isIP(ip)) return false;

  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map((n) => parseInt(n, 10));
    const [b0, b1] = parts;
    if (b0 === undefined || b1 === undefined) return false;

    // 0.0.0.0/8 (red actual)
    if (b0 === 0) return true;
    // 127.0.0.0/8 (todo el bloque loopback)
    if (b0 === 127) return true;
    // 10.0.0.0/8 (privada RFC 1918)
    if (b0 === 10) return true;
    // 172.16.0.0/12 (privada RFC 1918: 172.16 - 172.31)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (privada RFC 1918)
    if (b0 === 192 && b1 === 168) return true;
    // 169.254.0.0/16 (link-local y cloud metadata RFC 3927)
    if (b0 === 169 && b1 === 254) return true;
    // 100.64.0.0/10 (CGNAT RFC 6598)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // 224.0.0.0/4 (multicast) y 240.0.0.0/4 (reservada)
    if (b0 >= 224) return true;

    return false;
  }

  // IPv6
  let norm = ip.toLowerCase();
  if (norm === "::1" || norm === "::") return true;

  // Normalizar forma expandida de IPv4-mapped (ej: 0:0:0:0:0:ffff:...) a ::ffff:...
  if (norm.startsWith("0:0:0:0:0:ffff:")) {
    norm = `::ffff:${norm.slice(15)}`;
  } else if (/^(?:0+:){5}ffff:/i.test(norm)) {
    norm = norm.replace(/^(?:0+:){5}ffff:/i, "::ffff:");
  }

  // IPv4 mapeada en IPv6 (ej: ::ffff:127.0.0.1 o ::ffff:7f00:1 o ::ffff:c0a8:0101)
  if (norm.startsWith("::ffff:")) {
    const rest = norm.slice(7);
    if (net.isIPv4(rest)) {
      return isPrivateIp(rest);
    }
    // Si viene en hexadecimal de dos bloques (ej: 7f00:1)
    const parts = rest.split(":");
    if (parts.length === 2 && /^[0-9a-f]{1,4}$/i.test(parts[0]!) && /^[0-9a-f]{1,4}$/i.test(parts[1]!)) {
      const high = parseInt(parts[0]!, 16);
      const low = parseInt(parts[1]!, 16);
      const b0 = (high >> 8) & 0xff;
      const b1 = high & 0xff;
      const b2 = (low >> 8) & 0xff;
      const b3 = low & 0xff;
      return isPrivateIp(`${b0}.${b1}.${b2}.${b3}`);
    }
    return true; // Cualquier IPv4-mapped malformada o no parseable se bloquea por seguridad
  }

  // fc00::/7 (Unique Local Address RFC 4193)
  if (/^f[cd][0-9a-f]{2}:/i.test(norm)) return true;
  // fe80::/10 (Link-Local unicast RFC 4291)
  if (/^fe[89ab][0-9a-f]:/i.test(norm)) return true;

  return false;
}

/**
 * Valida sintácticamente si una URL es segura para fetching contra ataques SSRF.
 * Bloquea esquemas no-http, localhost, IPs privadas e inspecciona el hostname literal.
 */
export function isSafeWebUrl(rawUrl: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { safe: false, reason: `Protocolo no permitido: ${parsed.protocol}` };
    }

    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

    // Localhost y loopbacks literales
    if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1") {
      return { safe: false, reason: "Acceso a loopback/localhost denegado por seguridad" };
    }

    // Si el host es una IP literal (IPv4, IPv6 o IPv4-mapped), verificar sus rangos
    if (net.isIP(host) && isPrivateIp(host)) {
      return { safe: false, reason: "Acceso a IP privada/loopback denegado por seguridad" };
    }
    if (host.startsWith("::ffff:") && isPrivateIp(host)) {
      return { safe: false, reason: "Acceso a IP privada/loopback mapeada denegado por seguridad" };
    }

    // Cobertura de prefijos típicos
    if (
      host.startsWith("127.") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      host.startsWith("169.254.")
    ) {
      return { safe: false, reason: "Acceso a IP privada denegado por seguridad" };
    }

    return { safe: true };
  } catch (err) {
    return { safe: false, reason: `URL inválida: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Valida exhaustivamente contra DNS Rebinding y resuelve la IP efectiva en red
 * antes de permitir cualquier conexión externa.
 */
export async function validatePublicUrlResolved(rawUrl: string): Promise<{ safe: boolean; reason?: string }> {
  const syncCheck = isSafeWebUrl(rawUrl);
  if (!syncCheck.safe) return syncCheck;

  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

    if (net.isIP(host)) {
      if (isPrivateIp(host)) {
        return { safe: false, reason: "Acceso a IP privada denegado por seguridad" };
      }
      return { safe: true };
    }

    // Resolver IPs reales en DNS para bloquear Rebinding hacia rangos privados/loopback
    const addresses = await dns.lookup(host, { all: true });
    for (const record of addresses) {
      if (isPrivateIp(record.address)) {
        return {
          safe: false,
          reason: `DNS Rebinding detectado: ${host} resuelve a IP privada/interna (${record.address})`,
        };
      }
    }

    return { safe: true };
  } catch (err) {
    return { safe: false, reason: `Error resolviendo DNS para validación SSRF: ${err instanceof Error ? err.message : String(err)}` };
  }
}
