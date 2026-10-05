/**
 * dc-owasp-tools.ts — Herramientas para el LLM:
 * - dc_owasp_query: Consulta de guías, defensas primarias y snippets de OWASP.
 * - dc_owasp_audit: Auditoría de código o git diff contra reglas canónicas de OWASP.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as child_process from "node:child_process";
import * as util from "node:util";
import { DcOwaspClient } from "../core/dc-owasp-client.ts";
import { auditDiff } from "../core/dc-owasp-diff-engine.ts";

const execPromise = util.promisify(child_process.exec);

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
    async execute(_id, params: any): Promise<any> {
      try {
        let textToAudit = params.diff;

        // Si se especificó un archivo
        if (!textToAudit && params.path) {
          const fs = await import("node:fs");
          if (fs.existsSync(params.path)) {
            textToAudit = fs.readFileSync(params.path, "utf-8");
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
            const { stdout } = await execPromise("git diff HEAD", { maxBuffer: 10 * 1024 * 1024 });
            textToAudit = stdout;
          } catch {
            try {
              const { stdout } = await execPromise("git diff", { maxBuffer: 10 * 1024 * 1024 });
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

        const report = auditDiff(textToAudit);

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
