/**
 * dc-grounding-ledger.ts — Libro mayor de evidencia para reportes de subagentes.
 *
 * Clasifica cada afirmación bajo las cuatro categorías estrictas de DC Studio y
 * audita reportes de forma determinista, sin timers ni dependencias externas.
 */

export const DC_GROUNDING_LEDGER_LIMIT = 300;

export type GroundingCategory =
  | "VERIFIED_FACT"
  | "SUPPORTED_INFERENCE"
  | "UNKNOWN"
  | "HUMAN_DECISION_REQUIRED";

export interface GroundingClaim {
  id: string;
  taskId?: string;
  category: GroundingCategory;
  claim: string;
  evidence?: string;
  timestamp: number;
}

export type GroundingAuditStatus = "VERIFIED" | "SUSPECT" | "FLAGGED";

export interface GroundingAuditResult {
  status: GroundingAuditStatus;
  totalClaims: number;
  counts: Record<GroundingCategory, number>;
  reasons: string[];
  claims: GroundingClaim[];
}

export const NO_EVIDENCE_REASON =
  "Reporte sin evidencia verificable ni comprobación de ejecución";

const TAG_PATTERNS: ReadonlyArray<readonly [GroundingCategory, RegExp]> = [
  [
    "VERIFIED_FACT",
    /^\[?\s*verified[\s_-]*fact\s*\]?\s*(?:[:\-–—]\s*)?(.*)$/i,
  ],
  [
    "SUPPORTED_INFERENCE",
    /^\[?\s*supported[\s_-]*inference\s*\]?\s*(?:[:\-–—]\s*)?(.*)$/i,
  ],
  [
    "UNKNOWN",
    /^\[?\s*unknown(?:\s*(?:\/|or)\s*unverifi(?:able|ed))?\s*\]?\s*(?:[:\-–—]\s*)?(.*)$/i,
  ],
  [
    "HUMAN_DECISION_REQUIRED",
    /^\[?\s*human[\s_-]*decision[\s_-]*required\s*\]?\s*(?:[:\-–—]\s*)?(.*)$/i,
  ],
];

const FILE_EXTENSIONS =
  "ts|tsx|js|jsx|mjs|cjs|json|md|py|go|rs|java|rb|php|css|html|yml|yaml|" +
  "sh|sql|toml|ini|txt|csv|xml|vue|svelte";

const FILE_CITATION_PATTERN =
  `(?:^|[\\s("'])` +
  `((?:(?:\\.{0,2}\\/|\\/)?(?:[\\w.@-]+\\/)+[\\w.@-]+\\.[A-Za-z0-9]{1,10})` +
  `|[\\w.@-]+\\.(?:${FILE_EXTENSIONS}))` +
  `:(\\d+)(?::\\d+)?`;

const COMPLETION_PATTERNS: readonly RegExp[] = [
  /\b(?:completed|complete|completed successfully)\b/i,
  /\b(?:passed|passing|passes|pass)\b/i,
  /\b(?:success|successful|successfully)\b/i,
  /\b(?:done|finished)\b/i,
  /\b(?:completad[oa]|finalizad[oa]|terminad[oa]|exitos[oa])\b/i,
  /✅/,
];

const PROOF_LANGUAGE_PATTERN =
  /\b(?:works?|working|funciona|verificad[oa]|confirmed|confirmad[oa]|validated|validado)\b/i;

interface DetectedClaim {
  category: GroundingCategory;
  claim: string;
  evidence?: string;
}

function emptyCounts(): Record<GroundingCategory, number> {
  return {
    VERIFIED_FACT: 0,
    SUPPORTED_INFERENCE: 0,
    UNKNOWN: 0,
    HUMAN_DECISION_REQUIRED: 0,
  };
}

function countClaims(claims: readonly GroundingClaim[]): Record<GroundingCategory, number> {
  const counts = emptyCounts();
  for (const claim of claims) {
    counts[claim.category] += 1;
  }
  return counts;
}

