import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../ui/dc-modal.ts";
import { EngramPanel } from "./dc-engram-panel.ts";
import { EngramEnrollPanel, openProjectDashboard, openUrl } from "./dc-engram-enroll-panel.ts";
import { getProjectObservations, resolveEngramProjectName } from "./dc-engram-db.ts";
import { saveCuratedSkill, synthesizeSkillDraft, type SkillDraftInput } from "./core/dc-skill-curator.ts";

export { openProjectDashboard, openUrl };

/**
 * Abre la ventana interactiva de exploración de memorias Engram.
 */
export async function openEngramExplorer(ctx: ExtensionContext, project?: string): Promise<void> {
  const currentDir = ctx.sessionManager?.getCwd?.() || process.cwd();
  const projectName = resolveEngramProjectName(project, currentDir);
  const obs = getProjectObservations(500, projectName);

  await openDcModal(ctx, {
    title: `Dc Studio - Engram Visualizador [${projectName}]`,
    glyph: "⛩ ",
    width: "90%",
    maxHeight: 40,
    scrollable: false,
    showScrollbar: false,
    footer: (theme) => ({
      left: ` ${theme.fg("accent", "↑↓/Clic")} elegir  ·  ${theme.fg("accent", "j/k o Rueda")} scroll detalle  ·  ${theme.fg("accent", "c")} copiar  ·  ${theme.fg("accent", "o")} browser  ·  ${theme.fg("accent", "Esc")} salir`,
      right: theme.fg("accent", `${obs.length} registros (${projectName})`),
    }),
    content: (_done, theme, tui) => {
      return new EngramPanel({
        theme,
        projectName,
        maxRows: 34,
        requestRender: () => tui.requestRender(),
      });
    },
  });
}

/**
 * Abre la ventana interactiva para enrolar el proyecto en Engram Cloud y sincronizar memorias.
 */
export async function openEngramEnrollModal(ctx: ExtensionContext, project?: string): Promise<void> {
  const currentDir = ctx.sessionManager?.getCwd?.() || process.cwd();
  const projectName = resolveEngramProjectName(project, currentDir);
  let panelRef: EngramEnrollPanel | undefined;

  await openDcModal(ctx, {
    title: `Dc Studio - Engram Cloud Enroll [${projectName}]`,
    glyph: "⛩ ",
    width: "44%",
    maxHeight: 20,
    footer: () => panelRef?.getFooterText() ?? " Esc: Cerrar",
    content: (done, theme, tui) => {
      const panel = new EngramEnrollPanel({
        projectName,
        theme,
        requestRender: () => tui.requestRender(),
        onDone: () => done(),
      });
      panelRef = panel;
      return panel;
    },
    onClose: () => {
      panelRef?.destroy();
    },
  });
}

export default function dcEngramExtension(pi: ExtensionAPI): void {
  // Comando canónico /dc-engram
  pi.registerCommand("dc-engram", {
    description: "Explorar memorias persistentes de Engram del proyecto (dos paneles)",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      await openEngramExplorer(ctx);
    },
  });

  // Comando canónico /dc-engram-enroll
  pi.registerCommand("dc-engram-enroll", {
    description: "Enrolar proyecto en Engram Cloud y subir/sincronizar memorias",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      await openEngramEnrollModal(ctx);
    },
  });

  // Alias /dc-enroll
  pi.registerCommand("dc-enroll", {
    description: "Enrolar proyecto actual en Engram Cloud y sincronizar",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      await openEngramEnrollModal(ctx);
    },
  });

  // Atajo canónico Alt+Shift+G
  pi.registerShortcut("alt+shift+g" as never, {
    description: "Abrir visor de memorias Engram de DC Studio (Alt+Shift+G)",
    handler: async (ctx: ExtensionContext) => {
      await openEngramExplorer(ctx);
    },
  });

  // Herramienta dc_curate_skill
  if (typeof pi.registerTool === "function") {
    pi.registerTool({
      name: "dc_curate_skill",
      label: "DC Curate Skill",
      description: "Sintetiza, valida y guarda una habilidad canónica (SKILL.md) en 'skills/<slug>/' a partir de un aprendizaje, patrón técnico o solución probada en la sesión.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Nombre descriptivo de la habilidad (ej: 'fix-memory-leak-eventemitter').",
          },
          description: {
            type: "string",
            description: "Descripción de alto nivel del propósito de la habilidad.",
          },
          triggers: {
            type: "array",
            items: { type: "string" },
            description: "Frases y palabras clave que activarán esta skill cuando el usuario las mencione.",
          },
          activationWhen: {
            type: "array",
            items: { type: "string" },
            description: "Casos específicos en los que esta habilidad debe activarse.",
          },
          activationNotWhen: {
            type: "array",
            items: { type: "string" },
            description: "Casos o escenarios donde esta habilidad NO debe utilizarse.",
          },
          hardRules: {
            type: "array",
            items: { type: "string" },
            description: "Reglas inviolables e invariantes técnicas que deben respetarse.",
          },
          decisionGates: {
            type: "array",
            items: {
              type: "object",
              properties: {
                condition: { type: "string" },
                action: { type: "string" },
              },
              required: ["condition", "action"],
            },
            description: "Tabla de condiciones y acciones recomendadas.",
          },
          steps: {
            type: "array",
            items: { type: "string" },
            description: "Pasos secuenciales de ejecución probados con éxito.",
          },
          allowOverwrite: {
            type: "boolean",
            description: "Si es true, permite sobrescribir una skill existente con el mismo nombre.",
          },
        },
        required: ["name", "description", "triggers"],
      } as any,
      async execute(_id, params: any): Promise<any> {
        try {
          const input: SkillDraftInput = {
            name: params.name,
            description: params.description,
            triggers: Array.isArray(params.triggers) ? params.triggers : [params.name],
            activationWhen: params.activationWhen,
            activationNotWhen: params.activationNotWhen,
            hardRules: params.hardRules,
            decisionGates: params.decisionGates,
            steps: params.steps,
          };

          const result = saveCuratedSkill(input, undefined, Boolean(params.allowOverwrite));
          if (!result.saved) {
            return {
              content: [{ type: "text", text: `Error al guardar skill: ${result.reason}` }],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `✨ **Skill Canónica Curada con Éxito:**\n- **Ruta:** \`${result.filePath}\`\n- **Triggers:** ${input.triggers.join(", ")}\n\nYa está lista y registrada para ser utilizada por el agente o subagentes.`,
              },
            ],
            details: { filePath: result.filePath, slug: input.name },
          };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: `Fallo inesperado al curar skill: ${err.message}` }],
            isError: true,
          };
        }
      },
    });
  }
}
