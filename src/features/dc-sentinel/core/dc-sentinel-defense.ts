/**
 * DC Sentinel — Memory Defense & Sanitizer (Fase 3)
 *
 * Implementa:
 * 1. Memory Defense: Escáner de 45 patrones regex para censurar credenciales y secretos (Hindsight).
 * 2. Barrera de Privacidad: Eliminación de bloques `<private>...</private>` (Cavemem).
 * 3. skillResultRedactor: Redacción de archivos de skills cargadas para ahorrar miles de tokens (Mastra).
 * 4. Poda de Volcados de Terminal: Truncado seguro de salidas gigantescas (>2.000 chars) para evitar context rot.
 */

import * as path from "node:path";

export interface DefenseSanitizeResult {
  text: string;
  redactedCount: number;
  redactedTypes: string[];
  privateBlocksStripped: number;
}

interface DefensePattern {
  type: string;
  regex: RegExp;
}

/**
 * 45 patrones canónicos de censura de secretos y credenciales (Hindsight Memory Defense).
 */
export const DEFENSE_PATTERNS: DefensePattern[] = [
  // 1. LLMs & AI Providers
  { type: "anthropic_key", regex: /sk-ant-[a-zA-Z0-9_-]{20,}/g },
  { type: "openai_project_key", regex: /sk-proj-[a-zA-Z0-9_-]{20,}/g },
  { type: "openai_admin_key", regex: /sk-admin-[a-zA-Z0-9_-]{20,}/g },
  { type: "openai_key", regex: /sk-[a-zA-Z0-9]{32,}/g },
  { type: "google_api_key", regex: /AIza[0-9A-Za-z-_]{35}/g },
  { type: "google_oauth", regex: /ya29\.[0-9A-Za-z-_]{30,}/g },
  { type: "xai_key", regex: /xai-[a-zA-Z0-9_-]{30,}/g },
  { type: "groq_key", regex: /gsk_[a-zA-Z0-9]{30,}/g },
  { type: "huggingface_token", regex: /hf_[a-zA-Z0-9]{30,}/g },
  { type: "replicate_token", regex: /r8_[a-zA-Z0-9]{30,}/g },
  { type: "perplexity_key", regex: /pplx-[a-zA-Z0-9]{30,}/g },
  { type: "deepseek_key", regex: /sk-[a-f0-9]{32}/g },

  // 2. Cloud Providers
  { type: "aws_access_key", regex: /AKIA[0-9A-Z]{16}/g },
  { type: "aws_session_token", regex: /ASIA[0-9A-Z]{16}/g },
  { type: "digitalocean_token", regex: /dop_v1_[a-f0-9]{64}/g },

  // 3. Source Control & Registries
  { type: "github_pat", regex: /github_pat_[0-9a-zA-Z_]{60,}/g },
  { type: "github_token", regex: /ghp_[0-9a-zA-Z]{36}/g },
  { type: "github_app_token", regex: /ghs_[0-9a-zA-Z]{36}/g },
  { type: "github_user_token", regex: /ghu_[0-9a-zA-Z]{36}/g },
  { type: "github_oauth", regex: /gho_[0-9a-zA-Z]{36}/g },
  { type: "gitlab_pat", regex: /glpat-[0-9a-zA-Z_-]{20,}/g },
  { type: "npm_token", regex: /npm_[0-9a-zA-Z]{36}/g },
  { type: "pypi_token", regex: /pypi-AgEI[0-9a-zA-Z_-]{50,}/g },

  // 4. Payments
  { type: "stripe_secret", regex: /sk_(live|test)_[0-9a-zA-Z]{24,}/g },
  { type: "stripe_restricted", regex: /rk_(live|test)_[0-9a-zA-Z]{24,}/g },
  { type: "square_token", regex: /sq0[a-z]{3}-[0-9A-Za-z\-_]{22,}/g },

  // 5. Messaging & Mail
  { type: "slack_token", regex: /xox[bpar]-[0-9a-zA-Z-]{20,}/g },
  { type: "slack_webhook", regex: /https:\/\/hooks\.slack\.com\/services\/T[0-9A-Z]+\/B[0-9A-Z]+\/[0-9a-zA-Z]+/g },
  { type: "discord_bot", regex: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27}/g },
  { type: "telegram_bot", regex: /[0-9]{8,10}:[a-zA-Z0-9_-]{35}/g },
  { type: "twilio_api_key", regex: /SK[a-f0-9]{32}/g },
  { type: "twilio_account_sid", regex: /AC[a-f0-9]{32}/g },
  { type: "sendgrid_key", regex: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/g },

  // 6. Database Connection Strings (censura contraseña)
  {
    type: "db_url_postgres",
    regex: /postgres(ql)?:\/\/([^:\s]+):([^@\s]+)@([^\s/:]+)(:\d+)?\/([^\s?]+)/gi,
  },
  {
    type: "db_url_mysql",
    regex: /mysql:\/\/([^:\s]+):([^@\s]+)@([^\s/:]+)(:\d+)?\/([^\s?]+)/gi,
  },
  {
    type: "db_url_mongodb",
    regex: /mongodb(\+srv)?:\/\/([^:\s]+):([^@\s]+)@([^\s/:]+)/gi,
  },
  {
    type: "db_url_redis",
    regex: /redis(s)?:\/\/([^:\s]+):([^@\s]+)@([^\s/:]+)/gi,
  },

  // 7. Private Keys PEM & JWTs
  {
    type: "private_key_pem",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  },
  {
    type: "jwt",
    regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
  },

  // 8. PII
  { type: "ssn_us", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: "credit_card", regex: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/g },
];