function normalizeReportLine(line: string): string {
  return line
    .replace(/[*_`~]/g, "")
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^(?:>\s*)+/, "")
    .replace(/^(?:[-+•]|\d+[.)])\s+/, "")
    .trim();
}

function matchCategoryTag(line: string): DetectedClaim | undefined {
  for (const [category, pattern] of TAG_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      const claim = (match[1] || "").trim() || line;
      return { category, claim };
    }
  }
  return undefined;
}

function extractFileCitations(text: string): string[] {
  const citations: string[] = [];
  const pattern = new RegExp(FILE_CITATION_PATTERN, "gi");
  for (const match of text.matchAll(pattern)) {
    citations.push(`${match[1]}:${match[2]}`);
  }
  return citations;
}

function detectEvidenceMarkers(text: string): string[] {
  const markers: string[] = [];

  if (/\bexit(?:\s+code|\s+status)?\s*[:=]?\s*0\b/i.test(text)) {
    markers.push("exit code 0");
  }

  const testPass = text.match(/\b(\d+)\s+(?:tests?\s+)?pass(?:ed|ing)?\b/i)
    || text.match(/\bpass(?:ed|ing)?\s*[:=]?\s*(\d+)\b/i);
  if (testPass) {
    markers.push(`${testPass[1]} pass`);
  }

  markers.push(...extractFileCitations(text));
  return Array.from(new Set(markers));
}

function hasCompletionClaim(reportText: string): boolean {
  return COMPLETION_PATTERNS.some((pattern) => pattern.test(reportText));
}

function parseReportClaims(reportText: string): DetectedClaim[] {
  const parsed: DetectedClaim[] = [];
  const seen = new Set<string>();

  for (const rawLine of reportText.split(/\r?\n/)) {
    const line = normalizeReportLine(rawLine);
    if (!line) continue;

    const tagged = matchCategoryTag(line);
    if (tagged) {
      const markers = detectEvidenceMarkers(line);
      const claim: DetectedClaim = {
        category: tagged.category,
        claim: tagged.claim,
        evidence: markers.length > 0 ? markers.join("; ") : undefined,
      };
      const key = `${claim.category}:${claim.claim}`;
      if (!seen.has(key)) {
        seen.add(key);
        parsed.push(claim);
      }
      continue;
    }

    const markers = detectEvidenceMarkers(line);
    if (markers.length === 0) continue;

    const claim: DetectedClaim = {
      category: "VERIFIED_FACT",
      claim: line,
      evidence: markers.join("; "),
    };
    const key = `${claim.category}:${claim.claim}`;
    if (!seen.has(key)) {
      seen.add(key);
      parsed.push(claim);
    }
  }

  return parsed;
}

function buildReportAudit(
  reportText: string,
  claims: readonly GroundingClaim[],
): GroundingAuditResult {
  const counts = countClaims(claims);
  const reasons: string[] = [];
  const executionEvidence = detectEvidenceMarkers(reportText);
  const hasExecutionEvidence = executionEvidence.length > 0;
  const claimsCompletion = hasCompletionClaim(reportText);
  const verifiedFacts = counts.VERIFIED_FACT;
  const unknownClaims = claims.filter((claim) => claim.category === "UNKNOWN");
  const unknownPresentedAsProof = unknownClaims.length > 0 && (
    claimsCompletion
    || unknownClaims.some((claim) => PROOF_LANGUAGE_PATTERN.test(claim.claim))
  );

  let status: GroundingAuditStatus;

  if (claims.length === 0 && !hasExecutionEvidence) {
    status = "FLAGGED";
    reasons.push(NO_EVIDENCE_REASON);
  } else if (unknownPresentedAsProof && verifiedFacts === 0) {
    status = "FLAGGED";
    reasons.push(NO_EVIDENCE_REASON);
    reasons.push("El reporte presenta afirmaciones UNKNOWN como prueba de éxito");
  } else if (claimsCompletion && verifiedFacts === 0 && !hasExecutionEvidence) {
    status = "FLAGGED";
    reasons.push(NO_EVIDENCE_REASON);
  } else if (unknownPresentedAsProof) {
    status = "SUSPECT";
    reasons.push("El reporte contiene afirmaciones UNKNOWN presentadas como prueba");
  } else if (verifiedFacts > 0 && hasExecutionEvidence) {
    status = "VERIFIED";
    reasons.push("El reporte incluye hechos verificados y evidencia de ejecución");
  } else if (verifiedFacts > 0) {
    status = "SUSPECT";
    reasons.push("Faltan marcadores de ejecución (exit code 0, tests o path:line)");
  } else if (unknownClaims.length > 0) {
    status = "SUSPECT";
    reasons.push("El reporte contiene afirmaciones UNKNOWN sin evidencia verificable");
  } else {
    status = "SUSPECT";
    reasons.push("El reporte no contiene hechos verificados explícitos");
  }

  return {
    status,
    totalClaims: claims.length,
    counts,
    reasons,
    claims: [...claims],
  };
}

function buildStoredAudit(claims: readonly GroundingClaim[]): GroundingAuditResult {
  const counts = countClaims(claims);
  const reasons: string[] = [];
  let status: GroundingAuditStatus;

  if (claims.length === 0) {
    status = "FLAGGED";
    reasons.push("Sin afirmaciones registradas para auditar");
  } else if (counts.UNKNOWN > 0 && counts.VERIFIED_FACT === 0) {
    status = "FLAGGED";
    reasons.push("El ledger contiene afirmaciones UNKNOWN sin hechos verificados");
  } else if (counts.VERIFIED_FACT > 0) {
    status = "VERIFIED";
    reasons.push("El ledger contiene hechos verificados");
  } else {
    status = "SUSPECT";
    reasons.push("El ledger no contiene hechos verificados");
  }

  return {
    status,
    totalClaims: claims.length,
    counts,
    reasons,
    claims: [...claims],
  };
}

/**
 * Registro in-memory acotado (FIFO) de afirmaciones y auditorías de grounding.
 */
export class GroundingLedger {
  private readonly limit: number;
  private readonly claims: GroundingClaim[] = [];
  private sequence = 0;

  constructor(limit: number = DC_GROUNDING_LEDGER_LIMIT) {
    this.limit = Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : DC_GROUNDING_LEDGER_LIMIT;
  }

  recordClaim(claim: Omit<GroundingClaim, "id" | "timestamp">): GroundingClaim {
    const timestamp = Date.now();
    this.sequence += 1;
    const entry: GroundingClaim = {
      id: `claim-${timestamp.toString(36)}-${this.sequence}`,
      taskId: claim.taskId,
      category: claim.category,
      claim: String(claim.claim ?? "").trim(),
      evidence: claim.evidence ? String(claim.evidence).trim() : undefined,
      timestamp,
    };

    this.claims.push(entry);
    while (this.claims.length > this.limit) {
      this.claims.shift();
    }
    return entry;
  }

  getClaims(taskId?: string): readonly GroundingClaim[] {
    if (taskId === undefined) {
      return this.claims.slice();
    }
    return this.claims.filter((claim) => claim.taskId === taskId);
  }

  clear(): void {
    this.claims.length = 0;
    this.sequence = 0;
  }

  auditReportGrounding(reportText: string, taskId?: string): GroundingAuditResult {
    const text = typeof reportText === "string" ? reportText : "";
    const recorded = parseReportClaims(text).map((claim) =>
      this.recordClaim({ ...claim, taskId })
    );
    return buildReportAudit(text, recorded);
  }

  auditStoredClaims(taskId?: string): GroundingAuditResult {
    return buildStoredAudit(this.getClaims(taskId));
  }
}

export const groundingLedger = new GroundingLedger();

/**
 * Audita un reporte y registra sus afirmaciones en el ledger global.
 */
export function auditReportGrounding(
  reportText: string,
  taskId?: string,
): GroundingAuditResult {
  return groundingLedger.auditReportGrounding(reportText, taskId);
}

/**
 * Resume las afirmaciones ya registradas, sin volver a parsear texto.
 */
export function auditStoredClaims(taskId?: string): GroundingAuditResult {
  return groundingLedger.auditStoredClaims(taskId);
}

export function getGroundingEntries(taskId?: string): readonly GroundingClaim[] {
  return groundingLedger.getClaims(taskId);
}

export function clearGroundingLedger(): void {
  groundingLedger.clear();
}
