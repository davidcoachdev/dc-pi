/**
 * dc-taxi-workshop.ts — Coordinador de Recuperación de Taller para la Flota de Taxis.
 *
 * Reconcilia unidades en estado 'en_taller' consultando el bridge de cuotas / diagnóstico.
 * Implementa auto-recuperación condicionada a la misma generación (workshopSince),
 * deduplicación de peticiones en vuelo (inflight), cooldown con registro de intentos reales,
 * y transición adecuada entre 'recargando' (<5%) y 'libre' (>=5%).
 *
 * Cumple con Directiva 1 (cero dependencias de Pi) y Directiva 2 (aislamiento).
 */

import * as path from "node:path";
import * as os from "node:os";
import {
  loadFleetState,
  repairTaxiFromWorkshop,
  withFleetLock,
} from "./dc-taxi-dispatcher.ts";
import {
  probeTaxiQuotaDiagnostic,
  type DcTaxiQuotaDiagnosticResult,
  type ProbeTaxiQuotaDiagnosticOptions,
  type TaxiQuotaFetcher,
} from "./dc-taxi-quota.ts";
import { fetchJson } from "../../../integrations/dc-http/dc-fetch.ts";

const DEFAULT_FLEET_STATE_PATH = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "dc-studio",
  "dc-taxis.json",
);

export type TaxiQuotaProbeFn = (
  account: string,
  options?: ProbeTaxiQuotaDiagnosticOptions,
) => Promise<DcTaxiQuotaDiagnosticResult>;

export interface TaxiWorkshopRecoveryOptions {
  fleetPath?: string;
  allowedAccounts?: string[];
  cooldownMs?: number;
  probeDiagnostic?: TaxiQuotaProbeFn;
  probeTimeoutMs?: number;
  fetcher?: TaxiQuotaFetcher;
  baseUrl?: string;
  now?: () => number;
  knownFatalAccounts?: Set<string>;
}

export interface TaxiWorkshopReconcileResult {
  inspectedCount: number;
  attemptedAccounts: string[];
  repairedAccounts: string[];
  skippedAccounts: string[];
  failedAccounts: string[];
}

export class TaxiWorkshopCoordinator {
  private disposed = false;
  private readonly inflightProbes = new Map<string, Promise<void>>();
  private readonly lastAttemptTimes = new Map<string, number>();

  constructor(private readonly options: TaxiWorkshopRecoveryOptions = {}) {}

  public isDisposed(): boolean {
    return this.disposed;
  }

  public dispose(): void {
    this.disposed = true;
    this.inflightProbes.clear();
  }

  private createGuardedFetcher(): TaxiQuotaFetcher {
    const baseFetcher = this.options.fetcher || fetchJson;
    return async (url: string, opts?: any) => {
      if (this.disposed) {
        throw new Error("TaxiWorkshopCoordinator disposed before fetch");
      }
      const res = await baseFetcher(url, opts);
      if (this.disposed) {
        throw new Error("TaxiWorkshopCoordinator disposed during fetch");
      }
      return res;
    };
  }

  public async reconcileWorkshopUnits(overrideFleetPath?: string): Promise<TaxiWorkshopReconcileResult> {
    const result: TaxiWorkshopReconcileResult = {
      inspectedCount: 0,
      attemptedAccounts: [],
      repairedAccounts: [],
      skippedAccounts: [],
      failedAccounts: [],
    };

    if (this.disposed) {
      return result;
    }

    const fleetPath = overrideFleetPath || this.options.fleetPath || DEFAULT_FLEET_STATE_PATH;
    const allowedAccounts = this.options.allowedAccounts;
    const cooldownMs = this.options.cooldownMs ?? 10_000;
    const nowFn = this.options.now ?? Date.now;
    const nowMs = nowFn();

    // 1. Snapshot consistente de unidades en taller bajo file lock
    const candidates: Array<{ account: string; workshopSince?: number }> = [];
    withFleetLock(fleetPath, () => {
      const state = loadFleetState(fleetPath, allowedAccounts);
      for (const [account, unit] of Object.entries(state.fleet)) {
        if (unit.status === "en_taller") {
          candidates.push({ account, workshopSince: unit.workshopSince });
        }
      }
    });

    result.inspectedCount = candidates.length;
    if (candidates.length === 0) {
      return result;
    }

    // 2. Filtrado por deduplicación inflight y cooldown de reintento
    const toAttempt: Array<{ account: string; workshopSince?: number }> = [];

    for (const candidate of candidates) {
      const ac = candidate.account;

      if (this.inflightProbes.has(ac)) {
        result.skippedAccounts.push(ac);
        continue;
      }

      const lastAttempt = this.lastAttemptTimes.get(ac);
      if (typeof lastAttempt === "number" && nowMs - lastAttempt < cooldownMs) {
        result.skippedAccounts.push(ac);
        continue;
      }

      toAttempt.push(candidate);
    }

    if (toAttempt.length === 0) {
      return result;
    }

    // 3. Ejecución concurrente y deduplicada de sondas diagnósticas
    const probeTasks = toAttempt.map(async ({ account, workshopSince }) => {
      result.attemptedAccounts.push(account);
      this.lastAttemptTimes.set(account, nowFn());

      let probePromise: Promise<void>;
      probePromise = (async () => {
        try {
          let diagnostic: DcTaxiQuotaDiagnosticResult;

          if (this.options.probeDiagnostic) {
            diagnostic = await this.options.probeDiagnostic(account, {
              timeoutMs: this.options.probeTimeoutMs,
              canCommit: () => !this.disposed,
            });
          } else {
            diagnostic = await probeTaxiQuotaDiagnostic(account, {
              timeoutMs: this.options.probeTimeoutMs,
              fetcher: this.createGuardedFetcher(),
              baseUrl: this.options.baseUrl,
              canCommit: () => !this.disposed,
            });
          }

          if (this.disposed) {
            return;
          }

          if (!diagnostic || !diagnostic.isValid) {
            result.failedAccounts.push(account);
            return;
          }

          // Reparación atómica condicionada a la misma generación (workshopSince)
          const repaired = repairTaxiFromWorkshop(
            account,
            fleetPath,
            allowedAccounts,
            () => diagnostic,
            { expectedWorkshopSince: workshopSince },
          );

          if (repaired) {
            result.repairedAccounts.push(account);
            if (this.options.knownFatalAccounts) {
              this.options.knownFatalAccounts.delete(account.toLowerCase());
            }
          } else {
            result.failedAccounts.push(account);
          }
        } catch {
          result.failedAccounts.push(account);
        } finally {
          this.inflightProbes.delete(account);
        }
      })();

      this.inflightProbes.set(account, probePromise);
      return probePromise;
    });

    await Promise.all(probeTasks);
    return result;
  }
}

/**
 * Función helper de integración rápida para reconciliar unidades en taller.
 */
export async function reconcileWorkshopFleet(
  options?: TaxiWorkshopRecoveryOptions,
): Promise<TaxiWorkshopReconcileResult> {
  const coordinator = new TaxiWorkshopCoordinator(options);
  return coordinator.reconcileWorkshopUnits();
}
