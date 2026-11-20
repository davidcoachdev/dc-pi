/**
 * dc-taxi-ledger-db.ts — Motor Soberano de Bitácora y Métricas de Taxis basado en `node:sqlite`.
 *
 * Registra de forma determinista y transaccional (WAL mode) todos los eventos, viajes,
 * costos y fallos por cuenta sin sufrir condiciones de carrera ni bloqueos.
 *
 * Cumple con la Directiva 1 de DC Studio (cero dependencias externas de Pi).
 */

import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { getDcTaxisPaths } from "../../../core/dc-paths.ts";

export interface DcTaxiEventRecord {
  account: string;
  eventType: "lease" | "release" | "workshop_enter" | "workshop_exit" | "recharge_enter" | "recharge_exit" | "quota_drop";
  reason?: string;
  passengerType?: string;
  sessionId?: string;
  model?: string;
  details?: Record<string, unknown>;
  timestamp?: number;
}

export interface DcTaxiTripInsert {
  tripId: string;
  account: string;
  passengerType: string;
  model: string;
  effort?: string;
  taskId?: string;
  agentName?: string;
  sessionId: string;
  taskLabel?: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  status: "completed" | "failed" | "cancelled" | "timeout";
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  costEstimated?: number;
  error?: string;
}

export interface DcAccountSummaryMetrics {
  account: string;
  totalTrips: number;
  completedTrips: number;
  failedTrips: number;
  timeoutTrips: number;
  cancelledTrips: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  totalTokens: number;
  totalCostEstimated: number;
  totalDurationMs: number;
  workshopEntries: number;
  lastWorkshopReason?: string;
  lastEventAt?: number;
  successRate: number;
}

export class DcTaxiLedgerDb {
  private db: DatabaseSync;
  private readonly dbPath: string;

