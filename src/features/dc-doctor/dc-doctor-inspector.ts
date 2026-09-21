import { VERSION } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const LAYOUT_NODE_SYMBOL = Symbol.for("@earendil-works/pi-tui/layout-node");
export const SIDEBAR_STATE_SYMBOL = Symbol.for("gentle-pi.experimental-sidebar.state");
export const DEFAULT_DOCTOR_REPORT_FILE = path.join(os.homedir(), ".pi/agent/dc-doctor.json");
export const DEFAULT_DOCTOR_SUMMARY_FILE = "/tmp/dc-doctor.txt";

export type AnyComp = Record<string, unknown> & { render?: unknown };

/**
 * Describe un nodo de layout de forma recursiva con profundidad acotada.
 */
export function describeNode(n: unknown, depth = 0): Record<string, unknown> {
  const node = n as { type?: string; gap?: number; entries?: Array<Record<string, unknown>> } | undefined;
  if (!node || typeof node !== "object") return { type: typeof n };

  const out: Record<string, unknown> = { type: node.type };
  if (node.gap !== undefined) out.gap = node.gap;

  if (Array.isArray(node.entries)) {
    out.entries = node.entries.map((e) => ({
      basis: e?.basis,
      grow: e?.grow,
      comp: describeComp(e?.component as AnyComp, depth + 1),
    }));
  }
  return out;
}

/**
 * Describe un componente y su árbol de nodo interno si lo tiene.
 */
export function describeComp(c: AnyComp | undefined, depth: number): Record<string, unknown> {
  if (!c) return { none: true };

  const d: Record<string, unknown> = {
    render: typeof c.render === "function",
    node: typeof (c as Record<symbol, unknown>)[LAYOUT_NODE_SYMBOL] === "function",
    mouse: typeof (c as { handleMouse?: unknown }).handleMouse === "function",
  };

  const nodeFn = (c as Record<symbol, unknown>)[LAYOUT_NODE_SYMBOL] as (() => unknown) | undefined;
  if (depth < 5 && typeof nodeFn === "function") {
    try {
      d.nodeShape = describeNode(nodeFn.call(c), depth + 1);
    } catch (e) {
      d.nodeError = String(e).slice(0, 80);
    }
  } else if (depth < 5 && typeof c.render === "function") {
    try {
      const lines = (c as { render: (w: number) => string[] }).render.call(c, 50);
      d.first = (lines?.[0] ?? "")
        .replace(/\x1b\[[0-9;]*m/g, "")
        .trim()
        .slice(0, 44);
    } catch (e) {
      d.firstError = String(e).slice(0, 60);
    }
  }

  return d;
}

export interface DcDoctorProbeResult {
  at: string;
  pi: string;
  hasRoot: boolean;
  rootWrapped: boolean;
  rootNative: boolean;
  rootNode: Record<string, unknown> | null;
  rootError?: string;
  sidebarParts: string[] | null;
  sidebarActive: boolean;
  uiMethods: string[];
}

/**
 * Inspecciona el estado y estructura de layout de Pi y gentle-pi.
 */
export function probeLayout(tui: unknown, ctx: ExtensionContext): DcDoctorProbeResult {
  const host = tui as { layoutRoot?: Record<symbol, unknown>; terminal?: Record<symbol, unknown> } | undefined;
  const root = host?.layoutRoot;
  const out: DcDoctorProbeResult = {
    at: new Date().toISOString(),
    pi: VERSION,
    hasRoot: !!root,
    rootWrapped: root?.[Symbol.for("dc.sidebar.frame-wrapped")] === true,
    rootNative: typeof root?.[Symbol.for("dc.sidebar.native-node")] === "function",
    rootNode: null,
    sidebarParts: null,
    sidebarActive: false,
    uiMethods: [],
  };

  const rootFn = root?.[LAYOUT_NODE_SYMBOL] as (() => unknown) | undefined;
  try {
    out.rootNode = typeof rootFn === "function" ? describeNode(rootFn.call(root)) : null;
  } catch (e) {
    out.rootError = String(e).slice(0, 120);
  }

  const state = host?.terminal?.[SIDEBAR_STATE_SYMBOL] as { parts?: Map<string, unknown>; active?: boolean } | undefined;
  out.sidebarParts = state?.parts ? [...state.parts.keys()] : null;
  out.sidebarActive = state?.active === true;

  const ui = ctx.ui as unknown as Record<string, unknown>;
  const methods = ["getEditorComponent", "setEditorComponent", "setFooter", "setHeader", "setWidget"];
  out.uiMethods = methods.filter((m) => typeof ui?.[m] === "function");

  return out;
}

/**
 * Produce un resumen legible de una inspección.
 */
export function summarizeProbe(r: DcDoctorProbeResult): string {
  const root = r.rootNode as { type?: string; gap?: number; entries?: Array<{ comp?: { nodeShape?: { type?: string } } }> } | null;
  const entries = root?.entries?.length ?? 0;
  const childTypes = root?.entries?.map((e) => e?.comp?.nodeShape?.type ?? "?").join(", ") ?? "?";

  return [
    `Pi ${r.pi}`,
    `root: ${root?.type ?? "?"} (gap ${root?.gap ?? "?"}) con ${entries} entries: [${childTypes}]`,
    `sidebar: partes=[${r.sidebarParts?.join(", ") ?? "n/a"}] active=${r.sidebarActive}`,
    `ui: ${r.uiMethods.join(", ")}`,
  ].join("\n");
}

export interface DcDoctorOptions {
  reportFile?: string;
  summaryFile?: string;
  writeFiles?: boolean;
}

export interface DcDoctorReport {
  probe: DcDoctorProbeResult;
  changed: boolean;
  summary: string;
  message: string;
}

/**
 * Ejecuta el diagnóstico de compatibilidad de Pi, detectando variaciones de layout
 * respecto de la última ejecución guardada.
 */
export function runDoctorDiagnostic(
  tui: unknown,
  ctx: ExtensionContext,
  options?: DcDoctorOptions,
): DcDoctorReport {
  const reportFile = options?.reportFile ?? DEFAULT_DOCTOR_REPORT_FILE;
  const summaryFile = options?.summaryFile ?? DEFAULT_DOCTOR_SUMMARY_FILE;
  const shouldWrite = options?.writeFiles ?? true;

  const now = probeLayout(tui, ctx);
  let prev: Record<string, unknown> | null = null;
  try {
    if (fs.existsSync(reportFile)) {
      prev = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    }
  } catch {
    prev = null;
  }

  const nowShape = JSON.stringify(now.rootNode);
  const prevShape = prev ? JSON.stringify(prev.rootNode) : null;
  const changed = prevShape !== null && prevShape !== nowShape;

  if (shouldWrite) {
    try {
      fs.mkdirSync(path.dirname(reportFile), { recursive: true });
      fs.writeFileSync(reportFile, JSON.stringify(now, null, 1), "utf8");
    } catch {
      /* noop */
    }
  }

  const summary = summarizeProbe(now);
  if (shouldWrite) {
    try {
      fs.writeFileSync(summaryFile, summary, "utf8");
    } catch {
      /* noop */
    }
  }

  const message = changed ? `⚠️ LA ESTRUCTURA CAMBIÓ\n${summary}` : summary;

  return {
    probe: now,
    changed,
    summary,
    message,
  };
}
