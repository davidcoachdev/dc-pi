/**
 * dc-lazyweb-client.ts — Cliente HTTP stateless para Lazyweb UI/UX & Growth Evidence.
 *
 * - Gestiona de forma transparente y segura (0600) el token gratuito en ~/.lazyweb/lazyweb_mcp_token
 *   sin ejecutar el instalador bash de terceros ni sus scripts de telemetría.
 * - Ejecuta llamadas JSON-RPC 2.0 directas contra https://www.lazyweb.com/mcp
 *   (lazyweb_search_screens, lazyweb_search_flows, lazyweb_search_experiments).
 * - Filtra campos de telemetría comercial y ofrece apertura opcional en el visor DcWindow (Kitty WSLg).
 *
 * Cumple con la Directiva 1 de DC Studio (cero dependencias de Pi / pi-tui).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

export type DcLazywebSearchMode = "screens" | "flows" | "experiments";
export type DcLazywebPlatform = "desktop" | "mobile" | "all";

export interface DcLazywebStepItem {
  step: number;
  label?: string;
  visionDescription: string;
  imageUrl?: string;
}

export interface DcLazywebNormalizedItem {
  company: string;
  category?: string;
  platform?: string;
  pageUrl?: string;
  flowName?: string;
  similarity?: number;
  visionDescription: string;
  variantDescription?: string;
  imageUrl?: string;
  variantImageUrl?: string;
  steps?: DcLazywebStepItem[];
}

export interface DcLazywebNormalizedResult {
  mode: DcLazywebSearchMode;
  count: number;
  caveat?: string;
  items: DcLazywebNormalizedItem[];
  previewedFiles?: string[];
}

export interface DcLazywebSearchParams {
  mode: DcLazywebSearchMode;
  query: string;
  platform?: DcLazywebPlatform;
  company?: string;
  limit?: number;
  openPreview?: boolean;
}

export interface DcLazywebClientOptions {
  mcpUrl?: string;
  installTokenUrl?: string;
  tokenFile?: string;
  installIdFile?: string;
  previewCacheDir?: string;
  viewerScriptPath?: string;
  fetchImpl?: typeof fetch;
  previewLauncher?: (imageUrls: string[]) => Promise<string[]>;
}

const DEFAULT_MCP_URL = "https://www.lazyweb.com/mcp";
const DEFAULT_INSTALL_TOKEN_URL = "https://www.lazyweb.com/api/mcp/install-token";

const MODE_TO_MCP_TOOL: Record<DcLazywebSearchMode, string> = {
  screens: "lazyweb_search_screens",
  flows: "lazyweb_search_flows",
  experiments: "lazyweb_search_experiments",
};

/**
 * Normaliza la carga útil cruda de Lazyweb eliminando telemetría y ruido.
 */
