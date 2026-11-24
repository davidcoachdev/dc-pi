/**
 * dc-owasp-tools.ts — Herramientas para el LLM:
 * - dc_owasp_query: Consulta de guías, defensas primarias y snippets de OWASP.
 * - dc_owasp_audit: Auditoría de código o git diff contra reglas canónicas de OWASP.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as util from "node:util";
import { assertPathWithinRoots } from "../../../core/dc-path-confinement.ts";
import { DcOwaspClient } from "../core/dc-owasp-client.ts";
import { auditDiff } from "../core/dc-owasp-diff-engine.ts";

const execPromise = util.promisify(child_process.exec);

const SECRET_KEY_NAMES =
  "(?:[a-zA-Z0-9_-]*?(?:api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|auth[_-]?key|client[_-]?secret|secret[_-]?key|private[_-]?key|secret|password|passwd|pwd|token|credential))";

const QUOTED_SECRET_ASSIGNMENT_RE = new RegExp(
  `((?:(['"\`])${SECRET_KEY_NAMES}\\2|\\b${SECRET_KEY_NAMES})\\s*[:=]\\s*)(['"\`])((?:\\\\.|(?!\\3)[^\\\\\\r\\n])+)\\3`,
  "gi",
);

const UNQUOTED_SECRET_ASSIGNMENT_RE = new RegExp(
  `((?:(['"\`])${SECRET_KEY_NAMES}\\2|\\b${SECRET_KEY_NAMES})\\s*[:=]\\s*)([^\\s'"\`,;)}\\]]{6,})`,
  "gi",
);

const STORAGE_SECRET_RE =
  /(\bsetItem\s*\(\s*['"](?:token|jwt|access_token|refresh_token|auth|secret)['"]\s*,\s*)(['"`])([^'"`]+)\2/gi;

const STANDALONE_SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|$)/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_\-]{16,}\b/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9\-]{10,}\b/g,
  /\bAIza[0-9A-Za-z\-_]{20,}\b/g,
  /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g,
];

/**
 * Redacta secretos literales en snippets de auditoría OWASP conservando
 * el contexto de la línea y los diagnósticos de la regla.
 */
