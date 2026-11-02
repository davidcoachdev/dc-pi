import { cliProxyClient, type AuthFileSummary } from "./dc-cliproxy-client.ts";

export interface AccountMetadata {
  prefix: string;
  name: string;
  email?: string;
  provider?: string;
  disabled: boolean;
  raw?: Record<string, unknown>;
}

export interface CachedQuotaEntry {
  rows: Array<{
    label: string;
    pctLeft: number;
    resetMs: number | null;
  }>;
  fetchedAt: number;
}

/**
 * Coordinador centralizado de cuentas y cuotas para CLIProxy (CPAM).
 * Provee:
 * 1. Caché compartida en memoria con TTL configurable.
 * 2. Single-flight request deduplication para evitar ráfagas concurrentes N+1.
 * 3. Búsqueda y mapeo unificado de prefijos, correos y metadatos de cuentas.
 */
export class DcAccountCoordinator {
  private accountsCache: Map<string, AccountMetadata> | null = null;
  private accountsCacheTime = 0;
  private accountsInFlight: Promise<Map<string, AccountMetadata>> | null = null;

  private quotaCache = new Map<string, CachedQuotaEntry>();
  private quotaInFlight = new Map<string, Promise<CachedQuotaEntry["rows"]>>();

  // TTL predeterminado: 45 segundos para metadatos de cuentas, 15 segundos para cuotas
  private readonly accountsTtlMs: number;
  private readonly quotaTtlMs: number;
  private readonly client: typeof cliProxyClient;

  constructor(options: { accountsTtlMs?: number; quotaTtlMs?: number; client?: typeof cliProxyClient } = {}) {
    this.accountsTtlMs = options.accountsTtlMs ?? 45_000;
    this.quotaTtlMs = options.quotaTtlMs ?? 15_000;
    this.client = options.client ?? cliProxyClient;
  }

  /**
   * Obtiene el catálogo de cuentas activas de CLIProxy deduplicando llamadas N+1.
   * Si la caché es válida, responde en 0ms sin tocar la red.
   */
  async getAccounts(forceRefresh = false): Promise<Map<string, AccountMetadata>> {
    const now = Date.now();
    if (!forceRefresh && this.accountsCache && now - this.accountsCacheTime < this.accountsTtlMs) {
      return this.accountsCache;
    }

    if (this.accountsInFlight) {
      return this.accountsInFlight;
    }

    this.accountsInFlight = (async () => {
      try {
        const out = new Map<string, AccountMetadata>();
        if (!this.client.hasManagementKey()) {
          return out;
        }

        const data = await this.client.getAuthFiles();
        const files = (data.files ?? []).filter((f: AuthFileSummary) => !f.disabled && f.status !== "disabled");

        await Promise.all(
          files.map(async (f: AuthFileSummary) => {
            if (!f.name) return;
            try {
              const body = await this.client.downloadAuthFile<Record<string, unknown>>(f.name);
              const prefix = String(body.prefix ?? "").trim().toLowerCase();
              if (!prefix) return;

              const disabled = Boolean(f.disabled || f.status === "disabled" || body.disabled);
              const email = f.email ?? (body.email as string | undefined);
              const provider = (body.provider as string | undefined) ?? (body.type as string | undefined);

              out.set(prefix, {
                prefix,
                name: f.name,
                email,
                provider,
                disabled,
                raw: body,
              });
            } catch {
              // Si falla la descarga de una cuenta específica, no bloquea las demás
            }
          }),
        );

        this.accountsCache = out;
        this.accountsCacheTime = Date.now();
        return out;
      } finally {
        this.accountsInFlight = null;
      }
    })();

    return this.accountsInFlight;
  }

  /**
   * Retorna el mapa `prefix -> email` usando la caché del coordinador.
   */
  async getPrefixEmails(forceRefresh = false): Promise<Map<string, string>> {
    const accounts = await this.getAccounts(forceRefresh);
    const emails = new Map<string, string>();
    for (const [prefix, meta] of accounts.entries()) {
      if (meta.email) {
        emails.set(prefix, meta.email);
      }
    }
    return emails;
  }

  /**
   * Invalida explícitamente todas las cachés (usado tras actualizar o recargar CPAM).
   */
  invalidateAll(): void {
    this.accountsCache = null;
    this.accountsCacheTime = 0;
    this.quotaCache.clear();
  }

  /**
   * Obtiene la cuota para un prefijo con single-flight y TTL.
   */
  async getCachedQuota(
    prefix: string,
    fetcher: () => Promise<CachedQuotaEntry["rows"]>,
    forceRefresh = false,
  ): Promise<CachedQuotaEntry["rows"]> {
    const key = prefix.toLowerCase();
    const now = Date.now();
    const cached = this.quotaCache.get(key);

    if (!forceRefresh && cached && now - cached.fetchedAt < this.quotaTtlMs) {
      return cached.rows;
    }

    const inFlight = this.quotaInFlight.get(key);
    if (inFlight) {
      return inFlight;
    }

    const task = (async () => {
      try {
        const rows = await fetcher();
        this.quotaCache.set(key, { rows, fetchedAt: Date.now() });
        return rows;
      } finally {
        this.quotaInFlight.delete(key);
      }
    })();

    this.quotaInFlight.set(key, task);
    return task;
  }
}

export const accountCoordinator = new DcAccountCoordinator();
