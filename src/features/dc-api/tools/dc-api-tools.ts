import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { executeRestRequest } from "../core/dc-api-client.ts";
import { discoverSwaggerEndpoints } from "../core/dc-api-swagger.ts";
import { executeGraphQLQuery } from "../core/dc-api-graphql.ts";
import type { HttpMethod } from "../core/dc-api-types.ts";

export function registerDcApiTools(pi: ExtensionAPI): void {
  // 1. Tool REST Request
  pi.registerTool({
    name: "dc_api_rest",
    label: "DC API REST Request",
    description: "Ejecuta peticiones HTTP REST (GET, POST, PUT, DELETE, PATCH) contra APIs locales o remotas, con soporte de cabeceras, JSON y límite seguro de respuesta.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL completa del endpoint (ej: http://localhost:3000/api/users)" },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
          description: "Método HTTP (default: GET)",
        },
        headers: {
          type: "object",
          description: "Cabeceras HTTP opcionales (ej: { 'Authorization': 'Bearer ...' })",
        },
        body: {
          description: "Cuerpo de la petición para POST/PUT/PATCH (puede ser objeto JSON o string)",
        },
        timeoutMs: { type: "number", description: "Timeout en milisegundos (default: 30000)" },
      },
      required: ["url"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const res = await executeRestRequest({
          url: params.url,
          method: (params.method as HttpMethod) ?? "GET",
          headers: params.headers,
          body: params.body,
          timeoutMs: params.timeoutMs,
        });

        const statusLabel = res.status >= 200 && res.status < 300 ? "SUCCESS" : "STATUS";
        const warn = res.truncated ? `\n\n⚠️ Respuesta truncada a 100KB para proteger la ventana de contexto.` : "";

        return {
          content: [{
            type: "text",
            text: `[${statusLabel} ${res.status} ${res.statusText}] en ${res.durationMs}ms (${res.byteSize} bytes):\n\n\`\`\`${res.isJson ? "json" : ""}\n${res.body}\n\`\`\`${warn}`,
          }],
          details: res,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_api_rest: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 2. Tool Swagger / OpenAPI Discovery
  pi.registerTool({
    name: "dc_api_swagger",
    label: "DC API Swagger / OpenAPI Discovery",
    description: "Inspecciona y descubre los endpoints disponibles, métodos y parámetros desde una URL de especificación Swagger / OpenAPI (ej: /swagger.json o /api-docs).",
    parameters: {
      type: "object",
      properties: {
        specUrl: { type: "string", description: "URL de la especificación JSON de OpenAPI/Swagger" },
        timeoutMs: { type: "number", description: "Timeout opcional en ms (default: 15000)" },
      },
      required: ["specUrl"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const result = await discoverSwaggerEndpoints(params.specUrl, params.timeoutMs);

        const endpointsFormatted = result.endpoints.map((ep, i) =>
          `[${i + 1}] \`${ep.method.padEnd(6)}\` ${ep.path}${ep.summary ? ` — ${ep.summary}` : ""}${ep.operationId ? ` (\`operationId: ${ep.operationId}\`)` : ""}`
        ).join("\n");

        return {
          content: [{
            type: "text",
            text: `### ${result.title} (v${result.version})\n${result.description ? `${result.description}\n` : ""}${result.baseUrl ? `Base URL: \`${result.baseUrl}\`\n` : ""}\nTotal de endpoints: ${result.totalEndpoints}\n\n${endpointsFormatted}\n\n*Usa dc_api_rest para probar cualquiera de estos endpoints.*`,
          }],
          details: result,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error al inspeccionar Swagger: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });

  // 3. Tool GraphQL
  pi.registerTool({
    name: "dc_api_graphql",
    label: "DC API GraphQL Query",
    description: "Ejecuta consultas (queries) y mutaciones GraphQL contra un endpoint de GraphQL, con variables y cabeceras de autorización.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL del endpoint GraphQL (ej: https://api.example.com/graphql)" },
        query: { type: "string", description: "Documento de consulta o mutación GraphQL" },
        variables: { type: "object", description: "Variables de la consulta (objeto JSON opcional)" },
        headers: { type: "object", description: "Cabeceras HTTP opcionales (ej: { 'Authorization': 'Bearer ...' })" },
        operationName: { type: "string", description: "Nombre de la operación opcional" },
      },
      required: ["url", "query"],
    } as any,
    async execute(_id, params: any): Promise<any> {
      try {
        const res = await executeGraphQLQuery({
          url: params.url,
          query: params.query,
          variables: params.variables,
          headers: params.headers,
          operationName: params.operationName,
        });

        const formatted = JSON.stringify(res.data ?? res, null, 2);
        const errs = res.errors ? `\n\nErrores reportados por GraphQL:\n${JSON.stringify(res.errors, null, 2)}` : "";

        return {
          content: [{
            type: "text",
            text: `Respuesta GraphQL en ${res.durationMs}ms:\n\n\`\`\`json\n${formatted}\n\`\`\`${errs}`,
          }],
          details: res,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error en dc_api_graphql: ${err.message}` }],
          details: { error: err.message },
          isError: true,
        };
      }
    },
  });
}
