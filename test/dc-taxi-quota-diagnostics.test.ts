import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// HOME isolation MUST be applied BEFORE any project modules are loaded.
// This prevents any real ~/.pi/agent/ or taxi logs from being polluted.
const scratchHome = path.resolve(".test-build", `scratch-home-t2-${Date.now()}-${Math.random().toString(36).slice(2)}`);
fs.mkdirSync(scratchHome, { recursive: true });
process.env.HOME = scratchHome;

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  fetchTaxiQuota,
  fetchAllTaxisQuotas,
  getCachedTaxiQuota,
  setCachedTaxiQuota,
  clearTaxiQuotaCache,
  getEffectiveQuotaPct,
  probeTaxiQuotaDiagnostic,
  DcTaxiQuotaValidationError,
  UNIT_AMBIGUITY_NOTE,
  type DcTaxiQuotaInfo,
  type DcTaxiQuotaDiagnosticResult,
} from "../src/features/dc-agents/core/dc-taxi-quota.ts";

import { DcHttpError, DcHttpTimeoutError } from "../src/integrations/dc-http/dc-fetch.ts";

after(() => {
  try {
    fs.rmSync(scratchHome, { recursive: true, force: true });
  } catch {
    /* defensive */
  }
});

beforeEach(() => {
  clearTaxiQuotaCache();
});

test("DIAGNOSTIC: probeTaxiQuotaDiagnostic returns validated quota for Gemini 5h and weekly windows", async () => {
  const mockFetcher = async () => ({
    entries: [
      { name: "gemini_5h", percentRemaining: 85, resetTimeIso: "2026-10-25T18:00:00Z" },
      { name: "gemini_weekly", percentRemaining: 92 },
    ],
  });

  const result: DcTaxiQuotaDiagnosticResult = await probeTaxiQuotaDiagnostic("ac01", {
    fetcher: mockFetcher,
  });

  assert.equal(result.isValid, true);
  assert.equal(result.account, "ac01");
  assert.equal(result.gemini5hPct, 85);
  assert.equal(result.geminiWeeklyPct, 92);
  assert.equal(result.effectivePct, 85);
  assert.equal(result.resetTimeIso, "2026-10-25T18:00:00Z");
  assert.equal(result.recognizedEntriesCount, 2);
  assert.equal(result.rawEntriesCount, 2);
  assert.equal(result.unitAmbiguityNote, UNIT_AMBIGUITY_NOTE);

  // Successfully writes to quota cache
  const cached = getCachedTaxiQuota("ac01");
  assert.ok(cached);
  assert.equal(cached.gemini5hPct, 85);
  assert.equal(cached.geminiWeeklyPct, 92);
});

test("DIAGNOSTIC: reports accurate low quota (<5%) without synthesizing healthy 100%", async () => {
  const mockFetcher = async () => ({
    entries: [
      { name: "gemini_rate_limit", percentRemaining: 3 },
      { name: "gemini_quota", percentRemaining: 40 },
    ],
  });

  const result = await probeTaxiQuotaDiagnostic("ac02", { fetcher: mockFetcher });
  assert.equal(result.isValid, true);
  assert.equal(result.gemini5hPct, 3);
  assert.equal(result.geminiWeeklyPct, 40);
  assert.equal(result.effectivePct, 3);
  assert.ok(result.effectivePct < 5, "Low quota must be accurately reflected for recharging detection");
});

test("DIAGNOSTIC: handles generic primary and secondary window aliases mapped to Gemini", async () => {
  const mockFetcher = async () => ({
    entries: [
      { name: "primary", percentRemaining: 70 },
      { name: "secondary", percentRemaining: 80 },
    ],
  });

  const result = await probeTaxiQuotaDiagnostic("ac03", { fetcher: mockFetcher });
  assert.equal(result.isValid, true);
  assert.equal(result.gemini5hPct, 70);
  assert.equal(result.geminiWeeklyPct, 80);
  assert.equal(result.effectivePct, 70);
});

test("DIAGNOSTIC: normalizes percentage units correctly and documents ambiguity in result", async () => {
  // Test fraction <= 1 vs percentage > 1 vs zero
  const mockFetcher = async () => ({
    entries: [
      { name: "primary", percentRemaining: 0.85 }, // raw <= 1 treated as fraction -> 85%
      { name: "secondary", percentRemaining: 0 },   // 0%
    ],
  });

  const result = await probeTaxiQuotaDiagnostic("ac04", { fetcher: mockFetcher });
  assert.equal(result.isValid, true);
  assert.equal(result.gemini5hPct, 85);
  assert.equal(result.geminiWeeklyPct, 0);
  assert.equal(result.effectivePct, 0);
  assert.ok(result.unitAmbiguityNote.includes("(0, 1]"));

  // Raw value of exactly 1 is normalized to 100% (the documented ambiguity)
  const mockFetcherExactOne = async () => ({
    entries: [
      { name: "primary", percentRemaining: 1 },
      { name: "secondary", percentRemaining: 1 },
    ],
  });
  const resultExactOne = await probeTaxiQuotaDiagnostic("ac04", { fetcher: mockFetcherExactOne });
  assert.equal(resultExactOne.gemini5hPct, 100);
});