/**
 * Censura credenciales, secretos y bloques `<private>` del texto de entrada.
 */
export function sanitizeMemoryDefense(text: string): DefenseSanitizeResult {
  if (!text || typeof text !== "string") {
    return { text: "", redactedCount: 0, redactedTypes: [], privateBlocksStripped: 0 };
  }

  let sanitized = text;
  let privateBlocksStripped = 0;

  // 1. Purgar bloques de privacidad <private>...</private> o <secret>...</secret>
  const privateRegex = /<(?:private|secret)>[\s\S]*?<\/(?:private|secret)>/gi;
  sanitized = sanitized.replace(privateRegex, () => {
    privateBlocksStripped++;
    return "[PRIVATE_CONTENT_REDACTED]";
  });

  const redactedTypesSet = new Set<string>();
  let redactedCount = 0;

  // 2. Aplicar escáner de 45 patrones regex
  for (const { type, regex } of DEFENSE_PATTERNS) {
    if (type.startsWith("db_url_")) {
      // Reemplazo especial para URLs de BD: conservar usuario y host, censurar contraseña
      sanitized = sanitized.replace(regex, (match, p1, user, _pass, host, port, db) => {
        redactedTypesSet.add(type);
        redactedCount++;
        const pStr = port ? port : "";
        const dbStr = db ? `/${db}` : "";
        return `${p1}://${user}:[REDACTED_PASSWORD]@${host}${pStr}${dbStr}`;
      });
    } else {
      sanitized = sanitized.replace(regex, () => {
        redactedTypesSet.add(type);
        redactedCount++;
        return `[REDACTED:${type}]`;
      });
    }
  }

  return {
    text: sanitized,
    redactedCount,
    redactedTypes: Array.from(redactedTypesSet),
    privateBlocksStripped,
  };
}

export interface SkillRedactionOptions {
  skillPathThreshold?: number;
}

/**
 * Mastra Pattern: skillResultRedactor
 * Si el resultado de una herramienta proviene de haber leído un `SKILL.md` o archivo
 * de skill voluminoso, reemplaza el contenido por un identificador liviano para
 * no quemar miles de tokens re-observando instrucciones ya conocidas.
 */
export function redactSkillResult(
  toolName: string,
  args: Record<string, unknown>,
  output: string,
): string {
  if (!output || typeof output !== "string") return output;

  const targetPath = String(args?.path || args?.file || "").toLowerCase();

  // Detección de lectura de SKILL.md o archivos dentro de .pi/agent/skills/
  const isSkillFile =
    targetPath.endsWith("skill.md") ||
    targetPath.includes("/skills/") ||
    targetPath.includes("\\skills\\");

  if (isSkillFile && (toolName === "read" || toolName === "read_file")) {
    const skillNameMatch = targetPath.match(/(?:skills[/\\])([^/\\]+)/i);
    const skillName = skillNameMatch ? skillNameMatch[1] : path.basename(path.dirname(targetPath)) || "skill";
    return `[Skill loaded: ${skillName} (${output.length} bytes omitidos de memoria)]`;
  }

  return output;
}

/**
 * Trunca volcados gigantescos de terminal o lecturas de archivos para evitar context rot.
 */
export function pruneToolOutput(output: string, maxChars: number = 2000): string {
  if (!output || typeof output !== "string") return "";
  if (output.length <= maxChars) return output;

  const half = Math.floor(maxChars / 2) - 30;
  const head = output.slice(0, half);
  const tail = output.slice(output.length - half);
  const omitted = output.length - (head.length + tail.length);

  return `${head}\n\n... [${omitted} caracteres omitidos por dc-sentinel para proteger el contexto] ...\n\n${tail}`;
}
