import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal } from "../../ui/dc-modal.ts";
import { cliProxyClient } from "../../integrations/dc-cliproxy/dc-cliproxy-client.ts";
import { fetchJson } from "../../integrations/dc-http/dc-fetch.ts";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { DcQuotaPanel } from "./dc-quota-panel.ts";
import {
  type QuotaRow,
  type QuotaSection,
  normalizeCliProxyName,
} from "./dc-quota-types.ts";

export const ZEN_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
export const ZEN_API_USAGE_URL = "https://opencode.ai/api/usage";
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/**
 * Lee la clave de OpenCode Go / Zen desde ~/.pi/agent/auth.json.
 */
export function readPiAuthKey(authPath?: string): string | null {
  try {
    const filePath = authPath || path.join(os.homedir(), ".pi/agent/auth.json");
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    const auth = JSON.parse(raw) as Record<string, any>;
    return (
      auth["opencode-go"]?.key?.trim() ||
      auth["opencode"]?.key?.trim() ||
      auth["zen"]?.key?.trim() ||
      auth["opencode-go"]?.apiKey?.trim() ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Consulta la cuota o créditos de OpenCode Go (Zen).
 */
export async function fetchZenQuota(apiKey: string): Promise<QuotaSection> {
  const section: QuotaSection = { id: "zen", title: "[OpenCode Go]", rows: [] };
  try {
    let data: any = null;
    try {
      data = await fetchJson(ZEN_API_USAGE_URL, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": BROWSER_UA,
        },
        timeoutMs: 4000,
      });
    } catch {
      data = await fetchJson(ZEN_USAGE_URL, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": BROWSER_UA,
        },
        timeoutMs: 4000,
      });
    }

    if (data && (typeof data.balance === "number" || typeof data.credits === "number")) {
      const balance = data.balance ?? data.credits ?? 0;
      const limit = typeof data.limit === "number" && data.limit > 0 ? data.limit : 100;
      const pctLeft = limit > 0 ? Math.max(0, Math.min(100, Math.round((balance / limit) * 100))) : balance;
      section.rows.push({
        label: "Credits / Balance",
        pctLeft,
        resetMs: null,
      });
    }

    if (data?.usage && typeof data.usage === "object") {
      const windows: Array<[string, string]> = [
        ["rolling", "Five-hour"],
        ["weekly", "Weekly"],
        ["monthly", "Monthly"],
      ];
      for (const [key, label] of windows) {
        const w = data.usage[key];
        if (!w) continue;
        const used = Number(w.percent ?? 0);
        const resetMs = w.resetsAt ? Date.parse(w.resetsAt) - Date.now() : null;
        section.rows.push({ label, pctLeft: Math.max(0, 100 - used), resetMs });
      }
    }

    if (data?.error) {
      section.error = typeof data.error === "object" ? data.error.message : String(data.error);
    } else if (!section.rows.length) {
      section.error = "sin ventanas de uso o balance";
    }
  } catch (err: any) {
    section.error = String(err?.message ?? err).slice(0, 80);
  }
  return section;
}

function parseBody<T>(body: unknown): T | null {
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as T;
    } catch {
      return null;
    }
  }
  return body as T;
}

/** Consulta cuotas de Google Antigravity a través de CLIProxy management API. */
async function fetchAntigravityRows(
  authIndex: string,
  prefix: string,
): Promise<QuotaRow[]> {
  const urls = [
    "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
    "https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
    "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
  ];
  for (const url of urls) {
    try {
      const r = await cliProxyClient.postManagementApiCall<{ body?: unknown }>({
        authIndex,
        method: "POST",
        url,
        header: {
          Authorization: "Bearer $TOKEN$",
          "Content-Type": "application/json",
          "User-Agent": "antigravity/cli/1.0.13",
        },
        data: JSON.stringify({ project: "aicode-consumers" }),
      });
      const body = parseBody<{
        groups?: Array<{
          displayName?: string;
          buckets?: Array<{
            bucketId?: string;
            window?: string;
            remainingFraction?: number;
            resetTime?: string;
          }>;
        }>;
      }>(r?.body);

      if (!body?.groups?.length) continue;
      const rows: QuotaRow[] = [];
      for (const group of body.groups) {
        const g = group.displayName ?? "";
        for (const b of group.buckets ?? []) {
          const low = g.toLowerCase();
          const family =
            low.includes("claude") || b.bucketId?.startsWith("3p")
              ? "Claude"
              : low.includes("gemini") || b.bucketId?.startsWith("gemini")
              ? "Gemini"
              : g;
          const five = b.window === "5h";
          rows.push({
            label: normalizeCliProxyName(`${family} (${five ? "5h" : "Weekly"})`, ""),
            pctLeft: Math.max(0, Math.min(100, Math.round((b.remainingFraction ?? 1) * 1000) / 10)),
            resetMs: b.resetTime ? Date.parse(b.resetTime) - Date.now() : null,
          });
        }
      }
      void prefix;
      if (rows.length) return rows;
    } catch {
      /* probar siguiente URL */
    }
  }
  throw new Error("antigravity sin respuesta");
}