test("DIAGNOSTIC: fresh probe bypasses stale cache and overwrites cache with fresh data", async () => {
  // Prime cache with stale high values
  setCachedTaxiQuota("ac05", {
    gemini5hPct: 99,
    geminiWeeklyPct: 99,
    lastChecked: Date.now(),
  });

  let fetchCount = 0;
  const mockFetcher = async () => {
    fetchCount++;
    return {
      entries: [
        { name: "gemini_5h", percentRemaining: 15 },
        { name: "gemini_weekly", percentRemaining: 20 },
      ],
    };
  };

  const result = await probeTaxiQuotaDiagnostic("ac05", { fetcher: mockFetcher });
  assert.equal(fetchCount, 1, "Must perform fresh HTTP fetch bypassing cache");
  assert.equal(result.gemini5hPct, 15, "Must return fresh probe value, not stale cache (99)");

  // Verify cache is updated
  const updatedCache = getCachedTaxiQuota("ac05");
  assert.equal(updatedCache?.gemini5hPct, 15);
});

test("DIAGNOSTIC: errors do NOT overwrite existing cached quota", async () => {
  setCachedTaxiQuota("ac06", {
    gemini5hPct: 80,
    geminiWeeklyPct: 85,
    lastChecked: Date.now(),
  });

  const mockFailingFetcher = async () => {
    throw new DcHttpError("HTTP 500 Internal Server Error", 500, "http://127.0.0.1:8325/quota/ac06");
  };

  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac06", { fetcher: mockFailingFetcher });
    },
    (err: unknown) => {
      assert.ok(err instanceof DcHttpError);
      assert.equal(err.status, 500);
      return true;
    },
  );

  // Cached quota MUST remain intact and not replaced with nulls
  const cacheAfterError = getCachedTaxiQuota("ac06");
  assert.equal(cacheAfterError?.gemini5hPct, 80);
});

test("DIAGNOSTIC: propagates HTTP, auth, network, and timeout errors without swallowing", async () => {
  // 401 Unauthorized
  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac07", {
        fetcher: async () => {
          throw new DcHttpError("HTTP 401 Unauthorized", 401, "http://127.0.0.1:8325/quota/ac07");
        },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof DcHttpError);
      assert.equal(err.status, 401);
      return true;
    },
  );

  // 403 Forbidden
  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac07", {
        fetcher: async () => {
          throw new DcHttpError("HTTP 403 Forbidden", 403, "http://127.0.0.1:8325/quota/ac07");
        },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof DcHttpError);
      assert.equal(err.status, 403);
      return true;
    },
  );

  // Network ECONNREFUSED
  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac07", {
        fetcher: async () => {
          throw new Error("connect ECONNREFUSED 127.0.0.1:8325");
        },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /ECONNREFUSED/);
      return true;
    },
  );

  // Timeout
  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac07", {
        fetcher: async () => {
          throw new DcHttpTimeoutError(400, "http://127.0.0.1:8325/quota/ac07");
        },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof DcHttpTimeoutError);
      assert.equal(err.status, 408);
      return true;
    },
  );
});

test("DIAGNOSTIC: rejects invalid payloads (null, non-object, missing entries)", async () => {
  // Null response
  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac08", { fetcher: async () => null });
    },
    DcTaxiQuotaValidationError,
  );

  // String response
  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac08", { fetcher: async () => "bad gateway" });
    },
    DcTaxiQuotaValidationError,
  );

  // Missing entries
  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac08", { fetcher: async () => ({}) });
    },
    DcTaxiQuotaValidationError,
  );

  // Non-array entries
  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac08", { fetcher: async () => ({ entries: "invalid" }) });
    },
    DcTaxiQuotaValidationError,
  );
});

test("DIAGNOSTIC: rejects empty entries array and does NOT synthesize 100%", async () => {
  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac09", { fetcher: async () => ({ entries: [] }) });
    },
    (err: unknown) => {
      assert.ok(err instanceof DcTaxiQuotaValidationError);
      assert.match((err as Error).message, /empty/i);
      return true;
    },
  );

  // Nothing written to cache
  assert.equal(getCachedTaxiQuota("ac09"), undefined);
});

