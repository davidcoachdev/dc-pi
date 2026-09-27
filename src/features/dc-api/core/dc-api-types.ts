export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface ApiRestRequestOptions {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface ApiRestResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  durationMs: number;
  body: string;
  byteSize: number;
  truncated: boolean;
  isJson: boolean;
}

export interface SwaggerEndpointInfo {
  path: string;
  method: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parametersCount: number;
}

export interface SwaggerDiscoveryResult {
  title: string;
  version: string;
  description?: string;
  baseUrl?: string;
  totalEndpoints: number;
  endpoints: SwaggerEndpointInfo[];
}

export interface GraphQLRequestOptions {
  url: string;
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface GraphQLResponse {
  data?: unknown;
  errors?: Array<{ message: string; locations?: unknown[]; path?: unknown[] }>;
  durationMs: number;
}
