/**
 * dc-ptc-tools.ts — Herramienta `dc_ptc_run` expuesta a Pi para Programmatic Tool Calling.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runPtcProgram } from "../core/dc-ptc-runner.ts";

export function registerDcPtcTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "dc_ptc_run",
    label: "DC PTC Runner",
    description:
      "Programmatic Tool Calling (PTC): Ejecuta código JavaScript/TypeScript en un subproceso aislado de Node.js con bindings asíncronos nativos ('pi.fs.read()', 'pi.fs.list()', 'pi.bash()', 'pi.fs.write()'). Permite procesar, filtrar y consolidar datos de múltiples archivos en 1 solo turno de LLM sin gastar turnos intermedios ni saturar el contexto.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "Código del programa a ejecutar. Tiene acceso a 'pi.fs' y 'pi.bash' y puede retornar un valor con 'return <valor>'. Ejemplo: 'const pkg = JSON.parse(pi.fs.read(\"package.json\")); return { name: pkg.name, version: pkg.version };'",
        },
        timeoutMs: {
          type: "number",
          description: "Tiempo máximo de ejecución en milisegundos (default: 30000 = 30 segundos).",
        },
      },
      required: ["code"],
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const result = await runPtcProgram({
          code: params.code,
          cwd: ctx?.cwd ?? process.cwd(),
          timeoutMs: params.timeoutMs,
        });

        const lines: string[] = [
          `### PTC Run Outcome: ${result.success ? "✅ Exitoso (exit code 0)" : "❌ Fallido"}`,
          `⏱️ Duración: ${result.executionTimeMs} ms`,
        ];

        if (result.stdout) {
          lines.push(`\n**Stdout:**\n\`\`\`text\n${result.stdout}\n\`\`\``);
        }

        if (result.stderr) {
          lines.push(`\n**Stderr:**\n\`\`\`text\n${result.stderr}\n\`\`\``);
        }

        if (result.value !== undefined) {
          lines.push(
            `\n**Retorno del Programa:**\n\`\`\`json\n${JSON.stringify(result.value, null, 2)}\n\`\`\``,
          );
        }

        if (!result.success && result.error) {
          lines.push(`\n⚠️ **Error:** ${result.error}`);
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: result,
          isError: !result.success,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error crítico en ejecución PTC: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });
}