test("DIAGNOSTIC: rejects non-finite percentRemaining values (NaN, Infinity, negative, missing)", async () => {
  // NaN
  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac10", {
        fetcher: async () => ({
          entries: [{ name: "gemini_5h", percentRemaining: NaN }],
        }),
      });
    },
    DcTaxiQuotaValidationError,
  );

  // Infinity
  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac10", {
        fetcher: async () => ({
          entries: [{ name: "gemini_5h", percentRemaining: Infinity }],
        }),
      });
    },
    DcTaxiQuotaValidationError,
  );

  // String percentRemaining
  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac10", {
        fetcher: async () => ({
          entries: [{ name: "gemini_5h", percentRemaining: "85" }],
        }),
      });
    },
    DcTaxiQuotaValidationError,
  );

  // Negative percentRemaining
  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac10", {
        fetcher: async () => ({
          entries: [{ name: "gemini_5h", percentRemaining: -10 }],
        }),
      });
    },
    DcTaxiQuotaValidationError,
  );
});

test("DIAGNOSTIC: rejects unrecognized payload (e.g. Scout Five-hour fixture) and NEVER synthesizes 100%", async () => {
  // Scout proposed fixture that lacks recognized 5h/rate_limit/primary or weekly/quota/secondary keywords
  const scoutPayload = {
    entries: [
      { label: "Five-hour", percentRemaining: 50 },
    ],
  };

  await assert.rejects(
    async () => {
      await probeTaxiQuotaDiagnostic("ac11", {
        fetcher: async () => scoutPayload,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof DcTaxiQuotaValidationError);
      assert.match((err as Error).message, /unrecognized/i);
      return true;
    },
  );

  // Must not have synthesized 100% into cache
  assert.equal(getCachedTaxiQuota("ac11"), undefined);
});

test("REGRESSION: existing fetchTaxiQuota preserves fallback behavior on error", async () => {
  // fetchTaxiQuota catches network errors and returns fallback info with null percentages
  const mockFailingFetcher = async () => {
    throw new DcHttpError("HTTP 502 Bad Gateway", 502, "http://127.0.0.1:8325/quota/ac12");
  };

  const result = await fetchTaxiQuota("ac12", { fetcher: mockFailingFetcher });
  assert.equal(result.account, "ac12");
  assert.equal(result.gemini5hPct, null);
  assert.equal(result.geminiWeeklyPct, null);

  // Cache is populated with the fallback info
  const cached = getCachedTaxiQuota("ac12");
  assert.equal(cached?.gemini5hPct, null);
});

test("REGRESSION: existing fetchTaxiQuota uses cache within TTL", async () => {
  setCachedTaxiQuota("ac13", {
    gemini5hPct: 88,
    geminiWeeklyPct: 90,
    lastChecked: Date.now(),
  });

  let fetchCalled = false;
  const mockFetcher = async () => {
    fetchCalled = true;
    return { entries: [] };
  };

  const result = await fetchTaxiQuota("ac13", { fetcher: mockFetcher });
  assert.equal(fetchCalled, false, "Should return cached without fetching");
  assert.equal(result.gemini5hPct, 88);
});

test("REGRESSION: fetchAllTaxisQuotas processes multiple accounts cleanly", async () => {
  setCachedTaxiQuota("ac14", { gemini5hPct: 70, geminiWeeklyPct: 80, lastChecked: Date.now() });
  setCachedTaxiQuota("ac15", { gemini5hPct: 60, geminiWeeklyPct: 75, lastChecked: Date.now() });

  const map = await fetchAllTaxisQuotas(["ac14", "ac15"]);
  assert.equal(map.get("ac14")?.gemini5hPct, 70);
  assert.equal(map.get("ac15")?.gemini5hPct, 60);
});

test("REGRESSION: getEffectiveQuotaPct resolves family correctly", () => {
  const info: DcTaxiQuotaInfo = {
    account: "ac16",
    gemini5hPct: 80,
    geminiWeeklyPct: 90,
    claude5hPct: 40,
    claudeWeeklyPct: 50,
    lastChecked: Date.now(),
  };

  assert.equal(getEffectiveQuotaPct(info, "gemini"), 80);
  assert.equal(getEffectiveQuotaPct(info, "claude"), 40);
  assert.equal(getEffectiveQuotaPct(info), 80); // Default prioritizes Gemini when claudeWeekly also present
});