export function redactOwaspSnippet(snippet: string, ruleId?: string): string {
  if (!snippet) return "";

  let redacted = snippet;

  // 1. Credenciales embebidas en URLs (protocol://user:pass@host)
  redacted = redacted.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:@\s/]+):([^@\s/]+)@/g,
    "$1$2:[REDACTED]@",
  );

  // 2. Tokens Bearer / Basic
  redacted = redacted.replace(
    /(\b(?:Bearer|Basic)\s+)([A-Za-z0-9_\-\.\/+=]{8,})/gi,
    "$1[REDACTED]",
  );

  // 3. Asignaciones entre comillas a claves sensibles
  redacted = redacted.replace(
    QUOTED_SECRET_ASSIGNMENT_RE,
    (_match, prefix: string, _keyQuote: string | undefined, quote: string) =>
      `${prefix}${quote}[REDACTED]${quote}`,
  );

  // 4. localStorage/sessionStorage setItem con literales sensibles
  redacted = redacted.replace(
    STORAGE_SECRET_RE,
    (_match, prefix: string, quote: string) => `${prefix}${quote}[REDACTED]${quote}`,
  );

  // 5. Asignaciones sin comillas a claves sensibles
  redacted = redacted.replace(
    UNQUOTED_SECRET_ASSIGNMENT_RE,
    (match, prefix: string, _keyQuote: string | undefined, value: string) =>
      value === "[REDACTED]" ? match : `${prefix}[REDACTED]`,
  );

  // 6. Patrones conocidos de tokens / claves privadas
  for (const pattern of STANDALONE_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }

  // 7. Defensa en profundidad para la regla OWASP-SECRETS-01
  if (ruleId === "OWASP-SECRETS-01" && redacted === snippet) {
    const fallback = redacted.replace(/(['"`])([^'"`]{6,})\1/g, "$1[REDACTED]$1");
    redacted = fallback === snippet ? "[REDACTED]" : fallback;
  }

  return redacted;
}

/**
 * Resuelve y confina estrictamente la ruta de un archivo a auditar dentro del workspace.
 */
export function resolveAuditFilePath(rawPath: string, cwd: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new Error("Ruta de archivo vacía para dc_owasp_audit");
  }

  const expandedPath = trimmed === "~"
    ? os.homedir()
    : trimmed.startsWith("~/") || trimmed.startsWith(`~${path.sep}`)
      ? path.join(os.homedir(), trimmed.slice(2))
      : trimmed;

  const resolvedCwd = path.resolve(cwd);
  const candidatePath = path.isAbsolute(expandedPath)
    ? expandedPath
    : path.resolve(resolvedCwd, expandedPath);

  return assertPathWithinRoots(
    candidatePath,
    [resolvedCwd],
    "ruta de archivo para dc_owasp_audit",
  );
}

export function registerDcOwaspTools(pi: ExtensionAPI, client: DcOwaspClient = new DcOwaspClient()): void {
  // 1. dc_owasp_query
  pi.registerTool({
    name: "dc_owasp_query",
    label: "DC OWASP Query",
    description: "Consulta directivas de seguridad oficiales de OWASP Cheat Sheets. Úsala para obtener defensas primarias, requisitos normativos y ejemplos de código seguro para temas como Autenticación, JWT, Cookies, CORS, SQL Injection, XSS, etc.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Tema o vulnerabilidad a consultar (ej: 'sql injection', 'jwt', 'cookie security', 'cors', 'auth').",
        },
        sheetId: {
          type: "string",
          description: "ID o nombre de archivo de la hoja si se conoce (ej: 'auth', 'sql-injection', 'Authentication_Cheat_Sheet.md').",
        },
        maxChars: {
          type: "number",
          description: "Límite de caracteres en la respuesta para proteger el context window (default: 3500).",
        },
      },
      required: ["topic"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const topic = params.topic || "";
        const maxChars = params.maxChars || 3500;

        // Si se indicó sheetId directamente o se busca por tema
        let sheetContent = null;
        if (params.sheetId) {
          sheetContent = await client.getSheetMarkdown(params.sheetId);
        }

        if (!sheetContent) {
          const results = await client.search(topic, 5);
          if (results.length === 0) {
            return {
              content: [{
                type: "text",
                text: `No se encontraron OWASP Cheat Sheets para el tema "${topic}". Intenta con términos generales como 'auth', 'session', 'cors', 'crypto', 'sql injection'.`,
              }],
              details: { results: [] },
            };
          }

          // Tomar el mejor resultado
          const best = results[0];
          sheetContent = await client.getSheetMarkdown(best.location);

          if (!sheetContent) {
            // Retornar lista de resultados sugeridos
            const suggestions = results.map((r) => `- [${r.title}](${r.location}) (${r.category})`).join("\n");
            return {
              content: [{
                type: "text",
                text: `Se encontraron estas hojas relacionadas para "${topic}":\n\n${suggestions}`,
              }],
              details: { results },
            };
          }
        }

        // Truncar contenido para no sobrecargar el prompt
        let md = sheetContent.markdown;
        let truncated = false;
        if (md.length > maxChars) {
          md = md.slice(0, maxChars) + "\n\n... [Contenido truncado para proteger contexto. Consulta la hoja completa en " + sheetContent.url + "]";
          truncated = true;
        }

        return {
          content: [{
            type: "text",
            text: `### OWASP Cheat Sheet: ${sheetContent.title}\n**URL Oficial:** ${sheetContent.url}\n\n${md}`,
          }],
          details: {
            title: sheetContent.title,
            url: sheetContent.url,
            truncated,
            filename: sheetContent.filename,
          },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_owasp_query: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 2. dc_owasp_audit
  pi.registerTool({
    name: "dc_owasp_audit",
    label: "DC OWASP Security Audit",
    description: "Audita código fuente o un git diff contra vectores de ataque y estándares canónicos de OWASP (Inyección SQL, XSS, TLS inseguro, Cookies débiles, Secretos expuestos, CORS permisivo). Si no se pasa contenido ni ruta, audita automáticamente el 'git diff' actual del proyecto.",
    parameters: {
      type: "object",
      properties: {
        diff: {
          type: "string",
          description: "Contenido del diff o código a auditar directamente.",
        },
        path: {
          type: "string",
          description: "Ruta de un archivo en el repositorio para auditar.",
        },
        gitDiff: {
          type: "boolean",
          description: "Si es true (o por defecto si no se pasa diff), ejecuta 'git diff HEAD' en el proyecto actual y audita los cambios no comiteados.",
        },
      },
    } as any,
    async execute(_id, params: any, _signal?: any, _onUpdate?: any, ctx?: any): Promise<any> {
      try {
        const cwd = path.resolve(ctx?.cwd ?? process.cwd());
        let textToAudit = params.diff;

        // Si se especificó un archivo, confinar estrictamente al workspace
        if (!textToAudit && params.path) {
          const confinedPath = resolveAuditFilePath(String(params.path), cwd);
          if (fs.existsSync(confinedPath)) {
            textToAudit = fs.readFileSync(confinedPath, "utf-8");
          } else {
            return {
              content: [{ type: "text", text: `Archivo no encontrado: ${params.path}` }],
              isError: true,
            };
          }
        }

        // Si no se pasó nada, intentar correr git diff
        if (!textToAudit) {
          try {
            const { stdout } = await execPromise("git diff HEAD", {
              cwd,
              maxBuffer: 10 * 1024 * 1024,
            });
            textToAudit = stdout;
          } catch {
            try {
              const { stdout } = await execPromise("git diff", {
                cwd,
                maxBuffer: 10 * 1024 * 1024,
              });
              textToAudit = stdout;
            } catch {
              textToAudit = "";
            }
          }
        }

        if (!textToAudit || textToAudit.trim().length === 0) {
          return {
            content: [{
              type: "text",
              text: "No se encontraron cambios en 'git diff' ni contenido provisto para auditar. El repositorio está limpio.",
            }],
            details: { totalFindings: 0 },
          };
        }

        const rawReport = auditDiff(textToAudit);
        const report = {
          ...rawReport,
          findings: rawReport.findings.map((f) => ({
            ...f,
            snippet: f.snippet ? redactOwaspSnippet(f.snippet, f.ruleId) : f.snippet,
          })),
        };

        if (report.totalFindings === 0) {
          return {
            content: [{
              type: "text",
              text: `✅ **Auditoría OWASP completada:** No se detectaron vectores de riesgo conocidos en los cambios evaluados.`,
            }],
            details: report,
          };
        }

        // Formatear hallazgos con severidades
        const lines: string[] = [
          `⚠️ **Auditoría de Seguridad OWASP:** Se detectaron ${report.totalFindings} hallazgo(s) de riesgo.`,
          `Severidades: 🔴 Alta: ${report.high} | 🟡 Media: ${report.medium} | 🔵 Baja/Info: ${report.low + report.info}`,
          "",
        ];

        report.findings.forEach((f, idx) => {
          const icon = f.severity === "high" ? "🔴" : f.severity === "medium" ? "🟡" : "🔵";
          lines.push(`#### ${icon} [${idx + 1}] ${f.category} (${f.ruleId})`);
          if (f.file) lines.push(`- **Archivo:** \`${f.file}\`${f.line ? ` (línea ${f.line})` : ""}`);
          if (f.snippet) lines.push(`- **Snippet:** \`${f.snippet}\``);
          lines.push(`- **Problema:** ${f.message}`);
          lines.push(`- **Remediación:** ${f.remediation}`);
          lines.push(`- **Guía OWASP:** [${f.cheatsheet}](${f.cheatsheetUrl})`);
          lines.push("");
        });

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: report,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_owasp_audit: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });
}
