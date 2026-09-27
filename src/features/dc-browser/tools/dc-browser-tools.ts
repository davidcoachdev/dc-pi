import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  capturePageScreenshot,
  getCdpStatus,
  listPageTargets,
  navigatePage,
} from "../core/dc-browser-cdp.ts";

export function registerDcBrowserTools(pi: ExtensionAPI): void {
  // 1. Status tool
  pi.registerTool({
    name: "dc_browser_status",
    label: "DC Browser CDP Status",
    description: "Comprueba si hay una instancia de Google Chrome o Chromium corriendo con el puerto de depuración CDP activo (default: http://127.0.0.1:9222).",
    parameters: {
      type: "object",
      properties: {
        cdpUrl: { type: "string", description: "URL CDP opcional (default: http://127.0.0.1:9222)" },
      },
    } as any,
    async execute(_id, params: any): Promise<any> {
      const status = await getCdpStatus(params?.cdpUrl);
      const text = status.connected
        ? `Chrome CDP activo en ${status.cdpUrl} (${status.browser ?? "Chromium"}, ${status.pageTargetCount} pestaña(s) abierta(s))`
        : `Chrome CDP no está conectado en ${status.cdpUrl}. Para activarlo en Linux: google-chrome --remote-debugging-port=9222`;

      return {
        content: [{ type: "text", text }],
        details: status,
      };
    },
  });

  // 2. Tabs list tool
  pi.registerTool({
    name: "dc_browser_tabs",
    label: "DC Browser Tabs List",
    description: "Lista las pestañas web abiertas en Chrome accesibles para navegación o captura visual.",
    parameters: {
      type: "object",
      properties: {
        cdpUrl: { type: "string", description: "URL CDP opcional (default: http://127.0.0.1:9222)" },
      },
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const tabs = await listPageTargets(params?.cdpUrl);
        if (tabs.length === 0) {
          return {
            content: [{ type: "text", text: "No se encontraron pestañas abiertas en Chrome." }],
            details: { count: 0, tabs: [] },
          };
        }

        const formatted = tabs.map((t, i) =>
          `### [${i + 1}] ${t.title || "(Sin título)"}\n- Target ID: \`${t.id}\`\n- URL: ${t.url}`
        ).join("\n\n");

        return {
          content: [{
            type: "text",
            text: `Pestañas disponibles en Chrome (${tabs.length}):\n\n${formatted}`,
          }],
          details: { count: tabs.length, tabs },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_browser_tabs: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 3. Navigate page tool
  pi.registerTool({
    name: "dc_browser_navigate",
    label: "DC Browser Navigate",
    description: "Navega una pestaña de Chrome a una URL local o remota (ej: http://localhost:3000 o https://...) y espera a que el evento loadEventFired confirme la carga completa.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL HTTP o HTTPS a navegar" },
        targetId: { type: "string", description: "ID opcional de la pestaña específica a navegar" },
        urlContains: { type: "string", description: "Filtro de búsqueda por URL para seleccionar la pestaña" },
        titleContains: { type: "string", description: "Filtro de búsqueda por título para seleccionar la pestaña" },
        cdpUrl: { type: "string", description: "URL CDP opcional" },
      },
      required: ["url"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const res = await navigatePage({
          url: params.url,
          targetId: params.targetId,
          urlContains: params.urlContains,
          titleContains: params.titleContains,
          cdpUrl: params.cdpUrl,
        });

        return {
          content: [{
            type: "text",
            text: `Pestaña navegada con éxito a ${res.url} (Target ID: ${res.targetId}, tiempo: ${res.durationMs}ms)`,
          }],
          details: res,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_browser_navigate: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 4. Capture screenshot tool
  pi.registerTool({
    name: "dc_browser_screenshot",
    label: "DC Browser Screenshot",
    description: "Captura una imagen PNG de la pestaña de Chrome seleccionada y la guarda en disco para auditoría visual y pixel-perfect inspection.",
    parameters: {
      type: "object",
      properties: {
        outputPath: { type: "string", description: "Ruta opcional donde guardar el archivo .png" },
        fullPage: { type: "boolean", description: "Capturar página completa con scroll (default: true)" },
        targetId: { type: "string", description: "ID opcional de la pestaña a capturar" },
        urlContains: { type: "string", description: "Filtro por URL para seleccionar la pestaña" },
        titleContains: { type: "string", description: "Filtro por título para seleccionar la pestaña" },
        cdpUrl: { type: "string", description: "URL CDP opcional" },
      },
    } as any,
    async execute(_id, params: any, _signal, _onUpdate, ctx): Promise<any> {
      try {
        const res = await capturePageScreenshot({
          cwd: ctx?.cwd ?? process.cwd(),
          outputPath: params?.outputPath,
          fullPage: params?.fullPage,
          targetId: params?.targetId,
          urlContains: params?.urlContains,
          titleContains: params?.titleContains,
          cdpUrl: params?.cdpUrl,
        });

        return {
          content: [{
            type: "text",
            text: `Captura PNG guardada en:\n\`${res.outputPath}\`\nDimensiones: ${res.width}x${res.height} px (${Math.round(res.outputSizeBytes / 1024)} KB)\nPestaña: "${res.title}" (${res.url})`,
          }],
          details: res,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_browser_screenshot: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });
}