/** Consulta cuotas de OpenAI Codex / ChatGPT a través de CLIProxy management API. */
async function fetchCodexRows(
  authIndex: string,
  chatgptAccountId?: string,
): Promise<QuotaRow[]> {
  const headers: Record<string, string> = {
    Authorization: "Bearer $TOKEN$",
    "Content-Type": "application/json",
    "OpenAI-Beta": "codex-1",
    Originator: "Codex Desktop",
    "User-Agent": "codex-tui/0.149.1 (Mac OS 26.5.2; arm64)",
  };
  if (chatgptAccountId) headers["Chatgpt-Account-Id"] = chatgptAccountId;

  const r = await cliProxyClient.postManagementApiCall<{ body?: unknown }>({
    authIndex,
    method: "GET",
    url: "https://chatgpt.com/backend-api/wham/usage",
    header: headers,
  });

  const body = parseBody<{
    rate_limit?: {
      primary_window?: { used_percent?: number; reset_at?: number };
      secondary_window?: { used_percent?: number; reset_at?: number };
    };
  }>(r?.body);

  const rows: QuotaRow[] = [];
  const pw = body?.rate_limit?.primary_window;
  if (pw) {
    rows.push({
      label: "Primary (Five-hour)",
      pctLeft: Math.max(0, Math.min(100, 100 - (pw.used_percent ?? 0))),
      resetMs: pw.reset_at ? pw.reset_at * 1000 - Date.now() : null,
    });
  }
  const sw = body?.rate_limit?.secondary_window;
  if (sw) {
    rows.push({
      label: "Weekly",
      pctLeft: Math.max(0, Math.min(100, 100 - (sw.used_percent ?? 0))),
      resetMs: sw.reset_at ? sw.reset_at * 1000 - Date.now() : null,
    });
  }
  if (!rows.length) throw new Error("wham sin ventanas");
  return rows;
}

/** Consulta opcional al bridge local de cuotas :8325 */
export async function fetchBridgeQuota(prefix: string): Promise<QuotaRow[] | null> {
  try {
    const res = await fetchJson(`http://127.0.0.1:8325/quota/${encodeURIComponent(prefix)}`, {
      timeoutMs: 4000,
    });
    const d = res as {
      entries?: Array<{
        label?: string;
        name?: string;
        percentRemaining?: number;
        resetTimeIso?: string;
      }>;
    };
    if (!Array.isArray(d?.entries) || d.entries.length === 0) return null;
    return d.entries.map((e) => {
      const rawPct = e.percentRemaining ?? 0;
      const pct = rawPct > 0 && rawPct <= 1 ? rawPct * 100 : rawPct;
      const pctLeft = Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
      return {
        label: normalizeCliProxyName(e.label || e.name || "Quota", prefix),
        pctLeft,
        resetMs: e.resetTimeIso ? Date.parse(e.resetTimeIso) - Date.now() : null,
      };
    });
  } catch {
    return null;
  }
}