  constructor(customPath?: string) {
    this.dbPath = customPath || getDcTaxisPaths().ledgerDb;
    const isMemory = this.dbPath === ":memory:";

    if (!isMemory) {
      const parentDir = path.dirname(this.dbPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    if (this.dbPath !== ":memory:") {
      try {
        this.db.exec("PRAGMA journal_mode = WAL;");
        this.db.exec("PRAGMA synchronous = NORMAL;");
      } catch {
        /* best-effort en entornos sin soporte WAL */
      }
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS taxi_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account TEXT NOT NULL,
        event_type TEXT NOT NULL,
        reason TEXT,
        passenger_type TEXT,
        session_id TEXT,
        model TEXT,
        details_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_taxi_events_account ON taxi_events (account, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_taxi_events_type ON taxi_events (event_type);

      CREATE TABLE IF NOT EXISTS taxi_trips (
        trip_id TEXT PRIMARY KEY,
        account TEXT NOT NULL,
        passenger_type TEXT NOT NULL,
        model TEXT NOT NULL,
        effort TEXT,
        task_id TEXT,
        agent_name TEXT,
        session_id TEXT NOT NULL,
        task_label TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        reasoning_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        cost_estimated REAL DEFAULT 0.0,
        error_message TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_taxi_trips_account ON taxi_trips (account, ended_at DESC);
      CREATE INDEX IF NOT EXISTS idx_taxi_trips_status ON taxi_trips (status);
    `);
  }

  public recordEvent(event: DcTaxiEventRecord): void {
    const ts = event.timestamp || Date.now();
    const detailsJson = event.details ? JSON.stringify(event.details) : null;
    const stmt = this.db.prepare(`
      INSERT INTO taxi_events (
        account, event_type, reason, passenger_type, session_id, model, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.account.toLowerCase(),
      event.eventType,
      event.reason || null,
      event.passengerType || null,
      event.sessionId || null,
      event.model || null,
      detailsJson,
      ts,
    );
  }

  public recordTrip(trip: DcTaxiTripInsert): void {
    const totalTokens = trip.totalTokens ??
      ((trip.inputTokens || 0) + (trip.outputTokens || 0) + (trip.reasoningTokens || 0));

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO taxi_trips (
        trip_id, account, passenger_type, model, effort, task_id, agent_name,
        session_id, task_label, started_at, ended_at, duration_ms, status,
        input_tokens, output_tokens, reasoning_tokens, total_tokens, cost_estimated,
        error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      trip.tripId,
      trip.account.toLowerCase(),
      trip.passengerType,
      trip.model,
      trip.effort || null,
      trip.taskId || null,
      trip.agentName || null,
      trip.sessionId,
      trip.taskLabel || null,
      trip.startedAt,
      trip.endedAt,
      trip.durationMs,
      trip.status,
      trip.inputTokens || 0,
      trip.outputTokens || 0,
      trip.reasoningTokens || 0,
      totalTokens,
      trip.costEstimated || 0.0,
      trip.error || null,
      trip.endedAt,
    );
  }

  public getAccountSummary(account: string): DcAccountSummaryMetrics {
    const normAc = account.toLowerCase();

    // 1. Métricas de viajes
    const tripStmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total_trips,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_trips,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_trips,
        SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) as timeout_trips,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_trips,
        SUM(input_tokens) as total_in,
        SUM(output_tokens) as total_out,
        SUM(reasoning_tokens) as total_reasoning,
        SUM(total_tokens) as total_tokens,
        SUM(cost_estimated) as total_cost,
        SUM(duration_ms) as total_duration
      FROM taxi_trips
      WHERE account = ?
    `);
    const tripRes = tripStmt.get(normAc) as any;

    // 2. Visitas a taller y último motivo
    const workshopStmt = this.db.prepare(`
      SELECT COUNT(*) as workshop_entries, reason
      FROM taxi_events
      WHERE account = ? AND event_type = 'workshop_enter'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const workshopRes = workshopStmt.get(normAc) as any;

    // 3. Último evento
    const lastEventStmt = this.db.prepare(`
      SELECT created_at
      FROM taxi_events
      WHERE account = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const lastEventRes = lastEventStmt.get(normAc) as any;

    const totalTrips = Number(tripRes?.total_trips || 0);
    const completedTrips = Number(tripRes?.completed_trips || 0);
    const failedTrips = Number(tripRes?.failed_trips || 0);
    const timeoutTrips = Number(tripRes?.timeout_trips || 0);
    const cancelledTrips = Number(tripRes?.cancelled_trips || 0);
    const successRate = totalTrips > 0 ? (completedTrips / totalTrips) * 100 : 100;

    return {
      account: normAc,
      totalTrips,
      completedTrips,
      failedTrips,
      timeoutTrips,
      cancelledTrips,
      totalInputTokens: Number(tripRes?.total_in || 0),
      totalOutputTokens: Number(tripRes?.total_out || 0),
      totalReasoningTokens: Number(tripRes?.total_reasoning || 0),
      totalTokens: Number(tripRes?.total_tokens || 0),
      totalCostEstimated: Number(tripRes?.total_cost || 0),
      totalDurationMs: Number(tripRes?.total_duration || 0),
      workshopEntries: Number(workshopRes?.workshop_entries || 0),
      lastWorkshopReason: workshopRes?.reason || undefined,
      lastEventAt: lastEventRes?.created_at || undefined,
      successRate: Math.round(successRate * 10) / 10,
    };
  }

  public getRecentAccountEvents(account: string, limit: number = 20): Array<{
    id: number;
    eventType: string;
    reason?: string;
    passengerType?: string;
    model?: string;
    createdAt: number;
    details?: any;
  }> {
    const stmt = this.db.prepare(`
      SELECT id, event_type, reason, passenger_type, model, created_at, details_json
      FROM taxi_events
      WHERE account = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(account.toLowerCase(), limit) as any[];
    return rows.map((r) => ({
      id: Number(r.id),
      eventType: r.event_type,
      reason: r.reason || undefined,
      passengerType: r.passenger_type || undefined,
      model: r.model || undefined,
      createdAt: Number(r.created_at),
      details: r.details_json ? JSON.parse(r.details_json) : undefined,
    }));
  }

  public getAllAccountsRankedByCost(limit: number = 50): Array<{
    account: string;
    totalTrips: number;
    totalCost: number;
    totalTokens: number;
    failedTrips: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT 
        account,
        COUNT(*) as total_trips,
        SUM(cost_estimated) as total_cost,
        SUM(total_tokens) as total_tokens,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_trips
      FROM taxi_trips
      GROUP BY account
      ORDER BY total_cost DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];
    return rows.map((r) => ({
      account: r.account,
      totalTrips: Number(r.total_trips || 0),
      totalCost: Number(r.total_cost || 0),
      totalTokens: Number(r.total_tokens || 0),
      failedTrips: Number(r.failed_trips || 0),
    }));
  }

  public close(): void {
    try {
      this.db.close();
    } catch {
      /* defensive */
    }
  }
}

let defaultLedgerInstance: DcTaxiLedgerDb | null = null;

export function getTaxiLedgerDb(customPath?: string): DcTaxiLedgerDb {
  if (customPath) {
    return new DcTaxiLedgerDb(customPath);
  }
  if (!defaultLedgerInstance) {
    defaultLedgerInstance = new DcTaxiLedgerDb();
  }
  return defaultLedgerInstance;
}
