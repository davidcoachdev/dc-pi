/**
 * dc-doctor — Diagnóstico de compatibilidad del overlay DC.
 *
 * Corre DESPUÉS de un `pi update` para revisar si la estructura interna de Pi /
 * gentle-pi cambió y avisarte qué hay que adaptar. NO modifica nada.
 *
 * Uso:  /dc-doctor
 * Deja: ~/.pi/agent/dc-doctor.json   (snapshot actual de la "forma" del layout)
 *       /tmp/dc-doctor.txt           (resumen legible)
 * Y si la forma cambió vs la última corrida, avisa por Herdr.
 */

import { VERSION } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { notifyHerdr } from "./dc-notify.ts";

const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");
const STATE = Symbol.for("gentle-pi.experimental-sidebar.state");
const REPORT_FILE = path.join(os.homedir(), ".pi/agent/dc-doctor.json");

type AnyComp = Record<string, unknown> & { render?: unknown };

/** Describe un nodo de layout (recursivo, acotado en profundidad). */
function describeNode(n: unknown, depth = 0): unknown {
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

function describeComp(c: AnyComp | undefined, depth: number): unknown {
  if (!c) return { none: true };
  const d: Record<string, unknown> = {
    render: typeof c.render === "function",
    node: typeof (c as Record<symbol, unknown>)[NODE] === "function",
    mouse: typeof (c as { handleMouse?: unknown }).handleMouse === "function",
  };
  const nodeFn = (c as Record<symbol, unknown>)[NODE] as (() => unknown) | undefined;
  if (depth < 5 && typeof nodeFn === "function") {
    try {
      d.nodeShape = describeNode(nodeFn.call(c), depth + 1);
    } catch (e) {
      d.nodeError = String(e).slice(0, 80);
    }
  } else if (depth < 5 && typeof c.render === "function") {
    // Hoja: guardar la PRIMERA línea renderizada (para identificar al intruso).
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

function probe(tui: unknown, ctx: ExtensionContext): Record<string, unknown> {
  const host = tui as { layoutRoot?: Record<symbol, unknown>; terminal?: Record<symbol, unknown> } | undefined;
  const root = host?.layoutRoot;
  const out: Record<string, unknown> = { at: new Date().toISOString(), pi: VERSION, hasRoot: !!root };

  const rootFn = root?.[NODE] as (() => unknown) | undefined;
  out.rootWrapped = root?.[Symbol.for("dc.sidebar.frame-wrapped")] === true;
  out.rootNative = typeof root?.[Symbol.for("dc.sidebar.native-node")] === "function";
  try {
    out.rootNode = typeof rootFn === "function" ? describeNode(rootFn.call(root)) : null;
  } catch (e) {
    out.rootError = String(e).slice(0, 120);
  }

  const state = host?.terminal?.[STATE] as { parts?: Map<string, unknown>; active?: boolean } | undefined;
  out.sidebarParts = state?.parts ? [...state.parts.keys()] : null;
  out.sidebarActive = state?.active === true;

  const ui = ctx.ui as unknown as Record<string, unknown>;
  out.uiMethods = ["getEditorComponent", "setEditorComponent", "setFooter", "setHeader", "setWidget"].filter(
    (m) => typeof ui[m] === "function",
  );
  return out;
}

function summarize(r: Record<string, unknown>): string {
  const root = r.rootNode as { type?: string; gap?: number; entries?: Array<{ comp?: { nodeShape?: { type?: string } } }> } | null;
  const entries = root?.entries?.length ?? 0;
  const childTypes = root?.entries?.map((e) => e?.comp?.nodeShape?.type ?? "?").join(", ") ?? "?";
  return [
    `Pi ${r.pi}`,
    `root: ${root?.type ?? "?"} (gap ${root?.gap ?? "?"}) con ${entries} entries: [${childTypes}]`,
    `sidebar: partes=[${(r.sidebarParts as string[] | null)?.join(", ") ?? "n/a"}] active=${r.sidebarActive}`,
    `ui: ${(r.uiMethods as string[]).join(", ")}`,
  ].join("\n");
}

function run(ctx: ExtensionContext, tui: unknown): string {
  const now = probe(tui, ctx);
  let prev: Record<string, unknown> | null = null;
  try {
    prev = JSON.parse(fs.readFileSync(REPORT_FILE, "utf8"));
  } catch {
    prev = null;
  }
  const nowShape = JSON.stringify(now.rootNode);
  const prevShape = prev ? JSON.stringify(prev.rootNode) : null;
  const changed = prevShape !== null && prevShape !== nowShape;

  try {
    fs.writeFileSync(REPORT_FILE, JSON.stringify(now, null, 1));
  } catch {
    /* noop */
  }
  const summary = summarize(now);
  try {
    fs.writeFileSync("/tmp/dc-doctor.txt", summary);
  } catch {
    /* noop */
  }
  return changed ? `⚠️ LA ESTRUCTURA CAMBIÓ\n${summary}` : summary;
}

export default function dcDoctorExtension(pi: ExtensionAPI) {
  let tuiRef: unknown;

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    try {
      ctx.ui.setWidget("dc-doctor-anchor", (tui) => {
        tuiRef = tui;
        return { render: () => [] as string[], invalidate() {} };
      });
    } catch {
      /* noop */
    }
    // Aviso automático si la forma cambió (Capa 3).
    setTimeout(() => {
      try {
        const report = run(ctx, tuiRef);
        if (report.startsWith("⚠️")) notifyHerdr("DC UI: la estructura de gentle-pi cambió — corré /dc-doctor");
      } catch {
        /* noop */
      }
    }, 4500).unref?.();
  });

  pi.registerCommand("dc-doctor", {
    description: "Revisa si la estructura interna de Pi/gentle-pi cambió (post-update).",
    handler: async (_args: string, ctx: ExtensionContext) => {
      if (!ctx.hasUI) return;
      const report = run(ctx, tuiRef);
      ctx.ui.notify(report.replace(/\n/g, "  ·  "), report.startsWith("⚠️") ? "warning" : "info");
      notifyHerdr(report.startsWith("⚠️") ? "DC UI: estructura CAMBIÓ (ver /dc-doctor)" : "DC UI: estructura OK");
    },
  });
}
