import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  analyzeCodeGraphImpact,
  exploreCodeGraph,
  getCodeGraphStatus,
  inspectCodeGraphNode,
  syncCodeGraph,
} from "../core/dc-codegraph-engine.ts";

export function registerDcCodegraphTools(pi: ExtensionAPI): void {
  // 1. Tool Status
  pi.registerTool({
    name: "dc_codegraph_status",
    label: "DC CodeGraph Status",
    description: "Consulta el estado del índice de CodeGraph en el proyecto (si existe .codegraph, cantidad de símbolos y archivos indexados).",
    parameters: {
      type: "object",
      properties: {},
    } as any,
    async execute(_id, _params, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const cwd = ctx?.cwd ?? process.cwd();
        const res = await getCodeGraphStatus(cwd);
        const stateText = res.indexed
          ? `Índice CodeGraph activo en ${res.projectRoot}${res.symbolsCount ? ` (${res.symbolsCount} símbolos, ${res.filesCount ?? "?"} archivos)` : ""}`
          : `No hay índice CodeGraph en este proyecto. Podés inicializarlo con 'codegraph init' en la terminal.`;

        return {
          content: [{
            type: "text",
            text: `### Estado de CodeGraph\n${stateText}\n\n\`\`\`\n${res.rawText}\n\`\`\``,
          }],
          details: res,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error al consultar CodeGraph status: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 2. Tool Node (Inspección de símbolo o archivo)
  pi.registerTool({
    name: "dc_codegraph_node",
    label: "DC CodeGraph Node",
    description: "Inspecciona a fondo un símbolo (definición, signatura, código fuente y quién lo llama/a quién llama) o un archivo (dependientes y estructura de líneas).",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "Nombre exacto del símbolo (ej: 'openDcModal', 'DcWindow') o ruta de archivo relativo" },
      },
      required: ["target"],
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const cwd = ctx?.cwd ?? process.cwd();
        const res = await inspectCodeGraphNode(params.target, cwd);

        return {
          content: [{
            type: "text",
            text: `### Inspección de Nodo: \`${res.target}\` (${res.kind})\n\n\`\`\`\n${res.rawText}\n\`\`\``,
          }],
          details: res,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error al inspeccionar nodo CodeGraph: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 3. Tool Impact (Blast Radius)
  pi.registerTool({
    name: "dc_codegraph_impact",
    label: "DC CodeGraph Impact Analysis",
    description: "Analiza el radio de impacto / blast radius de modificar un símbolo o archivo en el proyecto, listando dependientes directos y transitivos afectados.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "Símbolo o archivo que se planea modificar" },
      },
      required: ["target"],
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const cwd = ctx?.cwd ?? process.cwd();
        const res = await analyzeCodeGraphImpact(params.target, cwd);

        return {
          content: [{
            type: "text",
            text: `### Análisis de Impacto para \`${res.target}\` (${res.totalAffectedCount} archivos/módulos detectados):\n\n\`\`\`\n${res.rawText}\n\`\`\``,
          }],
          details: res,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en análisis de impacto CodeGraph: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 4. Tool Explore
  pi.registerTool({
    name: "dc_codegraph_explore",
    label: "DC CodeGraph Explore",
    description: "Explora un área conceptual, flujo de llamadas o arquitectura en el proyecto contra el grafo de código indexado.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Pregunta o término de exploración arquitectónica en el código" },
      },
      required: ["query"],
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const cwd = ctx?.cwd ?? process.cwd();
        const res = await exploreCodeGraph(params.query, cwd);

        return {
          content: [{
            type: "text",
            text: `### Exploración de CodeGraph para: "${res.query}" (${res.byteSize} bytes):\n\n\`\`\`\n${res.output}\n\`\`\``,
          }],
          details: res,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en exploración CodeGraph: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 5. Tool Sync
  pi.registerTool({
    name: "dc_codegraph_sync",
    label: "DC CodeGraph Sync",
    description: "Actualiza e indexa incrementalmente los cambios recientes del repositorio en el índice de CodeGraph sin bloquear el sistema.",
    parameters: {
      type: "object",
      properties: {},
    } as any,
    async execute(_id, _params, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const cwd = ctx?.cwd ?? process.cwd();
        const res = await syncCodeGraph(cwd);

        return {
          content: [{
            type: "text",
            text: res.synced
              ? `CodeGraph sincronizado con éxito:\n\n\`\`\`\n${res.output}\n\`\`\``
              : `Aviso durante sincronización de CodeGraph: ${res.output}`,
          }],
          details: res,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error al sincronizar CodeGraph: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });
}
