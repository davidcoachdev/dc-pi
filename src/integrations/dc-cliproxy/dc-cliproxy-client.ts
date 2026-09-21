import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchJson, type FetchJsonOptions } from "../dc-http/dc-fetch.ts";

export const DEFAULT_CLIPROXY_URL = "http://127.0.0.1:8317";
export const DEFAULT_MGMT_KEY_FILE = path.join(os.homedir(), ".config/cliproxy/mgmt-key");

export interface AuthFileSummary {
  name?: string;
  email?: string;
  [key: string]: unknown;
}

export interface AuthFilesResponse {
  files?: AuthFileSummary[];
}

export interface CliProxyClientOptions {
  baseUrl?: string;
  managementKey?: string;
  mgmtKeyFile?: string;
  timeoutMs?: number;
}

export class CliProxyClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private explicitKey?: string;
  private readonly mgmtKeyFile: string;

  constructor(options: CliProxyClientOptions = {}) {
    const rawUrl = options.baseUrl ?? process.env.CLIPROXY_BASE_URL ?? DEFAULT_CLIPROXY_URL;
    this.baseUrl = rawUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.explicitKey = options.managementKey;
    this.mgmtKeyFile = options.mgmtKeyFile ?? DEFAULT_MGMT_KEY_FILE;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getManagementKey(): string | null {
    if (this.explicitKey) {
      return this.explicitKey;
    }
    // Check environment variable first
    const envKey = process.env.CLIPROXY_MGMT_KEY?.trim();
    if (envKey) {
      return envKey;
    }
    // Optional fallback to local config file
    try {
      if (fs.existsSync(this.mgmtKeyFile)) {
        const fileContent = fs.readFileSync(this.mgmtKeyFile, "utf8").trim();
        if (fileContent) {
          return fileContent;
        }
      }
    } catch {
      // Safe fallback if file cannot be read
    }
    return null;
  }

  hasManagementKey(): boolean {
    return this.getManagementKey() !== null;
  }

  private authHeaders(): Record<string, string> {
    const key = this.getManagementKey();
    if (!key) {
      return {};
    }
    return {
      Authorization: `Bearer ${key}`,
    };
  }

  async getManagement<T>(endpointPath: string, options: FetchJsonOptions = {}): Promise<T> {
    const cleanPath = endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`;
    const url = `${this.baseUrl}/v0/management${cleanPath}`;
    return fetchJson<T>(url, {
      ...options,
      headers: {
        ...this.authHeaders(),
        ...options.headers,
      },
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
    });
  }

  async postManagementApiCall<T>(
    body: Record<string, unknown>,
    options: FetchJsonOptions = {},
  ): Promise<T> {
    return fetchJson<T>(`${this.baseUrl}/v0/management/api-call`, {
      ...options,
      method: "POST",
      body,
      headers: {
        ...this.authHeaders(),
        ...options.headers,
      },
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
    });
  }

  /** Retrieve auth files list from CLIProxy management API. */
  async getAuthFiles(): Promise<AuthFilesResponse> {
    return this.getManagement<AuthFilesResponse>("/auth-files");
  }

  /** Download auth file metadata (to extract account email / prefix mapping). */
  async downloadAuthFile<T = unknown>(fileName: string): Promise<T> {
    const query = encodeURIComponent(fileName);
    return this.getManagement<T>(`/auth-files/download?name=${query}`);
  }

  /** Build account prefix-to-email dictionary across all auth files. */
  async fetchPrefixEmails(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!this.hasManagementKey()) {
      return out;
    }

    try {
      const data = await this.getAuthFiles();
      const files = data.files ?? [];

      await Promise.all(
        files.map(async (f) => {
          if (!f.name) return;
          try {
            const body = await this.downloadAuthFile<{ prefix?: string }>(f.name);
            if (body.prefix && f.email) {
              out.set(body.prefix.toLowerCase(), f.email);
            }
          } catch {
            // One failed file does not abort other accounts
          }
        }),
      );
    } catch {
      // Management unavailable returns empty map
    }

    return out;
  }
}

export const cliProxyClient = new CliProxyClient();
