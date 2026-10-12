import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  dcLazywebClient,
  type DcLazywebClient,
  type DcLazywebNormalizedResult,
} from "../core/dc-lazyweb-client.ts";

function formatLazywebMarkdown(result: DcLazywebNormalizedResult, query: string): string {
  if (result.items.length === 0) {
    return `No se encontraron referencias en Lazyweb (${result.mode}) para: "${query}".`;
  }

  const lines: string[] = [
    `### Referencias Reales de Lazyweb (${result.mode.toUpperCase()} — ${result.count} resultados para "${query}")`,
  ];

  if (result.caveat) {
    lines.push(`> Nota metodológica: ${result.caveat}`);
  }

  result.items.forEach((item, idx) => {
    const headerParts = [`**[${idx + 1}] ${item.company}**`];
    if (item.flowName) headerParts.push(`Flujo: *${item.flowName}*`);
    if (item.platform) headerParts.push(`(${item.platform})`);
    if (item.category) headerParts.push(`[${item.category}]`);
    if (typeof item.similarity === "number") headerParts.push(`sim: ${item.similarity}`);

    lines.push(`\n${headerParts.join(" · ")}`);
    if (item.pageUrl) lines.push(`- **URL**: ${item.pageUrl}`);
    if (item.visionDescription) lines.push(`- **Patrón Visual / UI**: ${item.visionDescription}`);
    if (item.variantDescription) lines.push(`- **Variante Comparada**: ${item.variantDescription}`);
    if (item.imageUrl) lines.push(`- **Captura**: ${item.imageUrl}`);

    if (item.steps && item.steps.length > 0) {
      lines.push(`- **Pasos del flujo (${item.steps.length})**:`);
      for (const step of item.steps.slice(0, 6)) {
        lines.push(`  - Paso ${step.step}: ${step.visionDescription}`);
      }
    }
  });

  if (result.previewedFiles && result.previewedFiles.length > 0) {
    lines.push(
      `\n🖼️ **Vista previa abierta en Kitty DcWindow**:\n` +
        result.previewedFiles.map((f) => `- \`${f}\``).join("\n"),
    );
  }

  return lines.join("\n");
}

export function registerDcLazywebTools(
  pi: ExtensionAPI,
  client: DcLazywebClient = dcLazywebClient,
): void {
  pi.registerTool({
    name: "dc_lazyweb_search",
    label: "DC Lazyweb UI/UX Search",
    description:
      "Consulta patrones reales de UI/UX en Lazyweb (+281k pantallas, flujos de onboarding/checkout y experimentos A/B de productos reales) vía HTTP JSON-RPC stateless. Opcionalmente abre las capturas en el visor DcWindow de Kitty.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["screens", "flows", "experiments"],
          description:
            "Tipo de evidencia: 'screens' (capturas de pantallas web/móvil), 'flows' (secuencias paso a paso como onboarding/checkout), 'experiments' (comparativas A/B de conversión).",
        },
        query: {
          type: "string",
          description:
            "Consulta en inglés describiendo el componente o flujo buscado (ej: 'pricing page toggle monthly annual', 'onboarding paywall', 'saas dashboard sidebar').",
        },
        platform: {
          type: "string",
          enum: ["desktop", "mobile", "all"],
          description: "Filtro de plataforma para mode='screens' (default: 'all').",
        },
        company: {
          type: "string",
          description: "Filtro opcional de empresa para mode='flows' (ej: 'stripe', 'figma', 'duolingo').",
        },
        limit: {
          type: "number",
          description: "Cantidad máxima de referencias a retornar (1 a 10, default: 5).",
        },
        openPreview: {
          type: "boolean",
          description:
            "Si es true, descarga las capturas devueltas y las abre automáticamente en el visor gráfico DcWindow de Kitty (WSLg) para inspección visual del usuario.",
        },
      },
      required: ["mode", "query"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const result = await client.search({
          mode: params.mode || "screens",
          query: params.query,
          platform: params.platform,
          company: params.company,
          limit: params.limit ?? 5,
          openPreview: Boolean(params.openPreview),
        });

        return {
          content: [
            {
              type: "text",
              text: formatLazywebMarkdown(result, params.query),
            },
          ],
          details: result,
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error en dc_lazyweb_search: ${err?.message || String(err)}`,
            },
          ],
          details: { error: err?.message || String(err) },
          isError: true,
        };
      }
    },
  });
}