export function normalizeLazywebPayload(
  mode: DcLazywebSearchMode,
  rawPayload: any,
): DcLazywebNormalizedResult {
  if (!rawPayload || typeof rawPayload !== "object") {
    return { mode, count: 0, items: [] };
  }

  if (mode === "screens") {
    const rawList = Array.isArray(rawPayload.results)
      ? rawPayload.results
      : Array.isArray(rawPayload.screenshots)
        ? rawPayload.screenshots
        : [];

    const items: DcLazywebNormalizedItem[] = rawList.map((r: any) => ({
      company: String(r.companyName || r.company || "unknown"),
      category: r.category ? String(r.category) : undefined,
      platform: r.platform ? String(r.platform) : undefined,
      pageUrl: r.pageUrl || r.page_url ? String(r.pageUrl || r.page_url) : undefined,
      similarity: typeof r.similarity === "number" ? Number(r.similarity.toFixed(3)) : undefined,
      visionDescription: String(r.visionDescription || r.vision_description || ""),
      imageUrl: r.imageUrl || r.image_url ? String(r.imageUrl || r.image_url) : undefined,
    }));

    return { mode, count: items.length, items };
  }

  if (mode === "flows") {
    const rawFlows = Array.isArray(rawPayload.flows)
      ? rawPayload.flows
      : Array.isArray(rawPayload.results)
        ? rawPayload.results
        : [];

    const items: DcLazywebNormalizedItem[] = rawFlows.map((f: any) => {
      const steps: DcLazywebStepItem[] = Array.isArray(f.steps)
        ? f.steps.map((s: any, idx: number) => ({
            step: typeof s.step === "number" ? s.step : idx + 1,
            label: s.label || s.screenshotName ? String(s.label || s.screenshotName) : undefined,
            visionDescription: String(s.visionDescription || s.vision_description || ""),
            imageUrl: s.imageUrl || s.stepImageUrl || s.image_url
              ? String(s.imageUrl || s.stepImageUrl || s.image_url)
              : undefined,
          }))
        : [];

      const firstImg = steps.find((s) => s.imageUrl)?.imageUrl;
      const summaryDesc = steps
        .slice(0, 4)
        .map((s) => `Paso ${s.step}: ${s.visionDescription}`)
        .join(" | ");

      return {
        company: String(f.companyName || f.company_name || f.company || "unknown"),
        flowName: String(f.flowName || f.flow_name || "Flow"),
        visionDescription: summaryDesc || String(f.description || ""),
        imageUrl: firstImg,
        steps,
      };
    });

    return { mode, count: items.length, items };
  }

  // mode === "experiments"
  const rawExps = Array.isArray(rawPayload?.evidence?.experiments)
    ? rawPayload.evidence.experiments
    : Array.isArray(rawPayload.experiments)
      ? rawPayload.experiments
      : [];

  const caveat = typeof rawPayload.dataset_caveat === "string" ? rawPayload.dataset_caveat : undefined;

  const items: DcLazywebNormalizedItem[] = rawExps.map((e: any) => {
    const companyObj = e.company && typeof e.company === "object" ? e.company : {};
    const control = e.control && typeof e.control === "object" ? e.control : {};
    const variant = e.variant || e.treatment || e.comparison || {};

    return {
      company: String(companyObj.company_name || companyObj.name || e.company_name || "unknown"),
      category: companyObj.category ? String(companyObj.category) : undefined,
      platform: e.platform ? String(e.platform) : undefined,
      visionDescription: String(control.vision_description || control.visionDescription || e.vision_description || ""),
      variantDescription: variant.vision_description || variant.visionDescription
        ? String(variant.vision_description || variant.visionDescription)
        : undefined,
      imageUrl: control.imageUrl || control.image_url
        ? String(control.imageUrl || control.image_url)
        : undefined,
      variantImageUrl: variant.imageUrl || variant.image_url
        ? String(variant.imageUrl || variant.image_url)
        : undefined,
    };
  });

  return { mode, count: items.length, caveat, items };
}

export class DcLazywebClient {
  private readonly mcpUrl: string;
  private readonly installTokenUrl: string;
  private readonly tokenFile: string;
  private readonly installIdFile: string;
  private readonly previewCacheDir: string;
  private readonly viewerScriptPath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly customPreviewLauncher?: (imageUrls: string[]) => Promise<string[]>;

  constructor(options: DcLazywebClientOptions = {}) {
    const home = os.homedir();
    this.mcpUrl = options.mcpUrl || process.env.LAZYWEB_MCP_URL || DEFAULT_MCP_URL;
    this.installTokenUrl = options.installTokenUrl || process.env.LAZYWEB_INSTALL_TOKEN_URL || DEFAULT_INSTALL_TOKEN_URL;
    this.tokenFile = options.tokenFile || process.env.LAZYWEB_TOKEN_FILE || path.join(home, ".lazyweb", "lazyweb_mcp_token");
    this.installIdFile = options.installIdFile || path.join(home, ".lazyweb", "install_id");
    this.previewCacheDir = options.previewCacheDir || path.join(home, ".cache", "dc-lazyweb-preview");
    this.viewerScriptPath = options.viewerScriptPath || path.join(home, ".config", "herdr", "scripts", "dc-image-viewer.mjs");
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.customPreviewLauncher = options.previewLauncher;
  }

