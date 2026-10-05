/**
 * dc-owasp-diff-engine.ts — Motor de análisis estático y reglas contextuales
 * de OWASP aplicadas a diffs (git diff) o fragmentos de código.
 */

import type { OwaspAuditFinding, OwaspAuditReport } from "./dc-owasp-types.ts";

export interface AuditRule {
  id: string;
  category: string;
  cheatsheet: string;
  cheatsheetUrl: string;
  severity: "high" | "medium" | "low" | "info";
  message: string;
  remediation: string;
  // Patrones que activan la regla si aparecen en líneas añadidas (+)
  patterns: RegExp[];
  // Extensiones de archivo aplicables (si está vacío, aplica a todos)
  fileFilter?: string[];
}

export const OWASP_DIFF_RULES: AuditRule[] = [
  // 1. Inyección SQL / Raw Queries
  {
    id: "OWASP-SQLI-01",
    category: "SQL Injection",
    cheatsheet: "SQL Injection Prevention Cheat Sheet",
    cheatsheetUrl: "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html",
    severity: "high",
    message: "Concatenación de strings o template literals detectada en consulta SQL/Query.",
    remediation: "Usar consultas preparadas/parametrizadas o métodos seguros del ORM (Parameterized Queries).",
    patterns: [
      /`\s*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)[^`]*\$\{/i,
      /(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\s+.*(?:\+|`.*\$\{)/i,
      /(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\s+['"][^'"]*['"]\s*\+/i,
      /\.query\s*\(\s*`[^`]*\$\{/i,
      /\.raw\s*\(\s*`[^`]*\$\{/i,
      /execute\s*\(\s*['"][^'"]*%\s*[a-zA-Z]/i,
    ],
    fileFilter: [".ts", ".js", ".py", ".go", ".java", ".php", ".rb", ".sql"],
  },

  // 2. Cross-Site Scripting (XSS) / Inyección DOM
  {
    id: "OWASP-XSS-01",
    category: "XSS Prevention",
    cheatsheet: "Cross Site Scripting Prevention Cheat Sheet",
    cheatsheetUrl: "https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html",
    severity: "high",
    message: "Inyección directa de HTML sin sanitizar (dangerouslySetInnerHTML o innerHTML).",
    remediation: "Evitar renderizar HTML crudo. Usar DOMPurify o elementos con textContent / interpolación segura del framework.",
    patterns: [
      /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:/,
      /\.innerHTML\s*=/,
      /v-html\s*=/,
      /\[innerHTML\]\s*=/,
    ],
    fileFilter: [".tsx", ".jsx", ".vue", ".html", ".js", ".ts"],
  },

  // 3. Manejo Inseguro de Cookies / Sesiones
  {
    id: "OWASP-SESS-01",
    category: "Session Management",
    cheatsheet: "Session Management Cheat Sheet",
    cheatsheetUrl: "https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html",
    severity: "medium",
    message: "Cookie de sesión configurada sin las banderas de seguridad recomendadas (httpOnly, secure, sameSite).",
    remediation: "Asegurar que las cookies lleven { httpOnly: true, secure: true, sameSite: 'strict' | 'lax' }.",
    patterns: [
      /res\.cookie\s*\([^)]*\{\s*(?!.*httpOnly:\s*true)/i,
      /set-cookie.*(?!.*httponly)/i,
      /res\.cookie\s*\([^)]*httpOnly:\s*false/i,
    ],
    fileFilter: [".ts", ".js", ".py", ".go", ".java"],
  },

  // 4. Tokens en LocalStorage
  {
    id: "OWASP-AUTH-02",
    category: "Authentication & Token Storage",
    cheatsheet: "HTML5 Security Cheat Sheet / JWT Cheat Sheet",
    cheatsheetUrl: "https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html",
    severity: "medium",
    message: "Guardado de token sensible o credencial en localStorage/sessionStorage (vulnerable a robo por XSS).",
    remediation: "Almacenar tokens de autenticación en cookies HttpOnly seguras o memoria volátil.",
    patterns: [
      /localStorage\.setItem\s*\(\s*['"](?:token|jwt|access_token|refresh_token|auth|secret)['"]/i,
      /sessionStorage\.setItem\s*\(\s*['"](?:token|jwt|access_token|refresh_token|auth|secret)['"]/i,
    ],
    fileFilter: [".ts", ".js", ".tsx", ".jsx", ".vue"],
  },

  // 5. CORS Permisivo Peligroso
  {
    id: "OWASP-CORS-01",
    category: "CORS Misconfiguration",
    cheatsheet: "Cross-Origin Resource Sharing Cheat Sheet",
    cheatsheetUrl: "https://cheatsheetseries.owasp.org/cheatsheets/Cross-Origin_Resource_Sharing_Cheat_Sheet.html",
    severity: "high",
    message: "Configuración CORS excesivamente permisiva con credenciales habilitadas ('*' con credentials).",
    remediation: "Nunca usar origin: '*' junto con credentials: true. Validar una lista blanca estricta de orígenes permitidos.",
    patterns: [
      /origin:\s*['"]\*['"].*credentials:\s*true/is,
      /Access-Control-Allow-Origin.*\*.*Access-Control-Allow-Credentials.*true/is,
      /cors\s*\(\s*\{\s*origin:\s*true\s*,\s*credentials:\s*true\s*\}\s*\)/,
    ],
    fileFilter: [".ts", ".js", ".py", ".go", ".java"],
  },

  // 6. Criptografía Débil
  {
    id: "OWASP-CRYPTO-01",
    category: "Cryptographic Storage",
    cheatsheet: "Cryptographic Storage Cheat Sheet",
    cheatsheetUrl: "https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html",
    severity: "high",
    message: "Uso de algoritmo de hash o cifrado obsoleto/vulnerable (MD5 o SHA1).",
    remediation: "Usar SHA-256 / SHA-3 para checksums, o Argon2id / bcrypt / scrypt para contraseñas.",
    patterns: [
      /createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/i,
      /hashlib\.(?:md5|sha1)\s*\(/i,
      /MessageDigest\.getInstance\s*\(\s*['"](?:MD5|SHA-1)['"]\s*\)/i,
    ],
    fileFilter: [".ts", ".js", ".py", ".go", ".java"],
  },

  // 7. Desactivación de Verificación TLS/SSL
  {
    id: "OWASP-TLS-01",
    category: "Transport Layer Security",
    cheatsheet: "Transport Layer Security Cheat Sheet",
    cheatsheetUrl: "https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html",
    severity: "high",
    message: "Desactivación explícita de validación de certificados SSL/TLS (rejectUnauthorized: false).",
    remediation: "Nunca deshabilitar la verificación de certificados TLS en entornos productivos.",
    patterns: [
      /rejectUnauthorized:\s*false/i,
      /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]0['"]/,
      /verify\s*=\s*False/i, // Python requests
      /InsecureSkipVerify:\s*true/i, // Go
    ],
    fileFilter: [".ts", ".js", ".py", ".go"],
  },

  // 8. Secretos o API Keys quemados en código
  {
    id: "OWASP-SECRETS-01",
    category: "Secret Management",
    cheatsheet: "Key Management Cheat Sheet",
    cheatsheetUrl: "https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html",
    severity: "high",
    message: "Posible API Key o secreto en texto plano en el código fuente.",
    remediation: "Extraer secretos a variables de entorno o gestores de secretos seguros (Vault, Doppler).",
    patterns: [
      /(?:api[_-]?key|secret|password|private[_-]?key)\s*=\s*['"][a-zA-Z0-9_\-]{20,}['"]/i,
      /ghp_[a-zA-Z0-9]{36}/, // GitHub Personal Token
      /sk-[a-zA-Z0-9]{20,}/, // OpenAI / LLM key
    ],
    fileFilter: [".ts", ".js", ".py", ".go", ".java", ".json", ".env.example"],
  },
];

/**
 * Parsea un git diff o fragmento de código y evalúa las líneas agregadas (+) contra las reglas OWASP.
 */
export function auditDiff(diffContent: string): OwaspAuditReport {
  const lines = diffContent.split("\n");
  const findings: OwaspAuditFinding[] = [];

  let currentFile = "unknown";
  let lineNum = 0;

  for (const line of lines) {
    // Detectar archivo en el diff de git (ej. "+++ b/src/auth.ts" o "diff --git a/x b/x")
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6).trim();
      lineNum = 0;
      continue;
    } else if (line.startsWith("--- a/")) {
      continue;
    }

    // Contar líneas
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineNum++;
      const addedContent = line.slice(1).trim();

      // Evaluar cada regla
      for (const rule of OWASP_DIFF_RULES) {
        if (rule.fileFilter && !rule.fileFilter.some((ext) => currentFile.endsWith(ext))) {
          // Si el archivo no coincide con las extensiones de la regla, omitir
          continue;
        }

        for (const pattern of rule.patterns) {
          if (pattern.test(addedContent)) {
            // Evitar duplicar el mismo hallazgo en la misma línea
            const exists = findings.some(
              (f) => f.ruleId === rule.id && f.file === currentFile && f.line === lineNum,
            );
            if (!exists) {
              findings.push({
                severity: rule.severity,
                ruleId: rule.id,
                category: rule.category,
                cheatsheet: rule.cheatsheet,
                cheatsheetUrl: rule.cheatsheetUrl,
                file: currentFile !== "unknown" ? currentFile : undefined,
                line: lineNum > 0 ? lineNum : undefined,
                snippet: addedContent.slice(0, 160),
                message: rule.message,
                remediation: rule.remediation,
              });
            }
            break;
          }
        }
      }
    }
  }

  // Si no era formato git diff (ej. código suelto sin '+' iniciales), analizar líneas directas
  if (findings.length === 0 && !diffContent.includes("+++ b/")) {
    lineNum = 0;
    for (const rawLine of lines) {
      lineNum++;
      const trimmed = rawLine.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) continue;

      for (const rule of OWASP_DIFF_RULES) {
        for (const pattern of rule.patterns) {
          if (pattern.test(trimmed)) {
            const exists = findings.some(
              (f) => f.ruleId === rule.id && f.line === lineNum,
            );
            if (!exists) {
              findings.push({
                severity: rule.severity,
                ruleId: rule.id,
                category: rule.category,
                cheatsheet: rule.cheatsheet,
                cheatsheetUrl: rule.cheatsheetUrl,
                line: lineNum,
                snippet: trimmed.slice(0, 160),
                message: rule.message,
                remediation: rule.remediation,
              });
            }
            break;
          }
        }
      }
    }
  }

  const high = findings.filter((f) => f.severity === "high").length;
  const medium = findings.filter((f) => f.severity === "medium").length;
  const low = findings.filter((f) => f.severity === "low").length;
  const info = findings.filter((f) => f.severity === "info").length;

  return {
    timestamp: Date.now(),
    totalFindings: findings.length,
    high,
    medium,
    low,
    info,
    findings,
  };
}
