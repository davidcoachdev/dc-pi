import type { SwaggerDiscoveryResult, SwaggerEndpointInfo } from "./dc-api-types.ts";
import { executeRestRequest } from "./dc-api-client.ts";

/**
 * Descarga y parsea una especificación Swagger / OpenAPI desde una URL.
 */
export async function discoverSwaggerEndpoints(specUrl: string, timeoutMs = 15000): Promise<SwaggerDiscoveryResult> {
  const res = await executeRestRequest({
    url: specUrl,
    method: "GET",
    timeoutMs,
  });

  if (res.status >= 400) {
    throw new Error(`HTTP ${res.status} al descargar Swagger spec: ${res.statusText}`);
  }

  let spec: any;
  try {
    spec = JSON.parse(res.body);
  } catch (err) {
    throw new Error(`El contenido retornado por ${specUrl} no es un JSON válido de Swagger/OpenAPI`);
  }

  const title = spec.info?.title ?? "API Specification";
  const version = spec.info?.version ?? "1.0.0";
  const description = spec.info?.description;

  // Determinar baseUrl
  let baseUrl: string | undefined = undefined;
  if (Array.isArray(spec.servers) && spec.servers[0]?.url) {
    baseUrl = spec.servers[0].url;
  } else if (spec.host) {
    const scheme = spec.schemes?.[0] ?? "https";
    const basePath = spec.basePath ?? "";
    baseUrl = `${scheme}://${spec.host}${basePath}`;
  }

  const endpoints: SwaggerEndpointInfo[] = [];
  const paths = spec.paths ?? {};

  for (const [pathKey, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;

    const methods = ["get", "post", "put", "delete", "patch", "head", "options"];
    for (const method of methods) {
      const operation = (pathItem as any)[method];
      if (operation && typeof operation === "object") {
        const paramsCount = (Array.isArray(operation.parameters) ? operation.parameters.length : 0) +
          (operation.requestBody ? 1 : 0);

        endpoints.push({
          path: pathKey,
          method: method.toUpperCase(),
          operationId: operation.operationId,
          summary: operation.summary,
          description: operation.description,
          tags: Array.isArray(operation.tags) ? operation.tags : undefined,
          parametersCount: paramsCount,
        });
      }
    }
  }

  return {
    title,
    version,
    description,
    baseUrl,
    totalEndpoints: endpoints.length,
    endpoints,
  };
}