  public getStatus(): { tokenConfigured: boolean; tokenFile: string; mcpUrl: string } {
    const envToken = (process.env.LAZYWEB_MCP_TOKEN || "").trim();
    let fileToken = "";
    try {
      if (fs.existsSync(this.tokenFile)) {
        fileToken = fs.readFileSync(this.tokenFile, "utf8").trim();
      }
    } catch {
      /* ignore */
    }
    return {
      tokenConfigured: Boolean(envToken || fileToken),
      tokenFile: this.tokenFile,
      mcpUrl: this.mcpUrl,
    };
  }

  private ensureInstallId(): string {
    try {
      if (fs.existsSync(this.installIdFile)) {
        const existing = fs.readFileSync(this.installIdFile, "utf8").trim();
        if (/^[0-9a-f-]{36}$/i.test(existing)) return existing;
      }
    } catch {
      /* ignore */
    }
    const created = randomUUID();
    try {
      fs.mkdirSync(path.dirname(this.installIdFile), { recursive: true });
      fs.writeFileSync(this.installIdFile, `${created}\n`, { mode: 0o600 });
    } catch {
      /* best effort */
    }
    return created;
  }

  /**
   * Obtiene el token Bearer existente o solicita uno gratuito nuevo sin requerir login ni tarjeta.
   */
  public async ensureToken(): Promise<string> {
    const envToken = (process.env.LAZYWEB_MCP_TOKEN || "").trim();
    if (envToken) return envToken;

    try {
      if (fs.existsSync(this.tokenFile)) {
        const saved = fs.readFileSync(this.tokenFile, "utf8").trim();
        if (saved) return saved;
      }
    } catch {
      /* ignore */
    }

    const installId = this.ensureInstallId();
    const journeyId = randomUUID();

    const response = await this.fetchImpl(this.installTokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Lazyweb-Install-Id": installId,
      },
      body: JSON.stringify({
        install_channel: "curl",
        install_id: installId,
        journey_id: journeyId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Lazyweb install-token falló con HTTP ${response.status}`);
    }

    const data = (await response.json()) as any;
    const token = String(data?.token || data?.userId || "").trim();
    if (!token) {
      throw new Error("Lazyweb install-token no devolvió un token utilizable.");
    }

    try {
      fs.mkdirSync(path.dirname(this.tokenFile), { recursive: true });
      fs.writeFileSync(this.tokenFile, `${token}\n`, { mode: 0o600 });
    } catch {
      /* best effort persistence */
    }

    return token;
  }

  private parseRpcResponse(rawText: string, contentType: string): any {
    if (contentType.includes("text/event-stream")) {
      let last: any = null;
      for (const line of rawText.split(/\r?\n/)) {
        if (line.startsWith("data:")) {
          const chunk = line.slice(5).trim();
          if (chunk && chunk !== "[DONE]") {
            try {
              last = JSON.parse(chunk);
            } catch {
              /* ignore malformed chunk */
            }
          }
        }
      }
      return last;
    }
    try {
      return JSON.parse(rawText);
    } catch {
      return null;
    }
  }

  /**
   * Descarga capturas y las abre en segundo plano con el visor DcWindow de Kitty (WSLg).
   */
  public async openPreviewsInKitty(items: DcLazywebNormalizedItem[], maxPreviews: number = 3): Promise<string[]> {
    const urls: string[] = [];
    for (const item of items) {
      if (item.imageUrl && !urls.includes(item.imageUrl)) {
        urls.push(item.imageUrl);
      }
      if (urls.length >= maxPreviews) break;
    }

    if (urls.length === 0) return [];

    if (this.customPreviewLauncher) {
      return this.customPreviewLauncher(urls);
    }

    fs.mkdirSync(this.previewCacheDir, { recursive: true });
    const downloadedFiles: string[] = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const item = items[i];
      const safeCompany = String(item?.company || `ref-${i + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
        .slice(0, 24);
      const ext = url.includes(".jpeg") || url.includes(".jpg") ? ".jpg" : ".png";
      const filePath = path.join(this.previewCacheDir, `${i + 1}-${safeCompany}${ext}`);

      try {
        const res = await this.fetchImpl(url);
        if (!res.ok) continue;
        const arrayBuf = await res.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(arrayBuf));
        downloadedFiles.push(filePath);

        if (fs.existsSync(this.viewerScriptPath)) {
          const baseName = path.basename(filePath);
          const child = spawn(
            "kitty",
            [
              "--title",
              `⛩  DC Image Viewer: ${baseName}`,
              "-o",
              "remember_window_size=no",
              "-o",
              "initial_window_width=90c",
              "-o",
              "initial_window_height=30c",
              "node",
              this.viewerScriptPath,
              filePath,
            ],
            {
              env: {
                ...process.env,
                DISPLAY: process.env.DISPLAY || ":0",
                WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || "wayland-0",
              },
              detached: true,
              stdio: "ignore",
            },
          );
          child.unref();
        }
      } catch {
        /* best effort preview */
      }
    }

    return downloadedFiles;
  }

  /**
   * Ejecuta una búsqueda stateless contra el servidor MCP de Lazyweb.
   */
  public async search(params: DcLazywebSearchParams): Promise<DcLazywebNormalizedResult> {
    const mode: DcLazywebSearchMode = params.mode || "screens";
    const mcpToolName = MODE_TO_MCP_TOOL[mode];
    if (!mcpToolName) {
      throw new Error(`Modo de búsqueda Lazyweb inválido: ${String(mode)}`);
    }

    const query = String(params.query || "").trim();
    if (!query) {
      throw new Error("El parámetro 'query' es obligatorio para dc_lazyweb_search.");
    }

    const limit = Math.max(1, Math.min(15, Number(params.limit || 5)));
    const token = await this.ensureToken();

    const args: Record<string, any> = { query, limit };
    if (mode === "screens" && params.platform) {
      args.platform = params.platform;
    }
    if (mode === "flows" && params.company) {
      args.company = params.company;
    }
    if (mode === "experiments") {
      args.target_screen_description = query;
    }

    const res = await this.fetchImpl(this.mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: mcpToolName,
          arguments: args,
        },
      }),
    });

    const contentType = res.headers?.get?.("content-type") || "application/json";
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`Lazyweb MCP respondió HTTP ${res.status}: ${rawText.slice(0, 200)}`);
    }

    const rpc = this.parseRpcResponse(rawText, contentType);
    if (!rpc) {
      throw new Error("Respuesta JSON-RPC inválida desde Lazyweb MCP.");
    }
    if (rpc.error) {
      throw new Error(`Error RPC de Lazyweb: ${rpc.error.message || JSON.stringify(rpc.error)}`);
    }

    let innerPayload: any = rpc.result?.structuredContent;
    if (!innerPayload && Array.isArray(rpc.result?.content)) {
      const textItem = rpc.result.content.find((c: any) => c && c.type === "text" && typeof c.text === "string");
      if (textItem) {
        try {
          innerPayload = JSON.parse(textItem.text);
        } catch {
          innerPayload = { results: [] };
        }
      }
    }

    const normalized = normalizeLazywebPayload(mode, innerPayload || {});

    if (params.openPreview && normalized.items.length > 0) {
      normalized.previewedFiles = await this.openPreviewsInKitty(normalized.items, Math.min(limit, 3));
    }

    return normalized;
  }
}

export const dcLazywebClient = new DcLazywebClient();
