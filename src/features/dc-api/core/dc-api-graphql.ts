import type { GraphQLRequestOptions, GraphQLResponse } from "./dc-api-types.ts";
import { executeRestRequest } from "./dc-api-client.ts";

/**
 * Ejecuta una consulta o mutación GraphQL contra un endpoint remoto.
 */
export async function executeGraphQLQuery(options: GraphQLRequestOptions): Promise<GraphQLResponse> {
  const payload = {
    query: options.query,
    variables: options.variables,
    operationName: options.operationName,
  };

  const res = await executeRestRequest({
    url: options.url,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    body: payload,
    timeoutMs: options.timeoutMs,
  });

  if (res.status >= 400 && !res.isJson) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  let parsed: any = {};
  try {
    parsed = JSON.parse(res.body);
  } catch {
    throw new Error(`Respuesta no JSON del servidor GraphQL: ${res.body.slice(0, 100)}`);
  }

  return {
    data: parsed.data,
    errors: parsed.errors,
    durationMs: res.durationMs,
  };
}