/** Consulta las secciones de cuentas de CLIProxy */
export async function fetchCliProxySections(): Promise<QuotaSection[]> {
  if (!cliProxyClient.hasManagementKey()) {
    return [
      {
        id: "cliproxy-no-key",
        title: "[CLIProxy]",
        rows: [],
        error: "falta la key: guardala en ~/.config/cliproxy/mgmt-key o export CLIPROXY_MGMT_KEY",
      },
    ];
  }

  let files: Array<{ name?: string; auth_index?: string; provider?: string }> = [];
  try {
    const data = await cliProxyClient.getAuthFiles();
    files = (data?.files as any) ?? [];
  } catch (e: any) {
    return [
      {
        id: "cliproxy-offline",
        title: "[CLIProxy]",
        rows: [],
        error: `no conecta al :8317 (${String(e?.message ?? e).slice(0, 70)})`,
      },
    ];
  }

  const discovered = await Promise.all(
    files.map(async (f) => {
      let prefix = "";
      let provider = (f.provider ?? "").toLowerCase();
      let chatgptAccountId: string | undefined;

      try {
        const d = await cliProxyClient.downloadAuthFile<{
          prefix?: string;
          type?: string;
          provider?: string;
          email?: string;
          id_token?: { chatgpt_account_id?: string; email?: string };
        }>(f.name ?? "");

        if (!d.prefix) {
          return {
            id: `cliproxy-${f.name ?? "?"}`,
            title: `[CLIProxy]`,
            rows: [],
            error: `sin prefix: ${f.name ?? "?"}`,
          };
        }

        prefix = d.prefix.toLowerCase();
        provider = (d.provider ?? d.type ?? provider).toLowerCase();
        chatgptAccountId = d.id_token?.chatgpt_account_id;
        const email = d.email ?? d.id_token?.email;
        const section: QuotaSection = {
          id: `cliproxy-${prefix}`,
          title: email ? `[${prefix.toUpperCase()} - ${email}]` : `[${prefix.toUpperCase()}]`,
          rows: [],
        };

        try {
          const bridgeRows = await fetchBridgeQuota(prefix);
          if (bridgeRows && bridgeRows.length > 0) {
            section.rows = bridgeRows;
          } else {
            const authIndex = f.auth_index ?? "";
            if (!authIndex) throw new Error(`sin auth_index para ${prefix}`);
            if (provider === "antigravity") {
              section.rows = await fetchAntigravityRows(authIndex, prefix);
            } else if (provider === "codex") {
              section.rows = await fetchCodexRows(authIndex, chatgptAccountId);
            } else {
              section.error = `provider '${provider || "?"}' sin lector`;
            }
          }
        } catch (e: any) {
          section.error = String(e?.message ?? e).slice(0, 80);
        }

        return section;
      } catch (e: any) {
        return {
          id: `cliproxy-${f.name ?? "?"}`,
          title: `[CLIProxy]`,
          rows: [],
          error: String(e?.message ?? e).slice(0, 80),
        };
      }
    }),
  );

  return discovered
    .filter((x) => x.rows.length || x.error)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** Fetch live quotas across OpenCode Go and CLIProxy accounts. */
export async function fetchAllQuotas(): Promise<QuotaSection[]> {
  const [zenRes, cliproxyRes] = await Promise.allSettled([
    (async () => {
      const key = readPiAuthKey();
      if (!key) {
        return {
          id: "zen",
          title: "[OpenCode Go]",
          rows: [],
          error: "sin key en auth.json",
        } as QuotaSection;
      }
      return fetchZenQuota(key);
    })(),
    fetchCliProxySections(),
  ]);

  const sections: QuotaSection[] = [];

  if (cliproxyRes.status === "fulfilled") {
    sections.push(...cliproxyRes.value);
  } else {
    sections.push({
      id: "cliproxy",
      title: "[CLIProxy]",
      rows: [],
      error: String(cliproxyRes.reason?.message ?? cliproxyRes.reason).slice(0, 90),
    });
  }

  if (zenRes.status === "fulfilled") {
    sections.push(zenRes.value);
  } else {
    sections.push({
      id: "zen",
      title: "[OpenCode Go]",
      rows: [],
      error: String(zenRes.reason?.message ?? zenRes.reason).slice(0, 90),
    });
  }

  // Ordenar: primero las que tienen cuotas válidas sin error, y luego alfabético
  return sections
    .filter((x) => x.rows.length > 0 || x.error)
    .sort((a, b) => {
      const aErr = Boolean(a.error);
      const bErr = Boolean(b.error);
      if (aErr !== bErr) return aErr ? 1 : -1;
      return a.id.localeCompare(b.id, undefined, { numeric: true });
    });
}

/**
 * Open the DC Studio Token Quota monitor in a 2-panel modal.
 */
export async function openQuotaViewer(ctx: ExtensionContext): Promise<void> {
  let panelRef: DcQuotaPanel | undefined;

  const sections = await fetchAllQuotas();

  await openDcModal<void>(ctx, {
    title: "Dc Studio - Cuotas",
    glyph: "⛩ ",
    frame: "double",
    width: "55%",
    maxHeight: "82%",
    footer: (theme) => ({
      left: `  ${theme.fg("accent", "Tab/←→")} panel   ${theme.fg("accent", "↑↓/Clic")} elegir   ${theme.fg("accent", "r")} refrescar   ${theme.fg("accent", "esc")} cerrar`,
      right: `${theme.fg("accent", "[ r Refrescar ]")}  `,
    }),
    onFooterRightClick: async () => {
      const refreshed = await fetchAllQuotas();
      panelRef?.setSections(refreshed);
      dcNotifier.notify(ctx, "Cuotas", "Cuotas actualizadas en vivo", "info");
    },
    content: (done, theme, tui) => {
      const panel = new DcQuotaPanel({
        theme,
        sections,
        onRefresh: async () => {
          const refreshed = await fetchAllQuotas();
          panel.setSections(refreshed);
          tui.requestRender();
        },
        requestRender: () => tui.requestRender(),
      });
      panelRef = panel;
      return panel;
    },
  });
}

export default function dcQuotaExtension(pi: ExtensionAPI): void {
  async function showQuota(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      dcNotifier.notify(ctx, "DC Cuotas", "dc-quota necesita TUI (no hay UI en este modo).", "error");
      return;
    }
    await openQuotaViewer(ctx);
  }

  pi.registerCommand("dc-quota", {
    description: "Monitor de cuotas de tokens, límites y tiempos de reset (CLIProxy)",
    handler: async (_args, ctx) => {
      await showQuota(ctx);
    },
  });

  try {
    pi.registerShortcut("alt+shift+q" as never, {
      description: "Monitor de cuotas de tokens (DC Studio)",
      handler: async (ctx) => {
        await showQuota(ctx);
      },
    });
  } catch {
    // Graceful fallback
  }
}
