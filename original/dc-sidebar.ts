/**
 * dc-sidebar — Sidebar de gentle-pi: borde DC + mostrar/ocultar. Sin tocar gentle-pi.
 *
 * BORDE: pi-tui no tiene borde nativo en el layout (sólo vstack/hstack/scroll),
 * así que envolmos el nodo del rail (`root[Symbol.for(".../layout-node")]`) y le
 * agregamos columnas de borde. En un hstack con align:"stretch", un componente se
 * estira a la altura completa (layout.js: childHeight = align==="stretch" ? allocatedHeight),
 * así que las columnas `║` cubren todo el alto. El ancho se compensa: el rail pasa
 * de RAIL_WIDTH a RAIL_WIDTH+2 (1 borde de cada lado), así el contenido interno del
 * rail conserva su ancho original (no se recorta nada).
 *
 * OCULTAR: el layout del rail sólo se activa si alguna parte ("footer","changes",
 * "agents","todo") rinde líneas. Vaciar esas 4 partes → prepare() devuelve false →
 * layout original (transcript a ancho completo).
 *
 * Comandos: /sidebar [hide|show|toggle]   /sidebar frame [on|off]   Atajo: alt+shift+b
 * Estado: ~/.pi/agent/dc-sidebar.json
 *
 * Si el borde rompe algo: `/sidebar frame off`, o borrá este archivo.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth, Text, TuiAltScreen, TuiMainScreen, ScrollView } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { notify, notifyHerdr } from "./dc-notify.ts";
import { DcWindow } from "./dc-window.ts";

const STATE = Symbol.for("gentle-pi.experimental-sidebar.state");
const CACHE = Symbol.for("gentle-pi.experimental-sidebar.cache");
const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");
const RAIL_KEYS = ["footer", "changes", "agents", "todo"] as const;
const ANCHOR_KEY = "dc-sidebar-anchor";
const STATE_FILE = path.join(os.homedir(), ".pi/agent/dc-sidebar.json");

// Ancho del rail en gentle-pi (RAIL_WIDTH de shell-sidebar-layout.ts).
const RAIL_WIDTH = 50;
const FRAME = { h: "═", v: "║", tl: "╔", tr: "╗", bl: "╚", br: "╝", glyph: "\u26e9" } as const;

interface SidebarState {
  active: boolean;
  parts: Map<string, Component>;
}

// ── estado persistido ─────────────────────────────────────────────────────

interface DcSidebarPrefs {
  hidden: boolean;
  frame: boolean;
  bodyFrame?: boolean;
  headerBar?: boolean;
}

function readPrefs(): DcSidebarPrefs {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      hidden: j.hidden === true,
      frame: j.frame !== false,
      bodyFrame: j.bodyFrame !== false,
      headerBar: j.headerBar === true,
    };
  } catch {
    return { hidden: false, frame: true, bodyFrame: true, headerBar: false };
  }
}

const G_PREFS = Symbol.for("dc.sidebar.prefs");
const prefs: DcSidebarPrefs =
  (globalThis as unknown as Record<symbol, DcSidebarPrefs>)[G_PREFS] ??
  ((globalThis as unknown as Record<symbol, DcSidebarPrefs>)[G_PREFS] = readPrefs());

function writePrefs(p: DcSidebarPrefs): void {
  try {
    Object.assign(prefs, p);
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(prefs));
  } catch {
    /* best-effort */
  }
}

try {
  (globalThis as unknown as Record<symbol, boolean>)[Symbol.for("dc.sidebar.rail-visible")] = !prefs.hidden;
} catch {
  /* noop */
}

const G_TUI = Symbol.for("dc.sidebar.tui-ref");
let tuiRef: TUI | undefined = (globalThis as unknown as Record<symbol, unknown>)[G_TUI] as TUI | undefined;
const G_BANNER_ACTIVE = Symbol.for("dc.banner.active");

function shouldFrameBody(): boolean {
  if (!prefs.bodyFrame) return false;
  const bannerActive = (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE];
  if (bannerActive) return false;
  return true;
}
/**
 * Theme-getter vía símbolo global: el ctx de session_start queda STALE tras
 * /reload, así que guardamos el getter en globalThis y lo actualizamos en cada
 * session_start. Cualquier closure vieja lee SIEMPRE el ctx vigente.
 */
const G_THEME = Symbol.for("dc.sidebar.theme-fn");
function getTheme(): Theme | undefined {
  try {
    const fn = (globalThis as unknown as Record<symbol, unknown>)[G_THEME] as (() => Theme) | undefined;
    return fn?.();
  } catch {
    return undefined;
  }
}
const saved = new Map<string, Component | undefined>();
const emptied = new Set<string>();

// ── ocultar / mostrar ─────────────────────────────────────────────────────

function emptyPart(): Component {
  return { render: () => [] as string[], invalidate() {} };
}

function stateOf(tui: TUI): SidebarState | undefined {
  const term = tui.terminal as unknown as Record<symbol, SidebarState | undefined>;
  return term?.[STATE];
}

function bumpCache(tui: TUI): void {
  const term = tui.terminal as unknown as Record<symbol, { revision: number } | undefined>;
  const cache = term?.[CACHE];
  if (cache) cache.revision++;
}

const BAR_FORCED = Symbol.for("dc.sidebar.bar-forced");
/**
 * El bar inferior (`renderShellBar`, la línea "❋ gentle-pi ◇ …") sólo debe verse
 * cuando el sidebar está OCULTO. gentle-pi lo suprime con
 * `state.active && state.ownsHost?.()`. `state.active` ya refleja si el rail está
 * visible, así que forzamos `ownsHost` a true: el bar queda supeditado sólo a
 * `state.active` (visible → oculto, oculta → visible). Idempotente.
 */
function enforceBar(tui: TUI): void {
  const state = stateOf(tui) as
    | (SidebarState & { ownsHost?: ((...a: unknown[]) => boolean) & Record<symbol, boolean> })
    | undefined;
  if (!state) return;
  const active = isRailActive(tui);
  state.active = active;
  if (state.ownsHost?.[BAR_FORCED]) return;
  const forced = (() => true) as ((...a: unknown[]) => boolean) & Record<symbol, boolean>;
  forced[BAR_FORCED] = true;
  state.ownsHost = forced;
}

function applyHidden(tui: TUI): boolean {
  const state = stateOf(tui);
  enforceBar(tui);

  railVisible = isRailActive(tui);
  try {
    (globalThis as unknown as Record<symbol, boolean>)[Symbol.for("dc.sidebar.rail-visible")] = railVisible;
    const term = tui?.terminal as unknown as Record<symbol, unknown> | undefined;
    if (term) term[Symbol.for("dc.sidebar.rail-visible")] = railVisible;
    if (state) state.active = railVisible;
  } catch {
    /* noop */
  }

  // Si quedaron partes vaciadas por una versión previa, intentar restaurarlas
  if (state?.parts && emptied.size > 0) {
    for (const key of emptied) {
      const prev = saved.get(key);
      if (prev) state.parts.set(key, prev);
    }
    emptied.clear();
    saved.clear();
  }

  bumpCache(tui);
  try {
    const host = tui as unknown as { layoutRoot?: Component; chatContainer?: Component };
    host.layoutRoot?.invalidate?.();
    host.chatContainer?.invalidate?.();
  } catch {
    /* noop */
  }
  tui.requestRender();
  return true;
}

// ── marca del bar inferior ────────────────────────────────────────────────

const FOOTER_ORIG = Symbol.for("dc.sidebar.footer-orig-render");
/** Reemplaza la marca de gentle-pi por la DC en el bar inferior. */
const BRAND_RE = /[✿❋❀✽✾]\s*gentle-pi/g;
const BRAND_TEXT = "⛩  Dc Studio";
const FACE_KEY = Symbol.for("dc.face.mini");
const BAR_SEPARATOR = "\u27E1"; // ⟡ (SHELL_BAR_SEPARATOR de gentle-pi)
const normSeg = (s: string) => s.replace(ANSI_RE, "").replace(/ +/g, " ").trim();

/**
 * Filtra los segmentos redundantes que ya están en el input prompt
 * (modelo, effort, ctx gauge y cost), y distribuye la barra a todo lo ancho:
 * - Izquierda: Brand (⛩  Dc Studio) + Ubicación / Rama git
 * - Centro: MCPs, nombre de sesión y estados secundarios
 * - Derecha: Carita (dc-face)
 * Al encoger la ventana, la carita y el brand son LO ÚLTIMO en ocultarse.
 */
function processBottomBar(line: string, width: number): string {
  try {
    const rawLine = line.replace(BRAND_RE, BRAND_TEXT);
    const rawParts = rawLine.split(BAR_SEPARATOR).map((p) => p.trim()).filter(Boolean);
    const parts: string[] = [];
    for (const rp of rawParts) {
      // Si gentle-pi metió padding de espacios para right-align (ej. "status   @ session"):
      const sub = rp.split(/\s{3,}/).map((s) => s.trim()).filter(Boolean);
      parts.push(...sub);
    }
    if (parts.length === 0) return rawLine;

    // Detectar si la carita está en el estado global
    const faceGlobal = (globalThis as unknown as Record<symbol, string | undefined>)[FACE_KEY];
    let faceSegment: string | undefined = undefined;
    if (faceGlobal && faceGlobal.trim() !== "") {
      const theme = getTheme?.();
      faceSegment = theme ? theme.fg("accent", faceGlobal) : faceGlobal;
    }

    // 1. Filtrar segmentos redundantes que ya están en el input prompt
    const cleanParts: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      const clean = normSeg(p);

      // Detectar si este segmento es la carita (dc-face)
      if (
        (faceGlobal && clean.includes(normSeg(faceGlobal))) ||
        clean.includes("( -_- )") ||
        clean.includes("(-_-)") ||
        /\([ \-_^.oO•◕◉❂‿◒◓]+[ \-_^.oO•◕◉❂‿]*\)/.test(clean) ||
        /(?:dormido|feliz|pensando|escribiendo|trabajando|compactando|reintentando|hablando|permiso|pregunta)/i.test(clean)
      ) {
        if (!faceSegment) {
          faceSegment = p;
        }
        continue;
      }

      // Omitir segmentos vacíos o puramente de secuencias ANSI
      if (!clean) continue;

      // Brand siempre pasa (es el primer elemento)
      if (i === 0) {
        cleanParts.push(p);
        continue;
      }

      // Redundante: Modelo / Effort (ej. ac05/gemini-3.8-flash-high · medium)
      if (
        clean.includes(" · high") ||
        clean.includes(" · medium") ||
        clean.includes(" · low") ||
        clean.includes(" · max") ||
        clean.includes(" · off") ||
        (/\b[a-z0-9_-]+\/[a-z0-9._-]+\b/i.test(clean) && !clean.includes("~") && !clean.includes("/"))
      ) {
        continue;
      }

      // Redundante: Context gauge (ej. ctx ▰▰▰▱▱▱▱ 53% o similar)
      if (clean.toLowerCase().startsWith("ctx") || clean.includes("▰") || clean.includes("▱") || clean.includes("█") || clean.includes("░")) {
        continue;
      }

      // Redundante: Costo (ej. $36.07 o $0.084 sub)
      if (clean.startsWith("$") || clean.endsWith("sub") || /^\$?\d+\.\d{2,3}/.test(clean)) {
        continue;
      }

      // Conservar los demás segmentos útiles (Ubicación, rama git ±dirty, sesión, MCPs, etc.)
      cleanParts.push(p);
    }

    // Si no se capturó la carita de los statuses pero existe en el global, usarla
    if (!faceSegment && faceGlobal && faceGlobal.trim() !== "") {
      const theme = getTheme?.();
      faceSegment = theme ? theme.fg("accent", faceGlobal) : faceGlobal;
    }

    // 2. Organización de los 5 segmentos con separador [ ⟡ ] distribuidor a todo el ancho:
    // Segmentos: Brand, Ubicación/Rama, Sesión, MCPs/Integraciones, Carita.
    const brand = cleanParts[0] ?? BRAND_TEXT;
    const middle = cleanParts.slice(1);

    // Generar escalera de candidatos progresiva (5 -> 4 -> 3 -> 2 -> 1):
    // Al encoger la ventana, se van retirando de derecha a izquierda los elementos del medio (MCPs, luego sesión),
    // luego la ubicación, preservando la carita al máximo hasta que sólo quede el brand.
    const candidates: string[][] = [];
    const curMiddle = [...middle];
    while (curMiddle.length > 0) {
      const list = [brand, ...curMiddle];
      if (faceSegment) list.push(faceSegment);
      candidates.push(list);
      curMiddle.pop();
    }
    if (faceSegment) {
      candidates.push([brand, faceSegment]);
    }
    candidates.push([brand]);

    // Margen alineado con el prompt box superior (2 columnas si ancho >= 100, 1 si >= 60, 0 si menor)
    const padMargin = width >= 100 ? 2 : width >= 60 ? 1 : 0;
    const avail = Math.max(10, width - padMargin * 2);

    for (const cand of candidates) {
      const n = cand.length;
      if (n === 1) {
        const w0 = visibleWidth(cand[0]!);
        if (w0 <= avail) {
          return `${" ".repeat(padMargin)}${cand[0]}${" ".repeat(avail - w0)}${" ".repeat(padMargin)}`;
        }
        return truncateToWidth(cand[0]!, width, "…");
      }

      const sumW = cand.reduce((acc, item) => acc + visibleWidth(item), 0);
      const numGaps = n - 1;
      const minNeeded = sumW + numGaps * 3; // mínimo " ⟡ " por cada separación

      if (minNeeded > avail) {
        continue; // no entra este nivel, probar con un segmento menos (5 -> 4 -> 3 -> 2 -> 1)
      }

      // Distribuir el espacio total restante entre los separadores ⟡ para ocupar todo el ancho
      const totalSpaces = avail - sumW - numGaps; // 1 columna reservada para cada ⟡
      const baseSpaces = Math.floor(totalSpaces / numGaps);
      const remSpaces = totalSpaces % numGaps;

      let out = " ".repeat(padMargin);
      for (let i = 0; i < n; i++) {
        out += cand[i]!;
        if (i < numGaps) {
          const gapSpaces = baseSpaces + (i < remSpaces ? 1 : 0);
          const spLeft = Math.floor(gapSpaces / 2);
          const spRight = gapSpaces - spLeft;
          out += " ".repeat(spLeft) + "\x1b[2m" + BAR_SEPARATOR + "\x1b[22m" + " ".repeat(spRight);
        }
      }
      out += " ".repeat(padMargin);
      return out;
    }

    return truncateToWidth(brand, width, "…");
  } catch {
    return line;
  }
}
const DIAG_FILE = "/tmp/dc-sidebar-diag.json";
const TRACE_FILE = "/tmp/dc-sidebar-trace.json";
const traceSteps: string[] = [];
/** Deja rastro de por dónde pasó session_start (para depurar /reload). */
function trace(step: string): void {
  traceSteps.push(step);
  try {
    // Incluye la rev del módulo: varias instancias (reload) escriben el mismo
    // archivo; sin rev no se sabe cuál escribió (nos confundió antes).
    fs.writeFileSync(TRACE_FILE, JSON.stringify({ rev: MODULE_REV, steps: traceSteps }));
  } catch {
    /* noop */
  }
}

/** Diagnóstico: deja en /tmp cómo se ve el árbol y el estado (para depurar). */
function diag(tui: TUI, extra: Record<string, unknown>): void {
  try {
    const host = tui as unknown as { layoutRoot?: Record<symbol, LayoutNodeFn>; mode?: string };
    const root = host.layoutRoot;
    const term = tui.terminal as unknown as { columns?: number; rows?: number } | undefined;
    const info: Record<string, unknown> = {
      t: new Date().toISOString(),
      hasRoot: !!root,
      columns: term?.columns,
      rows: term?.rows,
      mode: host.mode,
      ...extra,
    };
    let node = (root?.[LAYOUT_NODE] as LayoutNodeFn | undefined)?.() as
      | { type?: string; entries?: Array<{ component?: unknown }> }
      | undefined;
    info.topType = node?.type;
    info.topEntries = node?.entries?.length;
    if (node?.type === "hstack" && Array.isArray(node.entries)) {
      const len = node.entries.length;
      const idx = len === 2 ? 0 : len === 4 ? 1 : -1;
      if (idx >= 0) {
        const left = node.entries[idx]?.component as Record<symbol, LayoutNodeFn> | undefined;
        node = left?.[LAYOUT_NODE]?.() as typeof node;
        info.wentHstack = true;
      }
    }
    info.nativeType = node?.type;
    info.nativeEntries = node?.entries?.length;
    const dock = node?.entries?.[1]?.component as Record<symbol, LayoutNodeFn> | undefined;
    const dockNode = dock?.[LAYOUT_NODE]?.() as { entries?: Array<{ component?: unknown }> } | undefined;
    info.dockType = dockNode?.type;
    info.dockEntries = dockNode?.entries?.length;
    info.footerFound = !!dockNode?.entries?.[dockNode.entries.length - 1]?.component;
    const st = stateOf(tui) as (SidebarState & { ownsHost?: unknown }) | undefined;
    info.stateActive = st?.active;
    info.hasState = !!st;
    info.hasOwnsHost = typeof st?.ownsHost === "function";
    info.parts = st?.parts?.size;
    info.railVisible = railVisible;
    info.restoredAtStart = restoredAtStart;
    const sc = (globalThis as unknown as Record<symbol, { scrollbar?: string; isScrollbarVisible?: boolean } | undefined>)[G_SCROLL];
    info.scrollbar = sc?.scrollbar;
    info.scrollbarVisible = sc?.isScrollbarVisible;
    info.facePart = !!st?.parts?.get("face");
    fs.writeFileSync(DIAG_FILE, JSON.stringify(info, null, 1));
  } catch (e) {
    try {
      fs.writeFileSync(DIAG_FILE, JSON.stringify({ err: String(e), ...extra }));
    } catch {
      /* noop */
    }
  }
}

/**
 * El bar inferior (renderShellBar) es el último entry del `dock`
 * (chat-viewport.js: root=vstack[transcript, dock]; dock=vstack[…, footer]).
 * Envolvemos el render del footer: (a) lo OCULTAMOS cuando el rail está activo
 * (sidebar visible), (b) cambiamos SOLO la marca cuando se ve. Sin tocar gentle-pi.
 */
function wrapFooterBrand(tui: TUI): void {
  try {
    const host = tui as unknown as { layoutRoot?: Record<symbol, LayoutNodeFn> };
    const root = host.layoutRoot;
    rememberRoot(root);
    if (!root || typeof root[LAYOUT_NODE] !== "function") return;
    let node = root[LAYOUT_NODE]() as
      | { type?: string; entries?: Array<{ component?: unknown }> }
      | undefined;
    // gentle-pi envuelve el root en un hstack: NUEVA (2 entries con `left` =
    // entries[0] → el nativo) o VIEJA (4 entries, el nativo es entries[1]).
    if (node?.type === "hstack" && Array.isArray(node.entries)) {
      const len = node.entries.length;
      const idx = len === 2 ? 0 : len === 4 ? 1 : -1;
      if (idx >= 0) {
        const left = node.entries[idx]?.component as Record<symbol, LayoutNodeFn> | undefined;
        node = left?.[LAYOUT_NODE]?.() as typeof node;
      }
    }
    if (!node || node.type !== "vstack" || !Array.isArray(node.entries)) return;
    const dock = node.entries[1]?.component as Record<symbol, LayoutNodeFn> | undefined;
    const dockNode = dock?.[LAYOUT_NODE]?.() as { entries?: Array<{ component?: unknown }> } | undefined;
    if (!dockNode?.entries?.length) return;
    const footer = dockNode.entries[dockNode.entries.length - 1]?.component as
      | (Component & Record<symbol, unknown>)
      | undefined;
    if (!footer || typeof footer.render !== "function") return;
    // Render ORIGINAL guardado bajo símbolo global (sobrevive /reload) y override
    // re-seteado SIEMPRE → la closure nueva lee el `railVisible` nuevo.
    const stored = footer[FOOTER_ORIG] as ((w: number) => string[]) | undefined;
    const orig =
      stored ?? ((footer[FOOTER_ORIG] = footer.render.bind(footer)) as (w: number) => string[]);
    footer.render = (width: number): string[] => {
      // Si el rail/sidebar está visible en pantalla, ocultamos la barra inferior.
      // Si el sidebar se oculta (/sidebar hide o por ancho < 140), se muestra la barra inferior con el brand DC.
      if (isRailActive((tui as TUI) ?? tuiRef)) return [];
      // Pasamos un ancho generoso a orig() (mínimo 240) para que gentle-pi NUNCA mutile ni expulse
      // los trailing statuses (donde vive la carita dc-face) antes de que processBottomBar pueda organizarlos.
      const rawLines = orig(Math.max(240, width * 2));
      return rawLines.map((line: string) => processBottomBar(line, width));
    };
  } catch {
    /* noop */
  }
}

// ── widgets de extensión (agents / todo / changes) ────────────────────────

const WIDGET_PATCHED = Symbol.for("dc.sidebar.widget-patched");
const G_WIDGET_HOST = Symbol.for("dc.sidebar.widget-host");
const G_DC_WIDGET_WRAPPER = Symbol.for("dc.sidebar.widget-wrapper");
const WIDGET_WRAPPED_REV = Symbol.for("dc.sidebar.widget-wrapped-rev");

const SIDEBAR_WIDGET_KEYS = new Set([
  "gentle-todo",
  "gentle-agents",
  "gentle-changes",
  "gentle-shell-changes",
  "todo",
  "agents",
  "changes",
  "dc-doctor-anchor",
  "dc-sidebar-anchor",
]);

function isSidebarWidget(key?: string): boolean {
  if (!key) return false;
  const k = key.toLowerCase();
  if (SIDEBAR_WIDGET_KEYS.has(k)) return true;
  return /todo|agent|change|anchor|doctor|dev-binary/i.test(k);
}

/**
 * Determina si el rail del sidebar está activo y visible físicamente en pantalla.
 * Se vincula directamente con la presencia real del nodo del rail y el estado de gentle-pi,
 * sin asumir números fijos ni breakpoints artificiales.
 */
function isRailActive(tui?: unknown): boolean {
  // Si el usuario lo ocultó explícitamente con /sidebar hide, nunca está activo
  if (prefs.hidden) return false;

  const effectiveTui = (tui as TUI) ?? tuiRef;
  const st = effectiveTui ? stateOf(effectiveTui) : undefined;

  // 1. Verificación directa sobre el árbol de layout real del TUI (sin asumir columnas)
  try {
    const host = effectiveTui as unknown as { layoutRoot?: Record<symbol, LayoutNodeFn> };
    const root = host?.layoutRoot ?? (globalThis as unknown as Record<symbol, unknown>)[G_ROOT];
    if (root && typeof (root as Record<symbol, LayoutNodeFn>)[LAYOUT_NODE] === "function") {
      const node = (root as Record<symbol, LayoutNodeFn>)[LAYOUT_NODE]!();
      // Si el nodo raíz es un hstack que contiene el rail, está físicamente visible
      if (node?.type === "hstack" && Array.isArray(node.entries) && railIndex(node) >= 0) {
        return true;
      }
    }
  } catch {
    /* noop */
  }

  // 2. Si gentle-pi o el wrapper marcaron el estado activo en el frame actual
  if (railVisible) return true;
  if (st?.active === true) return true;
  if ((globalThis as unknown as Record<symbol, unknown>)[Symbol.for("dc.sidebar.rail-visible")] === true) {
    return true;
  }
  const term = effectiveTui?.terminal as unknown as Record<symbol, unknown> | undefined;
  if (term?.[Symbol.for("dc.sidebar.rail-visible")] === true) return true;

  return false;
}

/**
 * Envuelve un widget de extensión: evita que los widgets del sidebar (agents,
 * todo, changes, anchors) se cuelen en el body del chat, tanto si el sidebar está
 * visible como si fue ocultado por el usuario.
 */
function dcWidget(tui: unknown, comp: Component, widgetKey?: string): Component {
  if (!comp || typeof comp.render !== "function") return comp;
  const orig = comp.render.bind(comp);
  return {
    ...(comp as object),
    render: (width: number): string[] => {
      try {
        if (!widgetKey || isSidebarWidget(widgetKey)) return [];
        const lines = orig(width);
        if (!lines || lines.length === 0) return [];
        return restyleCard((tui as TUI) ?? tuiRef!, lines, width);
      } catch {
        return [];
      }
    },
    invalidate: (comp.invalidate ?? function () {}).bind(comp),
  } as unknown as Component;
}

const TEXT_PATCHED = Symbol.for("dc.sidebar.text-patched");

/**
 * Pi-tui `Text`: los tool rows de gentle-pi se pintan con `new Text("❀ agent …")`
 * (renderCall) FUERA del subárbol que recorre nuestro decorador. Patchear el
 * render del Text agarra esas filas y cambia el petal por el icono del tool.
 */
function patchTextGlyph(): void {
  try {
    const proto = (Text as unknown as { prototype?: Record<string, unknown> }).prototype;
    if (!proto || (proto as Record<symbol, boolean>)[TEXT_PATCHED]) return;
    const orig = proto.render as ((width: number) => string[]) | undefined;
    if (typeof orig !== "function") return;
    (proto as Record<symbol, boolean>)[TEXT_PATCHED] = true;
    proto.render = function (this: unknown, width: number): string[] {
      const lines = orig.call(this, width);
      try {
        if (!Array.isArray(lines)) return lines;
        // Aviso nativo de pi "✓ New session started": no ensucia la terminal,
        // se despacha por dc-notification (Herdr) y se oculta acá.
        if (lines.some((l) => typeof l === "string" && l.includes("New session started"))) {
          notifyNewSession();
          return [];
        }
        // Cartel de reload: no ensucia la terminal, se despacha por dc-notify (Herdr).
        if (
          lines.some(
            (l) =>
              typeof l === "string" && l.toLowerCase().includes("reloading keybindings"),
          )
        ) {
          return [];
        }
        // Aviso de reintento: no ensucia la terminal, se despacha por dc-notify (Herdr).
        if (
          lines.some(
            (l) =>
              typeof l === "string" &&
              (l.includes("Retrying (") || (l.includes("Retrying") && l.includes("cancel"))),
          )
        ) {
          return [];
        }
        // Silenciar avisos de cookies de Gemini Web: ni pantalla ni notificación.
        if (
          lines.some(
            (l) =>
              typeof l === "string" &&
              (l.includes("Gemini Web browser cookie access is disabled") ||
                l.includes("allowBrowserCookies")),
          )
        ) {
          return [];
        }
        // Aviso de operación abortada: no ensucia la terminal, se despacha por dc-notify (Herdr).
        if (
          lines.some((l) => {
            if (typeof l !== "string") return false;
            const clean = l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
            return clean.includes("Operation aborted") || clean.includes("Operación abortada");
          })
        ) {
          notifyHerdr("Operación abortada", "La operación fue cancelada por el usuario (Escape)");
          return [];
        }
        // Avisos de conflictos y diagnósticos del core: no ensucian la pantalla,
        // se capturan para la ventana de estado del entorno (dc-status / Alt+E).
        if (
          lines.some((l) => {
            if (typeof l !== "string") return false;
            const plain = l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
            return (
              plain.includes("[Extension issues]") ||
              plain.includes("[Skill conflicts]") ||
              plain.includes("[Prompt conflicts]") ||
              plain.includes("[Theme conflicts]")
            );
          })
        ) {
          const G_DIAG = Symbol.for("dc.env.diagnostics");
          const list: string[] = ((globalThis as unknown as Record<symbol, string[]>)[G_DIAG] ??= []);
          const plainText = lines
            .map((l) => (typeof l === "string" ? l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trimEnd() : ""))
            .filter((l) => l.trim().length > 0)
            .join("\n");
          if (plainText && !list.includes(plainText)) {
            list.push(plainText);
          }
          return [];
        }
        // Los tool rows y las cards del box pasan por acá: petal→icono (+1 ─ si
        // el emoji ocupa 2 celdas) y borde redondeado → doble línea DcWindow.
        return (lines as string[]).map((l) =>
          typeof l === "string" ? bgCardTitle(doubleCardLine(replaceExpandCollapseHint(replaceToolPetal(l)))) : l,
        );
      } catch {
        return lines;
      }
    };
    trace("text-patcher");
  } catch (e) {
    trace("text-patch-error:" + String(e));
  }
}

/** Patchea setExtensionWidget: todo widget futuro pasa por dcWidget. */
function patchExtensionWidgets(): void {
  try {
    // Registrar el envoltorio vigente en globalThis para que sobreviva a /reload
    (globalThis as unknown as Record<symbol, unknown>)[G_DC_WIDGET_WRAPPER] = (
      tui: unknown,
      comp: Component,
      key?: string,
    ) => dcWidget(tui, comp, key);

    const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> }).prototype;
    if (!proto) return;
    if ((proto as Record<symbol, boolean>)[WIDGET_PATCHED]) {
      wrapMountedWidgets();
      return;
    }
    const orig = proto.setExtensionWidget as
      | ((key: string, content: unknown, options?: unknown) => void)
      | undefined;
    if (typeof orig !== "function") return;
    (proto as Record<symbol, boolean>)[WIDGET_PATCHED] = true;
    proto.setExtensionWidget = function (this: unknown, key: string, content: unknown, options?: unknown) {
      (globalThis as unknown as Record<symbol, unknown>)[G_WIDGET_HOST] = this;
      let wrapped = content;
      if (typeof content === "function") {
        wrapped = (tui: unknown, theme: unknown) => {
          const comp = (content as (a: unknown, b: unknown) => Component)(tui, theme);
          const wrapFn = (globalThis as unknown as Record<symbol, unknown>)[G_DC_WIDGET_WRAPPER] as
            | ((t: unknown, c: Component, k?: string) => Component)
            | undefined;
          return wrapFn ? wrapFn(tui, comp, key) : comp;
        };
      }
      return orig.call(this, key, wrapped, options);
    };
    wrapMountedWidgets();
    trace("widget-patcher");
  } catch (e) {
    trace("widget-patch-error:" + String(e));
  }
}

/** Envuelve los widgets ya montados (por si se setearon antes del patch o en /reload). */
function wrapMountedWidgets(): void {
  try {
    const host = (globalThis as unknown as Record<symbol, unknown>)[G_WIDGET_HOST] as
      | {
          extensionWidgetsAbove?: Map<string, Component>;
          extensionWidgetsBelow?: Map<string, Component>;
          ui?: { requestRender?: () => void };
        }
      | undefined;
    if (!host) return;
    const wrapFn = (globalThis as unknown as Record<symbol, unknown>)[G_DC_WIDGET_WRAPPER] as
      | ((t: unknown, c: Component, k?: string) => Component)
      | undefined;
    for (const map of [host.extensionWidgetsAbove, host.extensionWidgetsBelow]) {
      if (!map) continue;
      for (const [key, comp] of map) {
        if (!comp || (comp as Record<symbol, unknown>)[WIDGET_WRAPPED_REV] === MODULE_REV) continue;
        (comp as Record<symbol, unknown>)[WIDGET_WRAPPED_REV] = MODULE_REV;
        const wrapped = wrapFn ? wrapFn(host.ui ?? tuiRef, comp, key) : dcWidget(host.ui ?? tuiRef, comp, key);
        map.set(key, wrapped);
      }
    }
    host.ui?.requestRender?.();
  } catch {
    /* noop */
  }
}

// ── card Status con chrome DcWindow ───────────────────────────────────────

const CARD_STYLED = Symbol.for("dc.sidebar.card-styled");
const CARD_ORIG = Symbol.for("dc.sidebar.card-orig-render");
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Iconos DC por tarjeta (reemplazan el glifo default de gentle-pi). */
const CARD_GLYPHS: Array<[RegExp, string]> = [
  [/context/i, "🪧"], // 🪧 Contexto
  [/status/i, "\u{1F5C3}"], // 🗃️
  [/agent/i, "\u{1F468}\u200D\u{1F4BC}"], // 👨‍💼
  [/todo/i, "\u{1F9F0}"], // 🧰
  [/change/i, "\u{1F4C2}"], // 📂
  [/subscript|usage/i, "🧮"], // 🧮 Quota / Usage
  [/bash|terminal|command|sh\b/i, "📟"], // 📟 Bash
];

/** Reemplaza el glifo inicial del título del card por el icono DC. */
function withCardGlyph(t: string): string {
  const bare = t.replace(/^[^\p{L}\p{N}]+/u, "").trim();
  for (const [re, g] of CARD_GLYPHS) {
    if (re.test(bare)) return `${g}  ${bare}`;
  }
  return t;
}

/** Tokens de una línea: secuencias ANSI o caracteres sueltos. */
function tokens(line: string): string[] {
  const out: string[] = [];
  const re = /\x1b\[[0-9;]*m|[\s\S]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[0]);
  return out;
}

function visibleIndexes(toks: string[]): number[] {
  return toks.map((t, i) => (t.startsWith("\x1b") ? -1 : i)).filter((i) => i >= 0);
}

/** Detecta si una línea del card Status corresponde a la mini-carita de dc-face. */
function isFaceLine(s: string): boolean {
  const bare = s.replace(ANSI_RE, "").trim();
  if (!bare) return false;
  try {
    const face = (globalThis as unknown as Record<symbol, string | undefined>)[FACE_KEY];
    if (face && bare.includes(normSeg(face))) return true;
  } catch {
    /* noop */
  }
  if (/^demo\s+\d+\/\d+/i.test(bare)) return true;
  if (/^(?:feliz|pensando|escribiendo|trabajando|dormido|compactando|reintentando|hablando|permiso|pregunta)\b/i.test(bare)) {
    return true;
  }
  if (/[❂≖◔ʘ]|zzZ|\(•‿•\)|\(・_・\)/.test(bare)) return true;
  return false;
}

const G_CTX = Symbol.for("dc.sidebar.ctx");
let currentCtx: ExtensionContext | undefined = (globalThis as unknown as Record<symbol, unknown>)[G_CTX] as ExtensionContext | undefined;
let currentPi: ExtensionAPI | undefined;

// ── Caché y extractor de cuota activa para la sección Usage del Status Card ──

interface ActiveQuotaData {
  prefix: string;
  familyName: string;
  pct5h?: number;
  reset5h?: string;
  pctWeek?: number;
  resetWeek?: string;
}

let activeQuotaCacheData: ActiveQuotaData | null = null;
let lastActiveQuotaFetchTime = 0;
let isActiveQuotaFetching = false;
let quotaExpanded = true; // Estado de expansión de la sección Quota (desplegable)
const expandedAccounts = new Set<string>(); // Cuentas expandidas individualmente dentro de Quota
let mcpExpanded = false; // Estado de expansión de la sección MCP (desplegable)
let profileExpanded = false; // Estado de expansión de la sección Profile (desplegable)

// Símbolos globales para interacción y apertura de Quota / MCP / Profile
const G_TOGGLE_USAGE_EXPAND = Symbol.for("dc.status.toggle-usage-expand");
const G_TOGGLE_MCP_EXPAND = Symbol.for("dc.status.toggle-mcp-expand");
const G_TOGGLE_PROFILE_EXPAND = Symbol.for("dc.status.toggle-profile-expand");
const G_OPEN_QUOTA = Symbol.for("dc.quota.open");

(globalThis as unknown as Record<symbol, unknown>)[G_TOGGLE_USAGE_EXPAND] = () => {
  quotaExpanded = !quotaExpanded;
  return quotaExpanded;
};

(globalThis as unknown as Record<symbol, unknown>)[G_TOGGLE_MCP_EXPAND] = () => {
  mcpExpanded = !mcpExpanded;
  return mcpExpanded;
};

(globalThis as unknown as Record<symbol, unknown>)[G_TOGGLE_PROFILE_EXPAND] = () => {
  profileExpanded = !profileExpanded;
  return profileExpanded;
};

// Coordenadas dinámicas de clic para Status card
const statusClickTargets = {
  changesModalY: [] as number[],
  quotaToggleY: [] as number[],
  quotaManageY: [] as number[],
  accountToggleMap: new Map<number, string>(),
  profileToggleY: [] as number[],
  profileItemMap: new Map<number, string>(),
  profileManageY: [] as number[],
  lspLineY: [] as number[],
  mcpToggleY: [] as number[],
  mcpManageY: [] as number[],
  contextCardStartY: 999,
};

const G_OPEN_CHANGES = Symbol.for("dc.changes.open");
function openChangesModal(ctx?: ExtensionContext): void {
  const openFn = (globalThis as unknown as Record<symbol, unknown>)[G_OPEN_CHANGES] as ((c?: ExtensionContext) => void) | undefined;
  if (openFn) {
    openFn(ctx || currentCtx);
  } else if (currentPi?.sendUserMessage) {
    void currentPi.sendUserMessage("/changes");
  }
}

let lastDetectedLspStatus = "";

// ── Lector y conmutador rápido de perfiles de gentle-pi / agent-model profiles ──

interface ProfilesInfo {
  active: string;
  pinned: boolean;
  profiles: string[];
}

let profilesCacheTimestamp = 0;
let cachedProfilesInfo: ProfilesInfo = { active: "", pinned: false, profiles: [] };

function getEffectiveActiveProfile(cwd?: string, fallbackActive?: string): ProfilesInfo {
  const now = Date.now();
  if (now - profilesCacheTimestamp < 2000 && cachedProfilesInfo.profiles.length > 0) {
    return cachedProfilesInfo;
  }
  profilesCacheTimestamp = now;

  try {
    const configHome = process.env.GENTLE_PI_CONFIG_HOME || path.join(os.homedir(), ".pi", "gentle-ai");
    const profilesPath = path.join(configHome, "profiles.json");
    let active = fallbackActive || "";
    let profiles: string[] = [];
    let pinned = false;

    if (fs.existsSync(profilesPath)) {
      const data = JSON.parse(fs.readFileSync(profilesPath, "utf8"));
      if (typeof data?.active === "string" && data.active) {
        active = data.active;
      }
      if (data?.profiles && typeof data.profiles === "object") {
        profiles = Object.keys(data.profiles);
      }
    }

    // Comprobar pins de repositorio
    const currentDir = cwd || currentCtx?.sessionManager?.getCwd?.() || process.cwd();
    const repoPinPath = path.join(currentDir, ".pi", "gentle-ai", "profile.json");
    if (fs.existsSync(repoPinPath)) {
      try {
        const pinData = JSON.parse(fs.readFileSync(repoPinPath, "utf8"));
        if (pinData?.profile && (profiles.length === 0 || profiles.includes(pinData.profile))) {
          active = pinData.profile;
          pinned = true;
        }
      } catch {
        /* noop */
      }
    }
    const gitDir = path.join(currentDir, ".git");
    const localPinPath = path.join(gitDir, "gentle-ai", "profile-pin.json");
    if (fs.existsSync(localPinPath)) {
      try {
        const pinData = JSON.parse(fs.readFileSync(localPinPath, "utf8"));
        if (pinData?.profile && (profiles.length === 0 || profiles.includes(pinData.profile))) {
          active = pinData.profile;
          pinned = true;
        }
      } catch {
        /* noop */
      }
    }

    if (!active && profiles.length > 0) {
      active = profiles[0]!;
    }

    cachedProfilesInfo = { active: active || "default", pinned, profiles };
    return cachedProfilesInfo;
  } catch {
    return cachedProfilesInfo;
  }
}

async function switchProfile(targetProfile: string, tui?: TUI): Promise<void> {
  const ctx = currentCtx || ((globalThis as unknown as Record<symbol, unknown>)[G_CTX] as ExtensionContext | undefined);
  try {
    const configHome = process.env.GENTLE_PI_CONFIG_HOME || path.join(os.homedir(), ".pi", "gentle-ai");
    const profilesPath = path.join(configHome, "profiles.json");
    if (!fs.existsSync(profilesPath)) {
      ctx?.ui?.notify?.("No se encontró el archivo profiles.json", "warning");
      return;
    }

    const data = JSON.parse(fs.readFileSync(profilesPath, "utf8"));
    if (!data || !data.profiles || !data.profiles[targetProfile]) {
      ctx?.ui?.notify?.(`El perfil "${targetProfile}" no existe`, "warning");
      return;
    }

    const prevActive = data.active;
    if (prevActive === targetProfile) {
      ctx?.ui?.notify?.(`El perfil "${targetProfile}" ya está activo`, "info");
      return;
    }

    // 1. Actualizar activo en profiles.json
    data.active = targetProfile;
    fs.writeFileSync(profilesPath, JSON.stringify(data, null, 2) + "\n");

    // 2. Actualizar models.json si el perfil define agentes
    const profileConfig = data.profiles[targetProfile] || {};
    const modelsPath = path.join(configHome, "models.json");
    const agentModels: Record<string, any> = {};
    for (const [k, v] of Object.entries(profileConfig)) {
      if (k !== "orchestrator") {
        agentModels[k] = v;
      }
    }
    fs.writeFileSync(modelsPath, JSON.stringify(agentModels, null, 2) + "\n");

    // 3. Si el perfil define orchestrator, actualizar settings.json y modelo en vivo
    const orchestrator = profileConfig.orchestrator;
    if (orchestrator?.model && typeof orchestrator.model === "string") {
      const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
      if (fs.existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
          const firstSlash = orchestrator.model.indexOf("/");
          if (firstSlash > 0) {
            settings.defaultProvider = orchestrator.model.slice(0, firstSlash);
            settings.defaultModel = orchestrator.model.slice(firstSlash + 1);
          } else {
            settings.defaultModel = orchestrator.model;
          }
          if (orchestrator.thinking) {
            settings.defaultThinkingLevel = orchestrator.thinking;
          }
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
        } catch {
          /* noop */
        }
      }

      // Intentar setear el modelo en la sesión actual
      if (ctx?.modelRegistry && currentPi?.setModel) {
        try {
          const firstSlash = orchestrator.model.indexOf("/");
          if (firstSlash > 0) {
            const prov = orchestrator.model.slice(0, firstSlash);
            const mid = orchestrator.model.slice(firstSlash + 1);
            const found = ctx.modelRegistry.find(prov, mid);
            if (found) {
              await currentPi.setModel(found);
              if (orchestrator.thinking && currentPi.setThinkingLevel) {
                currentPi.setThinkingLevel(orchestrator.thinking);
              }
            }
          }
        } catch {
          /* noop */
        }
      }
    }

    // 4. Si el repositorio tiene pin local, actualizar el pin también
    try {
      const currentDir = ctx?.sessionManager?.getCwd?.() || process.cwd();
      const localPinPath = path.join(currentDir, ".git", "gentle-ai", "profile-pin.json");
      if (fs.existsSync(localPinPath)) {
        fs.writeFileSync(
          localPinPath,
          JSON.stringify({ kind: "gentle-pi.agent_model_profile_pin", profile: targetProfile }, null, 2) + "\n",
        );
      }
    } catch {
      /* noop */
    }

    // Limpiar caché
    profilesCacheTimestamp = 0;
    ctx?.ui?.notify?.(`Perfil activo cambiado a: ${targetProfile}`, "info");

    tui?.requestRender?.();
  } catch (err: any) {
    ctx?.ui?.notify?.(`Error al cambiar perfil: ${err?.message || err}`, "error");
  }
}

const G_OPEN_PROFILES = Symbol.for("gentle-ai.profiles.open");
const G_OPEN_MCP = Symbol.for("pi.mcp.open");

function openProfilesManager(ctx?: ExtensionContext): void {
  const targetCtx = ctx || currentCtx;
  const openFn = (globalThis as unknown as Record<symbol, unknown>)[G_OPEN_PROFILES] as ((c?: ExtensionContext) => void) | undefined;
  if (openFn && targetCtx) {
    openFn(targetCtx);
  } else {
    targetCtx?.ui?.notify?.("Ejecutá /gentle:profiles para administrar perfiles", "info");
  }
}

function openMcpManager(ctx?: ExtensionContext): void {
  const targetCtx = ctx || currentCtx;
  const openFn = (globalThis as unknown as Record<symbol, unknown>)[G_OPEN_MCP] as ((c?: ExtensionContext) => void) | undefined;
  if (openFn && targetCtx) {
    openFn(targetCtx);
  } else {
    targetCtx?.ui?.notify?.("Ejecutá /mcp para administrar servidores MCP", "info");
  }
}

function getActiveAccounts(activeModelId?: string): string[] {
  const accounts = new Set<string>();
  if (activeModelId) {
    const parts = activeModelId.split("/");
    if (parts.length > 2 && parts[0]?.toLowerCase() === "cpam") accounts.add(parts[1]!.toLowerCase());
    else if (parts.length > 1) accounts.add(parts[0]!.toLowerCase());
  }

  const configHome = process.env.GENTLE_PI_CONFIG_HOME || path.join(os.homedir(), ".pi", "gentle-ai");
  const profilesPath = path.join(configHome, "profiles.json");
  if (fs.existsSync(profilesPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(profilesPath, "utf8"));
      const activeName = data?.active;
      const activeConfig = (activeName && data?.profiles) ? data.profiles[activeName] : null;
      if (activeConfig && typeof activeConfig === "object") {
        for (const [k, v] of Object.entries(activeConfig as Record<string, any>)) {
          const m = v?.model;
          if (typeof m === "string") {
            const parts = m.split("/");
            if (parts.length > 2 && parts[0]?.toLowerCase() === "cpam") accounts.add(parts[1]!.toLowerCase());
            else if (parts.length > 1) accounts.add(parts[0]!.toLowerCase());
          }
        }
      }
      if (typeof activeName === "string") {
        const m = activeName.match(/\b(ac\d+|cc\d+)\b/i);
        if (m) accounts.add(m[1]!.toLowerCase());
      }
    } catch {
      /* noop */
    }
  }

  const modelsPath = path.join(configHome, "models.json");
  if (fs.existsSync(modelsPath)) {
    try {
      const mCfg = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
      if (mCfg && typeof mCfg === "object") {
        for (const [k, v] of Object.entries(mCfg as Record<string, any>)) {
          const m = v?.model;
          if (typeof m === "string") {
            const parts = m.split("/");
            if (parts.length > 2 && parts[0]?.toLowerCase() === "cpam") accounts.add(parts[1]!.toLowerCase());
            else if (parts.length > 1) accounts.add(parts[0]!.toLowerCase());
          }
        }
      }
    } catch {
      /* noop */
    }
  }

  const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
  if (fs.existsSync(settingsPath)) {
    try {
      const s = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      if (s.defaultModel && typeof s.defaultModel === "string") {
        const parts = s.defaultModel.split("/");
        if (parts.length > 1) accounts.add(parts[0]!.toLowerCase());
      }
    } catch {
      /* noop */
    }
  }

  const list = Array.from(accounts).filter(Boolean);
  return list.length > 0 ? list : ["ac06"];
}

const activeQuotaMap = new Map<string, ActiveQuotaData>();

function triggerActiveQuotaFetch(activeModelId?: string, tui?: TUI): void {
  const now = Date.now();
  if (now - lastActiveQuotaFetchTime < 15000 || isActiveQuotaFetching) return;
  isActiveQuotaFetching = true;
  lastActiveQuotaFetchTime = now;

  const accounts = getActiveAccounts(activeModelId);

  Promise.all(
    accounts.map(async (prefix) => {
      try {
        const r = await fetch(`http://127.0.0.1:8325/quota/${encodeURIComponent(prefix)}`);
        if (!r.ok) return;
        const data = await r.json();
        if (!data || !Array.isArray(data.entries) || data.entries.length === 0) return;

        const isClaude = /claude/i.test(activeModelId || "");
        const isGemini = /gemini/i.test(activeModelId || "");
        const isGpt = /gpt|codex|o1|o3|o4/i.test(activeModelId || "");

        let relevant = data.entries.filter((e: any) => {
          const l = (e.label || e.name || "").toLowerCase();
          if (isClaude) return l.includes("claude");
          if (isGemini) return l.includes("gemini");
          if (isGpt) return l.includes("gpt") || l.includes("codex");
          return true;
        });
        if (relevant.length === 0) relevant = data.entries;

        const familyName = isGemini ? "Gemini" : isClaude ? "Claude" : isGpt ? "GPT / Codex" : prefix.toUpperCase();
        const quotaData: ActiveQuotaData = { prefix, familyName };

        for (const e of relevant) {
          const is5h = /5h|rolling|hour|primary/i.test(e.label || e.name || "");
          const pct = Math.max(0, Math.min(100, Math.round(e.percentRemaining ?? 0)));
          let resetStr = "";
          if (e.resetTimeIso) {
            const ms = Date.parse(e.resetTimeIso) - Date.now();
            if (ms > 0) {
              const h = ms / 3600000;
              if (h >= 24) {
                const d = Math.floor(h / 24);
                const remH = Math.round(h % 24);
                resetStr = remH > 0 ? `${d}d ${remH}h` : `${d}d`;
              } else if (h >= 1) {
                resetStr = `${Math.round(h * 10) / 10}h`;
              } else {
                resetStr = `${Math.round(ms / 60000)}m`;
              }
            }
          }
          if (is5h) {
            quotaData.pct5h = pct;
            quotaData.reset5h = resetStr;
          } else {
            quotaData.pctWeek = pct;
            quotaData.resetWeek = resetStr;
          }
        }

        activeQuotaMap.set(prefix, quotaData);
      } catch {
        /* noop */
      }
    }),
  )
    .then(() => {
      isActiveQuotaFetching = false;
      const primary = accounts[0];
      if (primary && activeQuotaMap.has(primary)) {
        activeQuotaCacheData = activeQuotaMap.get(primary)!;
      }
      tui?.requestRender?.();
    })
    .catch(() => {
      isActiveQuotaFetching = false;
    });
}

function justifyRow(leftText: string, rightText: string, innerWidth: number): string {
  const vLeft = visibleWidth(leftText);
  const vRight = visibleWidth(rightText);
  const total = vLeft + vRight;
  if (total >= innerWidth) {
    return `${leftText} ${rightText}`;
  }
  const spaces = innerWidth - total;
  return `${leftText}${" ".repeat(spaces)}${rightText}`;
}

interface McpServerDetail {
  name: string;
  disabled: boolean;
  toolsCount?: number;
}

interface McpInfoResult {
  totalCount: number;
  enabledCount: number;
  disabledCount: number;
  servers: McpServerDetail[];
}

let mcpCacheTimestamp = 0;
let cachedMcpInfo: McpInfoResult = { totalCount: 0, enabledCount: 0, disabledCount: 0, servers: [] };

function getMcpServersInfo(cwd?: string): McpInfoResult {
  const now = Date.now();
  if (now - mcpCacheTimestamp < 3000 && cachedMcpInfo.servers.length > 0) {
    return cachedMcpInfo;
  }
  mcpCacheTimestamp = now;

  try {
    const currentDir = cwd || currentCtx?.sessionManager?.getCwd?.() || process.cwd();
    const mcpGlobalPath = path.join(os.homedir(), ".pi", "agent", "mcp.json");
    const mcpHomePath = path.join(os.homedir(), ".mcp.json");
    const projectMcpPath = path.join(currentDir, "mcp.json");
    const projectPiPath = path.join(currentDir, ".pi", "mcp.json");
    const cachePath = path.join(os.homedir(), ".pi", "agent", "mcp-cache.json");

    const serverDefs: Record<string, any> = {};

    // 1. Fuentes globales
    for (const p of [mcpHomePath, mcpGlobalPath]) {
      if (fs.existsSync(p)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
          if (cfg?.mcpServers && typeof cfg.mcpServers === "object") {
            Object.assign(serverDefs, cfg.mcpServers);
          }
        } catch {
          /* noop */
        }
      }
    }

    // 2. Fuentes locales de proyecto (tienen precedencia sobre disabled)
    for (const p of [projectMcpPath, projectPiPath]) {
      if (fs.existsSync(p)) {
        try {
          const prj = JSON.parse(fs.readFileSync(p, "utf8"));
          if (prj?.mcpServers && typeof prj.mcpServers === "object") {
            for (const [name, def] of Object.entries(prj.mcpServers)) {
              serverDefs[name] = { ...(serverDefs[name] || {}), ...(def as object) };
            }
          }
        } catch {
          /* noop */
        }
      }
    }

    // 3. Caché de herramientas
    let cacheServers: Record<string, { tools?: unknown[] }> = {};
    if (fs.existsSync(cachePath)) {
      try {
        const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        if (cache?.servers && typeof cache.servers === "object") {
          cacheServers = cache.servers;
        }
      } catch {
        /* noop */
      }
    }

    const servers: McpServerDetail[] = Object.keys(serverDefs).map((name) => {
      const def = serverDefs[name];
      const disabled = def?.disabled === true;
      const toolsCount = Array.isArray(cacheServers[name]?.tools)
        ? cacheServers[name].tools.length
        : undefined;
      return {
        name,
        disabled,
        toolsCount,
      };
    });

    const enabledCount = servers.filter((s) => !s.disabled).length;
    const disabledCount = servers.filter((s) => s.disabled).length;

    cachedMcpInfo = { totalCount: servers.length, enabledCount, disabledCount, servers };
    return cachedMcpInfo;
  } catch {
    return cachedMcpInfo;
  }
}

/**
 * Limpia y reestructura las líneas del card Status según la referencia visual:
 * - Títulos a la izquierda, valores a la derecha justificados.
 * - Información completa de Project, Branch (), Model (con effort) y Changes.
 * - Divisores tenues ─ entre secciones.
 * - Sección Usage: muestra la cuota activa (en modo 2 líneas o expandido).
 * - Clic en [abrir /quota ↗] abre el modal de cuotas.
 * - Clic en [5h / semanal] alterna entre vista compacta y expandida con barras.
 * - Sección MCPs con lista de cada servidor habilitado y conteo de tools.
 */
function cleanStatusCardLines(lines: string[], innerWidth: number, tui?: TUI): string[] {
  let projectCwd = "";
  let branchLine = "";
  let changesLine = "";
  let detectedModelId = "";
  let detectedEffort = "";
  let detectedProfile = "";
  const integrationLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const bare = raw.replace(ANSI_RE, "").trim();
    if (!bare) continue;

    // Detectar modelo para la consulta de cuota y visualización
    if (/^model\s+/i.test(bare)) {
      detectedModelId = bare.replace(/^model\s+/i, "").trim();
      continue;
    }

    // Detectar esfuerzo / thinking level
    if (/^effort\s+/i.test(bare)) {
      detectedEffort = bare.replace(/^effort\s+/i, "").trim();
      continue;
    }

    // Detectar perfil si viene informado por gentle-pi
    if (/^profile\s+/i.test(bare)) {
      detectedProfile = bare.replace(/^profile\s+/i, "").trim();
      continue;
    }

    // Ruta del proyecto
    if (bare.startsWith("~/") || (bare.startsWith("/") && !bare.includes("gentle:changes"))) {
      projectCwd = bare;
      continue;
    }

    // Rama git
    if (/^branch\s+/i.test(bare)) {
      branchLine = bare;
      continue;
    }

    // Cambios (archivos modificados)
    if (/\bfiles?\s*·/i.test(bare) || (/^changes\b/i.test(bare) && bare.includes("file"))) {
      changesLine = bare;
      continue;
    }

    // Integraciones (MCPs, sessions, LSP, etc. excepto face)
    if (!isFaceLine(raw)) {
      if (
        bare.startsWith("@") ||
        bare.startsWith("🔌") ||
        /mcp:/i.test(bare) ||
        /servers enabled/i.test(bare) ||
        /lsp\b/i.test(bare) ||
        /connected\)/i.test(bare)
      ) {
        integrationLines.push(raw.trim());
      }
    }
  }

  // Disparar la consulta en segundo plano de la cuota del modelo activo
  const activeModel = detectedModelId || currentCtx?.model?.id;
  if (activeModel) {
    triggerActiveQuotaFetch(activeModel, tui);
  }

  // Colores Dc-Sangre / Palette helpers
  const bloodBright = (t: string) => `\x1b[38;2;255;51;51m${t}\x1b[0m`;
  const bloodMid = (t: string) => `\x1b[38;2;255;77;77m${t}\x1b[0m`;
  const bloodSoft = (t: string) => `\x1b[38;2;255;128;128m${t}\x1b[0m`;
  const bloodWhite = (t: string) => `\x1b[38;2;255;204;204m${t}\x1b[0m`;
  const dim = (t: string) => `\x1b[2m${t}\x1b[22m`;
  const bold = (t: string) => `\x1b[1m${t}\x1b[22m`;

  const divider = dim("─".repeat(innerWidth));
  const out: string[] = [];

  // 1. Bloque Project & Branch & Changes
  const branchVal = branchLine.replace(/^branch\s+/i, "").trim() || "master";
  const cleanBranch = branchVal.replace(/^\s*/, "");
  const branchDisplay = ` ${cleanBranch}`;

  out.push(justifyRow(` 📁 ${bloodBright(bold("Project"))}`, `${bloodWhite(projectCwd || "~/dc-lab/lab-00")} `, innerWidth));
  out.push(justifyRow(` 🗂️ ${bloodSoft("Branch")}`, `${bloodWhite(branchDisplay)} `, innerWidth));

  const cleanChanges = changesLine ? changesLine.replace(/^changes\s+/i, "").trim() : "";
  if (cleanChanges) {
    out.push(justifyRow(` 📂 ${bloodBright(bold("Changes"))}`, `${bloodMid(cleanChanges)} ${dim("[↗]")} `, innerWidth));
  } else {
    out.push(justifyRow(` 📂 ${bloodSoft("Changes")}`, `${dim("sin cambios")} ${dim("[↗]")} `, innerWidth));
  }
  out.push(divider);

  // 2. Bloque Sesión & LSP (justo después de Project)
  let detectedLsp = "";
  let detectedSession = "";
  const otherIntegrationLines: string[] = [];

  for (const item of integrationLines) {
    const plain = item.replace(ANSI_RE, "").trim();
    if (!plain) continue;
    if (/mcp:/i.test(plain) || /servers enabled/i.test(plain)) {
      continue;
    }
    if (/lsp\b/i.test(plain)) {
      detectedLsp = plain;
    } else if (plain.startsWith("@") || (!plain.startsWith("📁") && !plain.startsWith("🗂️") && plain.includes("ready"))) {
      detectedSession = plain.replace(/^@\s*/, "");
    } else {
      otherIntegrationLines.push(item);
    }
  }

  // 2.1 Sesión
  if (detectedSession) {
    out.push(` 🧠 ${bloodWhite(detectedSession)}`);
  } else {
    const projName = projectCwd ? path.basename(projectCwd) : "lab-00";
    out.push(` 🧠 ${bloodWhite(projName)} ${dim("· ready")}`);
  }

  // 2.2 LSP con icono [📚]
  if (detectedLsp) {
    const isErr = /failed|crash|error/i.test(detectedLsp);
    const lspCleaned = detectedLsp
      .replace(/^[⚡📚]\s*/, "")
      .replace(/^lsp\s*active:\s*/i, "")
      .replace(/^lsp:\s*/i, "")
      .replace(/^lsp\b\s*/i, "")
      .replace(/\s*\(\d+\s*(?:diagnostics?|errors?|warnings?)\)/gi, "")
      .trim();
    lastDetectedLspStatus = lspCleaned || (isErr ? "error" : "activo");
    const badge = isErr ? bloodBright("[error]") : bloodBright("[activo]");
    const textStyle = isErr ? bloodSoft(lspCleaned) : bloodWhite(lspCleaned || "activo");
    out.push(
      justifyRow(
        ` 📚 ${bloodBright(bold("LSP:"))} ${textStyle}`,
        `${badge} `,
        innerWidth,
      ),
    );
  } else {
    lastDetectedLspStatus = "";
    out.push(
      justifyRow(
        ` 📚 ${bloodBright(bold("LSP:"))} ${bloodSoft("inactivo")}`,
        `${dim("[off]")} `,
        innerWidth,
      ),
    );
  }

  for (const other of otherIntegrationLines) {
    out.push(` ${bloodSoft(other)}`);
  }
  out.push(divider);

  // 3. Bloque Quota (Desplegable de Quota + Desplegable individual por cuenta)
  const quotaAccounts = getActiveAccounts(detectedModelId || currentCtx?.model?.id);
  const primaryPfx = quotaAccounts[0] || (detectedModelId ? detectedModelId.split("/")[0]! : "ac06");
  const quotaArrow = quotaExpanded ? "▲" : "▼";

  // Datos reales de la cuenta principal para la cabecera:
  // Cuando está cerrado (▼) muestra el tag compacto pfx-5h%-sem%
  // Cuando está abierto (▲) solo muestra la palabra "Quota:" para máxima limpieza
  const qPrim = activeQuotaMap.get(primaryPfx) || (primaryPfx === activeQuotaCacheData?.prefix ? activeQuotaCacheData : null);
  const p5h = qPrim?.pct5h !== undefined ? Math.round(qPrim.pct5h) : null;
  const pWk = qPrim?.pctWeek !== undefined ? Math.round(qPrim.pctWeek) : null;
  const metricsTag = p5h !== null && pWk !== null ? `-${p5h}%-${pWk}%` : "";
  const primaryDisplay = `${primaryPfx}${metricsTag}`;

  let quotaHeaderLeft = ` 🧮 ${bloodBright(bold("Quota:"))}`;
  if (!quotaExpanded) {
    const accountsLabel = quotaAccounts.length > 1
      ? `${bloodWhite(bold(primaryDisplay))} ${bloodSoft(`+${quotaAccounts.length - 1}`)}`
      : `${bloodWhite(bold(primaryDisplay))}`;
    quotaHeaderLeft = `${quotaHeaderLeft} ${accountsLabel}`;
  }

  out.push(
    justifyRow(
      quotaHeaderLeft,
      `${dim("[↗]")} ${bloodBright(quotaArrow)} `,
      innerWidth,
    ),
  );

  if (quotaExpanded) {
    for (let i = 0; i < quotaAccounts.length; i++) {
      const pfx = quotaAccounts[i]!;
      const isAccExpanded = expandedAccounts.has(pfx);
      const accArrow = isAccExpanded ? "▲" : "▼";
      const q = activeQuotaMap.get(pfx) || (pfx === activeQuotaCacheData?.prefix ? activeQuotaCacheData : null);
      const fam = q?.familyName || "Gemini";
      const pct5h = q?.pct5h ?? 100;
      const pctWeek = q?.pctWeek ?? 100;
      const r5h = q?.reset5h ? ` · ${q.reset5h}` : "";
      const rWeek = q?.resetWeek ? ` · ${q.resetWeek}` : "";

      out.push(
        justifyRow(
          `   🎚️ ${bloodWhite(bold(pfx))} ${bloodSoft(`(${fam})`)}`,
          `${bloodBright(accArrow)} ${bloodSoft("5h / semanal")} `,
          innerWidth,
        ),
      );

      if (isAccExpanded) {
        // Modo desplegado de esta cuenta: barras individuales detalladas
        const filled5h = Math.round((pct5h / 100) * 8);
        const bar5h = bloodBright("▰".repeat(filled5h)) + dim("▱".repeat(8 - filled5h));
        const filledW = Math.round((pctWeek / 100) * 8);
        const barW = bloodBright("▰".repeat(filledW)) + dim("▱".repeat(8 - filledW));

        out.push(justifyRow(`     ${bloodSoft("5h:")}`, `${bar5h} ${bloodWhite(pct5h + "%")}${dim(r5h)} `, innerWidth));
        out.push(justifyRow(`     ${bloodSoft("Sem:")}`, `${barW} ${bloodWhite(pctWeek + "%")}${dim(rWeek)} `, innerWidth));
      } else {
        // Modo compacto de esta cuenta: barra de 5h + % semanal
        const filled = Math.round((pct5h / 100) * 8);
        const bar = bloodBright("▰".repeat(filled)) + dim("▱".repeat(8 - filled));
        out.push(
          justifyRow(
            `     ${bloodSoft("Restante")}`,
            `${bar} ${bloodWhite(pct5h + "%")} ${bloodSoft("sem")} ${bloodWhite(pctWeek + "%")} `,
            innerWidth,
          ),
        );
      }

      if (i < quotaAccounts.length - 1) {
        out.push("");
      }
    }
    out.push(justifyRow(`   ⚙️ ${dim("Gestor /quota")}`, `${dim("[abrir ↗]")} `, innerWidth));
  }
  out.push(divider);

  // 4. Bloque Profile (Desplegable)
  const profInfo = getEffectiveActiveProfile(currentCtx?.sessionManager?.getCwd?.(), detectedProfile);
  const profArrow = profileExpanded ? "▲" : "▼";
  const pinBadge = profInfo.pinned ? dim(" (pin)") : "";

  let profileHeaderLeft = ` ${bloodWhite("🎛️")} ${bloodBright(bold("Profile:"))}`;
  if (!profileExpanded) {
    profileHeaderLeft = `${profileHeaderLeft} ${bloodWhite(profInfo.active)}${pinBadge}`;
  }

  out.push(
    justifyRow(
      profileHeaderLeft,
      `${dim("[↗]")} ${bloodBright(profArrow)} `,
      innerWidth,
    ),
  );

  if (profileExpanded) {
    if (profInfo.profiles.length > 0) {
      for (const pName of profInfo.profiles) {
        const isActive = pName === profInfo.active;
        const bullet = isActive ? bloodBright("●") : dim("○");
        const nameText = isActive ? bloodBright(bold(pName)) : bloodSoft(pName);
        const actionText = isActive ? bloodBright("[activo]") : dim("[cambiar]");
        out.push(justifyRow(`   ${bullet} ${nameText}`, `${actionText} `, innerWidth));
      }
    } else {
      out.push(justifyRow(`   ${bloodBright("●")} ${bloodSoft(profInfo.active || "default")}`, `${bloodBright("[activo]")} `, innerWidth));
    }
    out.push(justifyRow(`   ⚙️ ${dim("Gestor /gentle:profiles")}`, `${dim("[abrir ↗]")} `, innerWidth));
  }
  out.push(divider);

  // 5. Detalle de servidores MCP (Desplegable)
  const mcpInfo = getMcpServersInfo(currentCtx?.sessionManager?.getCwd?.());
  const mcpArrow = mcpExpanded ? "▲" : "▼";

  let mcpHeaderLeft = ` ${bloodWhite("🔌")} ${bloodBright(bold("MCP:"))}`;
  if (!mcpExpanded) {
    if (mcpInfo.disabledCount > 0) {
      mcpHeaderLeft = `${mcpHeaderLeft} ${bloodSoft(`${mcpInfo.enabledCount} enabled`)} ${dim(`· ${mcpInfo.disabledCount} disabled`)}`;
    } else {
      mcpHeaderLeft = `${mcpHeaderLeft} ${bloodSoft(`${mcpInfo.enabledCount || mcpInfo.totalCount} servers enabled`)}`;
    }
  }

  out.push(
    justifyRow(
      mcpHeaderLeft,
      `${dim("[↗]")} ${bloodBright(mcpArrow)} `,
      innerWidth,
    ),
  );

  const grayLight = (t: string) => `\x1b[38;2;150;150;150m${t}\x1b[0m`;

  if (mcpExpanded) {
    if (mcpInfo.servers.length > 0) {
      for (const s of mcpInfo.servers) {
        if (s.disabled) {
          out.push(
            justifyRow(
              `   ${grayLight("○")} ${grayLight(s.name)}`,
              `${grayLight("disabled")} `,
              innerWidth,
            ),
          );
        } else {
          const toolText = s.toolsCount !== undefined ? `${s.toolsCount} ${s.toolsCount === 1 ? "tool" : "tools"}` : "";
          out.push(
            justifyRow(
              `   ${bloodSoft("●")} ${bloodWhite(s.name)}`,
              `${dim(toolText)} `,
              innerWidth,
            ),
          );
        }
      }
    } else {
      out.push(justifyRow(`   ${bloodSoft("●")} ${bloodWhite("codegraph")}`, `${dim("1 tool")} `, innerWidth));
      out.push(justifyRow(`   ${bloodSoft("●")} ${bloodWhite("context7")}`, `${dim("2 tools")} `, innerWidth));
      out.push(justifyRow(`   ${grayLight("○")} ${grayLight("engram")}`, `${grayLight("disabled")} `, innerWidth));
    }
    out.push(justifyRow(`   ⚙️ ${dim("Gestor /mcp")}`, `${dim("[abrir ↗]")} `, innerWidth));
  }

  return out;
}

async function openContextModal(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI || ctx.mode !== "tui") return;
  await ctx.ui.custom<void>(
    (tui, theme, _kb, done) => {
      const content = {
        render: (width: number) => renderContextBox(tui, width),
        invalidate: () => {},
        handleInput: (data: string) => {
          if (data === "\x1b" || data === "q" || data === "Q" || data === "\r" || data === " ") {
            done();
            return { handled: true };
          }
          return undefined;
        },
        handleMouse: (event: any) => {
          if (event?.type === "click") {
            done();
            return { handled: true };
          }
          return undefined;
        },
      };
      return new DcWindow({
        title: () => "Contexto de la Sesión",
        glyph: "🪧",
        theme,
        content,
        onClose: () => done(),
        footer: "esc / q / clic: cerrar · dc studio",
        paddingX: 0,
        frame: "double",
      });
    },
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "50%", maxHeight: "50%" },
    },
  );
}

/**
 * Convierte las líneas del card Status (borde redondeado + título en el borde)
 * al chrome de DcWindow: marco doble + barra de título rellena con el título.
 */
function restyleCard(tui: TUI, lines: string[], width: number): string[] {
  if (lines.length < 3) return lines;
  const inner = Math.max(0, width - 2);
  const theme = getTheme?.();
  const b = (s: string) => colored(tui, s);
  const visOf = (s: string) => s.replace(ANSI_RE, "");

  // El card puede NO empezar en lines[0] (algunos traen una línea previa).
  const topIdx = lines.findIndex((l) => /[╭┌]/.test(visOf(l)));
  let botIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/[╰└]/.test(visOf(lines[i]))) { botIdx = i; break; }
  }
  if (topIdx < 0 || botIdx <= topIdx) return lines; // no parece un card → no tocar

  const title = withCardGlyph(visOf(lines[topIdx]).replace(/[╭╮╰╯┌┐└┘─═│║]/g, "").trim() || "Card");

  let rawContents = lines.slice(topIdx + 1, botIdx).map((l) => {
    const toks = tokens(l);
    const vis = visibleIndexes(toks);
    if (vis.length >= 2) {
      toks[vis[0]] = "";
      toks[vis[vis.length - 1]] = "";
    }
    return toks.join("");
  });

  if (/status/i.test(title)) {
    rawContents = cleanStatusCardLines(rawContents, inner, tui);
    const changesLines: number[] = [];
    const quotaToggleLines: number[] = [];
    const quotaManageLines: number[] = [];
    const accountToggleMap = new Map<number, string>();
    const profileToggleLines: number[] = [];
    const profileItemMap = new Map<number, string>();
    const profileManageLines: number[] = [];
    const lspLines: number[] = [];
    const mcpLines: number[] = [];
    const mcpManageLines: number[] = [];
    const currentProfInfo = getEffectiveActiveProfile(currentCtx?.sessionManager?.getCwd?.());
    const quotaAccounts = getActiveAccounts(currentCtx?.model?.id);

    for (let i = 0; i < rawContents.length; i++) {
      const yPrimary = 3 + i;
      const yAlt = 1 + i;
      const ys = [yPrimary, yAlt];
      const plain = rawContents[i].replace(ANSI_RE, "");

      // Prioridad 1: Changes (abrir modal interactivo de diffs)
      if (plain.includes("Changes") || plain.includes("/changes")) {
        changesLines.push(...ys);
      } else if (plain.includes("Profile:")) {
        profileToggleLines.push(...ys);
      } else if (plain.includes("Gestor /gentle:profiles") || plain.includes("Gestionar perfiles")) {
        profileManageLines.push(...ys);
      } else if (profileExpanded && (plain.includes("[cambiar]") || plain.includes("[activo]"))) {
        for (const pName of currentProfInfo.profiles) {
          if (plain.includes(pName)) {
            for (const y of ys) {
              profileItemMap.set(y, pName);
            }
            break;
          }
        }
      } else if (plain.includes("Quota:")) {
        quotaToggleLines.push(...ys);
      } else if (plain.includes("Gestor /quota")) {
        quotaManageLines.push(...ys);
      } else if (quotaExpanded && (plain.includes("5h / semanal") || plain.includes("Restante") || plain.includes("5h:") || plain.includes("Sem:") || plain.includes("🎚️"))) {
        for (const accPfx of quotaAccounts) {
          if (plain.includes(accPfx)) {
            for (const y of ys) {
              accountToggleMap.set(y, accPfx);
            }
            break;
          }
        }
      } else if (plain.includes("LSP:")) {
        lspLines.push(...ys);
      } else if (plain.includes("Gestor /mcp")) {
        mcpManageLines.push(...ys);
      } else if (plain.includes("MCP:")) {
        mcpLines.push(...ys);
      } else if (mcpExpanded && (plain.includes("tool") || plain.includes("tools") || plain.includes("disabled") || plain.includes("codegraph") || plain.includes("context7") || plain.includes("engram"))) {
        mcpLines.push(...ys);
      }
    }

    statusClickTargets.changesModalY = changesLines;
    statusClickTargets.quotaToggleY = quotaToggleLines;
    statusClickTargets.quotaManageY = quotaManageLines;
    statusClickTargets.accountToggleMap = accountToggleMap;
    statusClickTargets.profileToggleY = profileToggleLines;
    statusClickTargets.profileItemMap = profileItemMap;
    statusClickTargets.profileManageY = profileManageLines;
    statusClickTargets.lspLineY = lspLines;
    statusClickTargets.mcpToggleY = mcpLines;
    statusClickTargets.mcpManageY = mcpManageLines;
  }

  const body = rawContents.map((content) => {
    const cv = visibleWidth(content);
    const cell = cv > inner ? truncateToWidth(content, inner, "") : content + " ".repeat(inner - cv);
    return b(FRAME.v) + cell + b(FRAME.v);
  });

  const top = b(FRAME.tl + FRAME.h.repeat(inner) + FRAME.tr);
  const rule = b("\u2560" + FRAME.h.repeat(inner) + "\u2563");
  const bottom = b(FRAME.bl + FRAME.h.repeat(inner) + FRAME.br);

  const label = ` ${title} `;
  const text = theme ? theme.fg("accent", label) : label;
  const v = visibleWidth(text);
  const pad = Math.max(0, inner - v);
  const left = Math.floor(pad / 2);
  const padded = " ".repeat(left) + text + " ".repeat(pad - left);
  const titleBar = b(FRAME.v) + (theme ? theme.bg("selectedBg", padded) : padded) + b(FRAME.v);

  return [...lines.slice(0, topIdx), top, titleBar, rule, ...body, bottom, ...lines.slice(botIdx + 1)];
}

// ── Escala de 4 niveles de contexto (DC Studio) ───────────────────────────
// [Óptimo]  0-40%:  Blanco (#ffffff)
// [Medio]   41-60%: Rosa pálido (#ffa8a8)
// [Alto]    61-80%: Rojo suave (#ff7878)
// [Crítico] >80%:   Rojo neón intermitente / pulsante + alerta Herdr

const COLOR_CTX_OPTIMAL = "\x1b[38;2;255;255;255m"; // Blanco
const COLOR_CTX_MEDIUM  = "\x1b[38;2;255;170;170m"; // Rosa pálido
const COLOR_CTX_HIGH    = "\x1b[38;2;255;120;120m"; // Rojo suave

// Destello / pulso senoidal de rojo neón eléctrico para nivel Crítico
const NEON_PULSE_FRAMES = [
  "\x1b[38;2;255;15;50m",
  "\x1b[38;2;255;40;70m",
  "\x1b[38;2;255;15;50m",
  "\x1b[38;2;230;10;40m",
  "\x1b[38;2;190;5;30m",
  "\x1b[38;2;150;0;20m",
  "\x1b[38;2;110;0;15m",
  "\x1b[38;2;150;0;20m",
  "\x1b[38;2;190;5;30m",
  "\x1b[38;2;230;10;40m",
  "\x1b[38;2;255;15;50m",
  "\x1b[38;2;255;50;80m",
];

let sidebarPulseTick = 0;
let sidebarPulseTimer: NodeJS.Timeout | null = null;

function ensureSidebarPulseTimer(requestRender: () => void): void {
  if (!sidebarPulseTimer) {
    sidebarPulseTimer = setInterval(() => {
      sidebarPulseTick = (sidebarPulseTick + 1) % NEON_PULSE_FRAMES.length;
      requestRender();
    }, 100);
    sidebarPulseTimer.unref?.();
  }
}

function stopSidebarPulseTimer(): void {
  if (sidebarPulseTimer) {
    clearInterval(sidebarPulseTimer);
    sidebarPulseTimer = null;
    sidebarPulseTick = 0;
  }
}

const G_CTX_ALERT = Symbol.for("dc.context.critical-alerted");

function checkContextCriticalNotification(pct: number): void {
  const state = globalThis as unknown as Record<symbol, boolean>;
  if (pct >= 81) {
    if (!state[G_CTX_ALERT]) {
      state[G_CTX_ALERT] = true;
      notifyHerdr(
        "⚠ Contexto Crítico",
        `Uso de contexto al ${Math.round(pct)}%. Considerá compactar o reiniciar la sesión.`,
      );
    }
  } else if (pct < 75) {
    state[G_CTX_ALERT] = false;
  }
}

function renderContextBox(tui: TUI, width: number): string[] {
  const fw = Math.max(6, width);
  const inner = Math.max(0, fw - 2);

  // Datos reales desde currentCtx
  const ctx = currentCtx;
  const usage = ctx?.getContextUsage?.();
  const tokensUsed = usage?.tokens ?? 0;
  const totalWindow = usage?.contextWindow ?? (ctx?.model?.contextWindow || 1048576);
  const pct = Math.max(0, Math.min(100, Math.round((tokensUsed / (totalWindow || 1)) * 100)));

  // I/O & Cost acumulado de la sesión
  let inTokens = 0;
  let outTokens = 0;
  let costTotal = 0;
  if ((ctx as any)?.sessionManager?.getEntries) {
    for (const e of (ctx as any).sessionManager.getEntries()) {
      if (e?.type === "message" && e?.message?.role === "assistant" && e?.message?.usage) {
        const u = e.message.usage;
        inTokens += (u.input || 0) + (u.cacheRead || 0);
        outTokens += (u.output || 0);
        if (u.cost?.total) costTotal += u.cost.total;
      }
    }
  }

  // Estado dinámico y colores del tema Dc-Sangre según el % de contexto (4 niveles)
  let stateLabel = "Óptimo";
  let stateColor = (t: string) => `${COLOR_CTX_OPTIMAL}${t}\x1b[0m`;

  if (pct > 80) {
    stateLabel = "Crítico";
    checkContextCriticalNotification(pct);
    ensureSidebarPulseTimer(() => (tui || tuiRef)?.requestRender());
    const neonColor = NEON_PULSE_FRAMES[sidebarPulseTick % NEON_PULSE_FRAMES.length]!;
    stateColor = (t: string) => `${neonColor}${t}\x1b[0m`;
  } else {
    stopSidebarPulseTimer();
    if (pct > 60) {
      stateLabel = "Alto";
      stateColor = (t: string) => `${COLOR_CTX_HIGH}${t}\x1b[0m`;
    } else if (pct > 40) {
      stateLabel = "Medio";
      stateColor = (t: string) => `${COLOR_CTX_MEDIUM}${t}\x1b[0m`;
    }
  }

  const bloodWhite = (t: string) => `\x1b[38;2;255;204;204m${t}\x1b[0m`;
  const bloodSoft = (t: string) => `\x1b[38;2;255;128;128m${t}\x1b[0m`;
  const dim = (t: string) => `\x1b[2m${t}\x1b[22m`;
  const bold = (t: string) => `\x1b[1m${t}\x1b[22m`;

  const tokStr = tokensUsed >= 1e6 ? `${(tokensUsed / 1e6).toFixed(1)}M` : `${Math.round(tokensUsed / 1e3)}k`;
  const winStr = totalWindow >= 1e6 ? `${(totalWindow / 1e6).toFixed(1)}M` : `${Math.round(totalWindow / 1e3)}k`;

  // Fila 1: Tokens usados / límite (izq) y Estado dinámico con [pct%] (der)
  const left1 = ` ${bloodWhite(tokStr)} ${dim("/")} ${bloodSoft(winStr + " tokens")}`;
  const right1 = `${stateColor(`● ${stateLabel}`)} ${stateColor(bold(`[${pct}%]`))} `;
  const line1 = justifyRow(left1, right1, inner);

  // Fila 2: Barra de progreso a TODO lo ancho de la tarjeta
  const barWidth = Math.max(10, inner - 2);
  const filled = Math.round((pct / 100) * barWidth);
  const bar = stateColor("▰".repeat(filled)) + dim("▱".repeat(barWidth - filled));
  const line2 = ` ${bar} `;

  // Fila 3: Tráfico I/O acumulado (izq) y Costo de la sesión (der)
  const inStr = inTokens >= 1e6 ? `${(inTokens / 1e6).toFixed(1)}M` : `${Math.round(inTokens / 1e3)}k`;
  const outStr = outTokens >= 1e6 ? `${(outTokens / 1e6).toFixed(1)}M` : `${Math.round(outTokens / 1e3)}k`;
  const left3 = ` ${bloodSoft("↑")} ${bloodWhite(inStr + " in")} ${dim("·")} ${bloodSoft("↓")} ${bloodWhite(outStr + " out")}`;
  const costStr = `$${costTotal.toFixed(2)}`;
  const right3 = `${bloodSoft("Cost")} ${bloodWhite(costStr)} `;
  const line3 = justifyRow(left3, right3, inner);

  const rawContents = [line1, line2, line3];

  const b = (s: string) => colored(tui, s);
  const theme = getTheme?.();
  const title = withCardGlyph("Context");
  const label = ` ${title} `;
  const text = theme ? theme.fg("accent", label) : label;
  const v = visibleWidth(text);
  const pad = Math.max(0, inner - v);
  const left = Math.floor(pad / 2);
  const padded = " ".repeat(left) + text + " ".repeat(pad - left);
  const titleBar = b(FRAME.v) + (theme ? theme.bg("selectedBg", padded) : padded) + b(FRAME.v);

  const top = b(FRAME.tl + FRAME.h.repeat(inner) + FRAME.tr);
  const rule = b("\u2560" + FRAME.h.repeat(inner) + "\u2563");
  const bottom = b(FRAME.bl + FRAME.h.repeat(inner) + FRAME.br);

  const body = rawContents.map((content) => {
    const cv = visibleWidth(content);
    const cell = cv > inner ? truncateToWidth(content, inner, "") : content + " ".repeat(inner - cv);
    return b(FRAME.v) + cell + b(FRAME.v);
  });

  return [top, titleBar, rule, ...body, bottom];
}

/** Card de Contexto en el sidebar: estilizado con DcWindow y métricas en vivo. */
function contextCardComponent(tui: TUI): Component {
  return {
    render: (width: number): string[] => {
      try {
        const pad = 1;
        const fw = Math.max(6, width - pad * 2);
        const framed = renderContextBox(tui, fw);
        return framed.map((l) => {
          const v = visibleWidth(l);
          const clipped = v > fw ? truncateToWidth(l, fw, "") : l;
          const s = " ".repeat(pad) + clipped;
          const sw = visibleWidth(s);
          const padded = sw < width ? s + " ".repeat(width - sw) : s;
          return visibleWidth(padded) > width ? truncateToWidth(padded, width, "") : padded;
        });
      } catch {
        return [];
      }
    },
    invalidate: () => {},
  };
}

/** Cards del rail que llevan el chrome DcWindow: Status, Changes, Agents y Todos. */
const CARD_KEYS = ["footer", "changes", "agents", "todo"] as const;
const PARTS_HOOKED = Symbol.for("dc.sidebar.parts-hooked-v2");
const G_STYLE = Symbol.for("dc.sidebar.style-fn");

/** Aplica el chrome DcWindow a UNA parte del rail (si es de las nuestras). */
function styleOnePart(tui: TUI, key: string, part: unknown): void {
  try {
    if (!CARD_KEYS.includes(key as never)) return;
    const p = part as (Component & Record<symbol, unknown>) | undefined;
    if (!p || typeof p.render !== "function") return;
    // Re-estilizar en cada arranque con el módulo/ctx vigente: si ya estaba
    // estilizada, restaurar el render ORIGINAL guardado (no apilar wrappers).
    const prevOrig = p[CARD_ORIG] as ((w: number) => string[]) | undefined;
    if (p[CARD_STYLED] && prevOrig) p.render = prevOrig;
    (p as Record<symbol, boolean>)[CARD_STYLED] = true;
    const orig = p.render.bind(p);
    (p as Record<symbol, unknown>)[CARD_ORIG] = orig;
    p.render = (width: number) => {
      // El render ORIGINAL de gentle-pi puede tirar durante la transición de
      // /reload; si se propaga, gentle-pi marca prepare().failed PEGAJOSO y
      // rompe TODOS los componentes del sidebar. Nunca propagamos.
      let origLines: string[] = [];
      try {
        origLines = orig(width);
      } catch (e) {
        trace("orig-error:" + key + ":" + String(e));
        return [];
      }
      try {
        const pad = 1;
        const fw = Math.max(6, width - pad * 2);
        const framed = restyleCard(tui, orig(fw), fw);
        const ctxBox = key === "footer" ? renderContextBox(tui, fw) : [];
        if (key === "footer") {
          statusClickTargets.contextCardStartY = Math.max(12, framed.length - 2);
        }
        const allFramed = ctxBox.length > 0 ? [...framed, "", ...ctxBox] : framed;
        const out = allFramed.map((l) => {
          const v = visibleWidth(l);
          const clipped = v > fw ? truncateToWidth(l, fw, "") : l;
          const s = " ".repeat(pad) + clipped;
          const sw = visibleWidth(s);
          const padded = sw < width ? s + " ".repeat(width - sw) : s;
          return visibleWidth(padded) > width ? truncateToWidth(padded, width, "") : padded;
        });
        return out;
      } catch (e) {
        trace("card-error:" + key + ":" + String(e));
        return origLines;
      }
    };

    // Agregar soporte de clic de mouse para el Status card y Context card ("footer" en el rail)
    if (key === "footer") {
      const origDigest = (p as any).digest?.bind(p);
      (p as any).digest = () => {
        const base = origDigest ? origDigest() : "";
        return `${base}:${quotaExpanded}:${mcpExpanded}:${profileExpanded}:${[...expandedAccounts].sort().join(",")}`;
      };

      const origHandleMouse = p.handleMouse?.bind(p);
      p.handleMouse = (event: unknown) => {
        try {
          const e = event as { type?: string; button?: string; y?: number };
          if (e.type === "click" && (e.button ?? "left") === "left") {
            const y = typeof e.y === "number" ? e.y : -1;
            // Si el clic es en la tarjeta de Contexto (hacia el final del bloque footer) -> abrir modal /context
            if (y >= statusClickTargets.contextCardStartY) {
              const ctx = currentCtx || ((globalThis as unknown as Record<symbol, unknown>)[G_CTX] as ExtensionContext | undefined);
              if (ctx) void openContextModal(ctx);
              return { handled: true };
            }
            // Si el clic es en la línea de Changes -> abrir visor interactivo de diffs
            if (statusClickTargets.changesModalY.includes(y)) {
              openChangesModal(currentCtx);
              return { handled: true };
            }
            // Si el clic es en la cabecera de Profile -> si clic a la derecha abrir gestor, si no toggle
            if (statusClickTargets.profileToggleY.includes(y)) {
              const x = (e as { x?: number }).x;
              if (typeof x === "number" && x > 28) {
                void openProfilesManager(currentCtx);
              } else {
                profileExpanded = !profileExpanded;
                bumpCache(tui);
                tui.requestRender();
              }
              return { handled: true };
            }
            // Si el clic es en Gestor /gentle:profiles -> abrir gestor completo
            if (statusClickTargets.profileManageY.includes(y)) {
              void openProfilesManager(currentCtx);
              return { handled: true };
            }
            // Si el clic es en un perfil de la lista desplegable -> cambiar perfil rápido
            if (statusClickTargets.profileItemMap.has(y)) {
              const targetProf = statusClickTargets.profileItemMap.get(y);
              if (targetProf) {
                void switchProfile(targetProf, tui);
                return { handled: true };
              }
            }
            // Si el clic es en la línea de LSP
            if (statusClickTargets.lspLineY.includes(y)) {
              const ctx = currentCtx || ((globalThis as unknown as Record<symbol, unknown>)[G_CTX] as ExtensionContext | undefined);
              ctx?.ui?.notify?.(
                lastDetectedLspStatus ? `LSP activo: ${lastDetectedLspStatus}` : "LSP: Inactivo (no hay servidor de lenguaje conectado)",
                lastDetectedLspStatus ? "info" : "warning",
              );
              return { handled: true };
            }
            // Si el clic es en Gestor /mcp -> abrir gestor MCP
            if (statusClickTargets.mcpManageY.includes(y)) {
              openMcpManager(currentCtx);
              return { handled: true };
            }
            // Si el clic es en la sección MCP -> si clic a la derecha en [↗] abre gestor /mcp, si no toggle
            if (statusClickTargets.mcpToggleY.includes(y)) {
              const x = (e as { x?: number }).x;
              if (typeof x === "number" && x > 28) {
                openMcpManager(currentCtx);
              } else {
                mcpExpanded = !mcpExpanded;
                bumpCache(tui);
                tui.requestRender();
              }
              return { handled: true };
            }
            // Si el clic es en la cabecera de Quota -> si clic a la derecha en [↗] abre modal /quota, si no toggle desplegable
            if (statusClickTargets.quotaToggleY.includes(y)) {
              const x = (e as { x?: number }).x;
              if (typeof x === "number" && x > 28) {
                const openFn = (globalThis as unknown as Record<symbol, unknown>)[G_OPEN_QUOTA] as (() => void) | undefined;
                openFn?.();
              } else {
                quotaExpanded = !quotaExpanded;
                bumpCache(tui);
                tui.requestRender();
              }
              return { handled: true };
            }
            // Si el clic es en Gestor /quota -> abrir modal /quota
            if (statusClickTargets.quotaManageY.includes(y)) {
              const openFn = (globalThis as unknown as Record<symbol, unknown>)[G_OPEN_QUOTA] as (() => void) | undefined;
              openFn?.();
              return { handled: true };
            }
            // Si el clic es en una cuenta individual dentro de Quota -> toggle de esa cuenta
            if (statusClickTargets.accountToggleMap.has(y)) {
              const pfx = statusClickTargets.accountToggleMap.get(y)!;
              if (expandedAccounts.has(pfx)) {
                expandedAccounts.delete(pfx);
              } else {
                expandedAccounts.add(pfx);
              }
              bumpCache(tui);
              tui.requestRender();
              return { handled: true };
            }
          }
        } catch {
          /* noop */
        }
        return origHandleMouse?.(event as any);
      };
    }
  } catch {
    /* noop */
  }
}

let savedHeaderRail: Component | undefined;

/** Engancha `parts.set`: toda parte registrada después queda estilizada. */
function hookPartsSet(parts: Map<string, Component>): void {
  if ((parts as unknown as Record<symbol, unknown>)[PARTS_HOOKED]) return;
  (parts as unknown as Record<symbol, boolean>)[PARTS_HOOKED] = true;
  const origSet = parts.set.bind(parts);
  const origGet = parts.get.bind(parts);
  const origHas = parts.has.bind(parts);

  if (origHas("header")) {
    savedHeaderRail = origGet("header");
  }

  parts.get = function (k: string) {
    if (k === "header" && prefs.headerBar !== true) {
      return undefined;
    }
    return origGet(k);
  };

  parts.has = function (k: string) {
    if (k === "header" && prefs.headerBar !== true) {
      return false;
    }
    return origHas(k);
  };

  parts.set = ((k: string, c: Component) => {
    if (k === "header") {
      savedHeaderRail = c;
    }
    const r = origSet(k, c);
    try {
      const fn = (globalThis as unknown as Record<symbol, unknown>)[G_STYLE] as
        | ((kk: string, cc: unknown) => void)
        | undefined;
      fn?.(k, c);
    } catch {
      /* noop */
    }
    return r;
  }) as typeof parts.set;
}

/** Estiliza las partes actuales y engancha `set` para las futuras. */
function styleCards(tui: TUI): void {
  try {
    const state = stateOf(tui);
    const parts = state?.parts;
    if (!parts) return;
    (globalThis as unknown as Record<symbol, unknown>)[G_STYLE] = (k: string, c: unknown) =>
      styleOnePart(tui, k, c);
    hookPartsSet(parts);
    for (const key of CARD_KEYS) styleOnePart(tui, key, parts.get(key));
  } catch {
    /* noop */
  }
}

// ── borde (wrap del layout node) ──────────────────────────────────────────

const WRAPPED = Symbol.for("dc.sidebar.frame-wrapped");
const NATIVE = Symbol.for("dc.sidebar.native-node");
const G_PREV = Symbol.for("dc.sidebar.prev-node");
const G_WRAPPER_REV = Symbol.for("dc.sidebar.wrapper-rev");
const G_WRAPPER_FN = Symbol.for("dc.sidebar.wrapper-fn");
// Rev único por carga del módulo: si el root quedó envuelto por otra instancia
// (reload), re-envolvemos con ESTE código en vez de devolver true y quedarnos
// corriendo closure vieja (era el bug: el decorador nuevo nunca se instalaba).
const MODULE_REV = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
/** El layout root guardado en globalThis: sobrevive la re-evaluación del módulo en /reload. */
const G_ROOT = Symbol.for("dc.sidebar.layout-root");
const BRAND_SUPPRESSED = Symbol.for("dc.sidebar.brand-suppressed");
const FACE_SEP = Symbol.for("dc.sidebar.face-sep");
const G_SCROLL = Symbol.for("dc.sidebar.rail-scroll");

type LayoutNodeFn = () => unknown;

// Color del marco: token del tema (Dc-Sangre.accent = bloodBright #ff3333).
const FRAME_COLOR = "accent";

function colored(tui: TUI, ch: string): string {
  try {
    const theme = getTheme?.();
    if (theme) return theme.fg(FRAME_COLOR as Parameters<Theme["fg"]>[0], ch);
  } catch {
    /* noop */
  }
  return ch;
}

function railRows(tui: TUI): number {
  const rows = (tui.terminal as unknown as { rows?: number } | undefined)?.rows;
  return Math.max(1, (typeof rows === "number" ? rows : 60) + 8);
}

/** Columna de borde vertical: rinde N filas de `║`; el layout la clipea al alto. */
function borderColumn(tui: TUI, ch: string): Component {
  const line = colored(tui, ch);
  return { render: () => new Array(railRows(tui)).fill(line), invalidate() {} };
}

function hBorder(tui: TUI, left: string, right: string, width: number): Component {
  const bar = colored(tui, FRAME.h.repeat(Math.max(0, width - 2)));
  const line = colored(tui, left) + bar + colored(tui, right);
  return { render: () => [line], invalidate() {} };
}

/** Envuelve la columna del rail (scroll + face) en un marco doble. */
/** Línea única como componente (para bordes / barra de título). */
function lineComp(line: string): Component {
  return { render: () => [line], invalidate() {} };
}

/** Barra de título estilo DcWindow: `║` + fondo + `⛩  Dc Studio` centrado + `║`. */
function titleBarLine(tui: TUI, width: number): string {
  const inner = Math.max(0, width - 2);
  const theme = getTheme?.();
  const label = `${FRAME.glyph}  Dc Studio`;
  const text = theme
    ? theme.fg("accent", `${FRAME.glyph}  `) + theme.bold(theme.fg("text", "Dc Studio"))
    : label;
  const v = visibleWidth(text);
  const painted = (() => {
    if (v > inner) return truncateToWidth(text, inner, "");
    const left = Math.floor((inner - v) / 2);
    const right = inner - v - left;
    return " ".repeat(left) + text + " ".repeat(right);
  })();
  const withBg = theme ? theme.bg("selectedBg", painted) : painted;
  return colored(tui, FRAME.v) + withBg + colored(tui, FRAME.v);
}

let railFace: Component | undefined;

/** Click en la cara → demo (lo expone dc-face en un símbolo global). */
function faceClickDemo(event: unknown): unknown {
  try {
    const e = event as { type?: string; button?: string };
    if (e.type === "click" && (e.button ?? "left") === "left") {
      const fn = (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("dc.face.demo")] as
        | (() => void)
        | undefined;
      if (typeof fn === "function") {
        fn();
        return { handled: true };
      }
    }
  } catch {
    /* noop */
  }
  return undefined;
}

/** Cara VIEJA: separador arriba + sin gutter `┃` + click. */
function wrapFaceComponent(tui: TUI, face: Component & Record<symbol, unknown>): void {
  if (typeof face.render !== "function" || face[FACE_SEP]) return;
  face[FACE_SEP] = true;
  const origFace = face.render.bind(face);
  face.render = (width: number) => [
    colored(tui, "\u2550".repeat(Math.max(0, width))),
    ...origFace(width).map((l: string) => l.replace(/\u2503/g, "")),
  ];
  (face as { handleMouse?: (e: unknown) => unknown }).handleMouse = faceClickDemo;
}

/** Cara NUEVA: gentle-pi ya no la renderiza → la tomamos de la parte "face". */
function facePartComponent(tui: TUI): Component {
  return {
    render: (width: number): string[] => {
      try {
        const lines = (stateOf(tui)?.parts.get("face")?.render(width) ?? []) as string[];
        return [colored(tui, "\u2550".repeat(Math.max(0, width))), ...lines.map((l) => l.replace(/\u2503/g, ""))];
      } catch {
        return [];
      }
    },
    invalidate(): void {
      try {
        stateOf(tui)?.parts.get("face")?.invalidate?.();
      } catch {
        /* noop */
      }
    },
    handleMouse: (event: unknown) => faceClickDemo(event),
  } as unknown as Component;
}

/** vstack[top(grow), bottom(auto)] — repone la cara abajo del scroll en la estructura nueva. */
function wrapVStack(top: Component, bottom: Component): Component {
  return {
    render: () => [] as string[],
    invalidate() {
      top.invalidate?.();
      bottom.invalidate?.();
    },
    [LAYOUT_NODE]: () => ({
      type: "vstack",
      gap: 0,
      align: "stretch",
      entries: [
        { component: top, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: bottom, basis: "auto", grow: 0, shrink: 0, minSize: 0 },
      ],
    }),
  } as unknown as Component;
}

function framedRail(tui: TUI, right: Component): Component {
  const total = RAIL_WIDTH + 2; // 1 borde de cada lado + rail
  const b = (s: string) => colored(tui, s);
  const topLine = b(FRAME.tl + FRAME.h.repeat(total - 2) + FRAME.tr);
  const ruleLine = b("\u2560" + FRAME.h.repeat(total - 2) + "\u2563"); // ╠═…═╣
  const bottomLine = b(FRAME.bl + FRAME.h.repeat(total - 2) + FRAME.br);
  const content = railFace ? wrapVStack(right, railFace) : right;
  const middle: Component = {
    render: () => [] as string[],
    invalidate() { content.invalidate?.(); },
    [LAYOUT_NODE]: () => ({
      type: "hstack",
      gap: 0,
      align: "stretch",
      entries: [
        { component: borderColumn(tui, FRAME.v), basis: 1, grow: 0, shrink: 0, minSize: 1 },
        { component: content, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: borderColumn(tui, FRAME.v), basis: 1, grow: 0, shrink: 0, minSize: 1 },
      ],
    }),
  } as unknown as Component;

  return {
    render: () => [] as string[],
    invalidate() { right.invalidate?.(); },
    [LAYOUT_NODE]: () => ({
      type: "vstack",
      gap: 0,
      align: "stretch",
      entries: [
        { component: lineComp(topLine), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
        { component: lineComp(titleBarLine(tui, total)), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
        { component: lineComp(ruleLine), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
        { component: middle, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: lineComp(bottomLine), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
      ],
    }),
  } as unknown as Component;
}

// ── decoración del transcript: iconos por tool + doble línea ──────────────

const DECORATED = Symbol.for("dc.sidebar.decorated");
const decoratedCache = new WeakMap<Component, Component>();
let decoCalled = false;
let decoPetal = false;
let decoCard = false;
let decoWrapped = false;
let bgTitleSeen = false;
let newSessionNotified = false;

/** "✓ New session started" de pi → a Herdr (no a la terminal). Idempotente. */
function notifyNewSession(): void {
  if (newSessionNotified) return;
  newSessionNotified = true;
  try {
    notifyHerdr("pi: new session", "Nueva sesión iniciada");
  } catch {
    /* noop */
  }
}

const DOUBLE_MAP: Record<string, string> = {
  "\u256d": "\u2554", // ╭ → ╔
  "\u256e": "\u2557", // ╮ → ╗
  "\u2570": "\u255a", // ╰ → ╚
  "\u256f": "\u255d", // ╯ → ╝
  "\u2500": "\u2550", // ─ → ═
  "\u2502": "\u2551", // │ → ║
};
/**
 * Pasa un borde redondeado a DOBLE línea por línea (sin necesitar el bloque):
 * si la línea es un borde de card (╭/╰) o un cuerpo (│ … │), la reescribe.
 */
function doubleCardLine(line: string): string {
  try {
    const plain = line.replace(ANSI_RE, "");
    const t = plain.trimStart();
    if (/^[\u256d\u2570]/.test(t)) {
      return line
        .replace(/[\u256d\u256e\u2570\u256f]/g, (c) => DOUBLE_MAP[c] ?? c)
        .replace(/\u2500/g, "\u2550");
    }
    if (/^\u2502/.test(t) && /\u2502\s*$/.test(plain)) {
      return line.replace(/\u2502/g, "\u2551");
    }
    return line;
  } catch {
    return line;
  }
}

/**
 * Pinta la línea de título del box (╭─ … Agent result/Todo … ─╮) con el MISMO
 * fondo que usan los títulos del DcWindow (`selectedBg`). El borde no lo
 * podemos tocar (lo pinta el core), pero el fondo SÍ pasa por este patch.
 */
function bgCardTitle(line: string): string {
  try {
    const theme = getTheme?.();
    if (!theme) return line;
    const plain = line.replace(ANSI_RE, "");
    if (!/^\s*[\u256d\u250c].*(agent result|stale agent|todo)/i.test(plain)) return line;
    if (!bgTitleSeen) {
      bgTitleSeen = true;
      trace("bg-title:" + (typeof theme.bg === "function" ? "hasBg" : "NO-bg-method"));
    }
    return theme.bg("selectedBg", theme.fg("accent", plain));
  } catch {
    return line;
  }
}

/** Cambia el petal ❀ por el icono del tool que corresponda (🧑💼/🧰/📂/🗃). */
function replaceToolPetal(line: string): string {
  // El petal ANIMA: ✿ ❀ ❁ ✾ (PETAL_FRAMES). Hay que aceptar todos.
  if (!/[\u273F\u2740\u2741\u273E]/.test(line)) return line;
  const m = /[\u273F\u2740\u2741\u273E]\s*([A-Za-z_]+)/.exec(line.replace(ANSI_RE, ""));
  const word = (m?.[1] ?? "").toLowerCase();
  const icon = word.startsWith("agent")
    ? "\u{1F9D1}\u200D\u{1F4BC}"
    : word.startsWith("todo") || word.startsWith("task")
      ? "\u{1F9F0}"
      : word.startsWith("change") || word.startsWith("file")
        ? "\u{1F4C2}"
        : word.startsWith("bash") || word.startsWith("sh") || word.startsWith("cmd")
          ? "📟"
          : "";
  if (!icon) return line;
  const swapped = line.replace(/[\u273F\u2740\u2741\u273E]/, icon);
  // El emoji ocupa 2 celdas y el petal 1 → la línea crece 1 celda y el marco se
  // desborda. Sacamos UN `─` del run para volver al ancho original.
  const lastBar = swapped.lastIndexOf("\u2500");
  return lastBar >= 0 ? swapped.slice(0, lastBar) + swapped.slice(lastBar + 1) : swapped;
}

function replaceExpandCollapseHint(line: string): string {
  let res = line;
  if (/ctrl\+o expand/i.test(res)) {
    const arrow = "\x1b[38;2;255;255;255m ▼ \x1b[0m";
    const plainArrow = " ▼ ";
    const match = /─+\s*ctrl\+o expand\s*─+/i.exec(res);
    if (match) {
      const matchLen = visibleWidth(match[0]);
      const dashesBefore = Math.max(0, matchLen - visibleWidth(plainArrow) - 3);
      const replacement = "─".repeat(dashesBefore) + arrow + "─".repeat(3);
      res = res.replace(match[0], replacement);
    }
  } else if (/ctrl\+o collapse/i.test(res)) {
    const arrow = "\x1b[38;2;255;255;255m ▲ \x1b[0m";
    const plainArrow = " ▲ ";
    const match = /─+\s*ctrl\+o collapse\s*─+/i.exec(res);
    if (match) {
      const matchLen = visibleWidth(match[0]);
      const dashesBefore = Math.max(0, matchLen - visibleWidth(plainArrow) - 3);
      const replacement = "─".repeat(dashesBefore) + arrow + "─".repeat(3);
      res = res.replace(match[0], replacement);
    }
  }
  return res;
}

/** Post-procesa líneas del transcript: petal por icono + cards a doble línea. */
function decorateLines(tui: TUI, lines: string[], width: number): string[] {
  if (!Array.isArray(lines) || lines.length === 0) return lines;
  if (!decoCalled) {
    decoCalled = true;
    trace("deco:called");
  }
  const plainLines = lines.map((l) => l.replace(ANSI_RE, ""));
  if (!decoPetal && plainLines.some((l) => /[\u273F\u2740\u2741\u273E]/.test(l))) {
    decoPetal = true;
    trace("deco:petal");
  }
  if (!lines.some((l) => /[\u273F\u2740\u2741\u273E\u256d\u2570]|ctrl\+o/i.test(l.replace(ANSI_RE, "")))) return lines;
  if (!decoCard && plainLines.some((l) => /^\s*[\u256d\u250c]/.test(l))) {
    decoCard = true;
    trace("deco:card");
  }
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const plain = line.replace(ANSI_RE, "");
    if (/^\s*[\u256d\u250c]/.test(plain)) {
      // Si la tarjeta ya fue estilizada por otra extensión de DC Studio (e.g. dc-tool-indent,
      // dc-user-prompt o dc-markdown), no la re-envolvemos para no anidar marcos ni romper el fondo.
      const isDcCard =
        /[\u2713\u2716\u2026]/.test(plain) || // ' ✓\, ' ✖\, ' …' de dc-tool-indent
        /[\u26e9\u2620]/.test(plain) ||        // ⛩ de dc-user-prompt o ☠ de dc-markdown
        /^(?:\s*[\u256d\u250c]─\s*(?:✍|📖|✏|⚡|🔍|🔎|📂|📋|🤖|🧠|🌐|🛠))/.test(plain) ||
        /\x1b\[48;2;32;24;28m/.test(line) ||   // Fondo de dc-markdown (código estándar)
        /\x1b\[48;2;38;16;20m/.test(line) ||   // Fondo de dc-markdown (código de error)
        /\x1b\[48;2;26;16;20m/.test(line) ||   // Fondo de dc-tool-indent
        /^\s*[\u256d\u250c]─\s*[a-zA-Z0-9_-]+\s*─/.test(plain) || // dc-markdown: ╭─ lang ───────╮
        /^\s*[\u256d\u250c]─{5,}[\u256e\u2510]\s*$/.test(plain);   // dc-markdown: ╭────────────╮

      if (isDcCard) {
        out.push(replaceExpandCollapseHint(replaceToolPetal(line)));
        continue;
      }

      const indent = plain.length - plain.trimStart().length;
      const closeRe = new RegExp(`^\\s{${indent}}[\u2570\u2514]`);
      let end = -1;
      for (let k = i + 1; k < lines.length; k++) {
        if (closeRe.test((lines[k] ?? "").replace(ANSI_RE, ""))) {
          end = k;
          break;
        }
      }
      if (end > i) {
        out.push(...restyleCard(tui, lines.slice(i, end + 1), width).map(replaceToolPetal).map(replaceExpandCollapseHint));
        i = end;
        continue;
      }
    }
    out.push(replaceExpandCollapseHint(replaceToolPetal(line)));
  }
  return out;
}

/** Envuelve un leaf para decorar sus líneas. */
function decorateComp(tui: TUI, comp: Component): Component {
  if (!comp || typeof comp.render !== "function") return comp;
  if ((comp as Record<symbol, boolean>)[DECORATED]) return comp;
  (comp as Record<symbol, boolean>)[DECORATED] = true;
  if (!decoWrapped) {
    decoWrapped = true;
    trace("deco:wrap");
  }
  const orig = comp.render.bind(comp);
  return {
    ...(comp as object),
    render: (width: number): string[] => {
      try {
        return decorateLines(tui, orig(width), width);
      } catch {
        return [];
      }
    },
    invalidate: (comp.invalidate ?? function () {}).bind(comp),
  } as unknown as Component;
}

/** Recorre el subárbol del transcript y decora cada leaf (memoizado). */
function decorateSubtree(tui: TUI, comp: Component, depth = 0): Component {
  if (!comp || depth > 10) return comp;
  const cached = decoratedCache.get(comp);
  if (cached) return cached;
  const hasNode = typeof (comp as Record<symbol, unknown>)[LAYOUT_NODE] === "function";
  if (!hasNode) return decorateComp(tui, comp);
  const wrapper: Component = {
    render: (width: number) => (comp.render ? comp.render(width) : []),
    invalidate: (comp.invalidate ?? function () {}).bind(comp),
    [LAYOUT_NODE]: () => {
      try {
        const n = (comp as Record<symbol, LayoutNodeFn>)[LAYOUT_NODE]!() as {
          entries?: Array<{ component?: Component }>;
        };
        if (!n || !Array.isArray(n.entries)) return n as never;
        return {
          ...n,
          entries: n.entries.map((e) =>
            e?.component ? { ...e, component: decorateSubtree(tui, e.component, depth + 1) } : e,
          ),
        } as never;
      } catch {
        return (comp as Record<symbol, LayoutNodeFn>)[LAYOUT_NODE]!() as never;
      }
    },
  } as unknown as Component;
  decoratedCache.set(comp, wrapper);
  return wrapper;
}

/** Columna de padding: N espacios por fila (mismo alto que el rail). */
function padColumn(tui: TUI, n: number): Component {
  const line = " ".repeat(Math.max(0, n));
  return { render: () => new Array(railRows(tui)).fill(line), invalidate() {} };
}

/** Línea horizontal que se pinta al ancho que le da el layout (top/bottom). */
function hLineComp(tui: TUI, left: string, right: string): Component {
  return {
    render: (width: number) => [
      colored(tui, left) + colored(tui, FRAME.h.repeat(Math.max(0, width - 2))) + colored(tui, right),
    ],
    invalidate() {},
  };
}

/** Fila en blanco (1 alto) para el aire arriba/abajo dentro de la caja. */
function blankLine(): Component {
  return { render: () => [""], invalidate() {} };
}

/** Envuelve el BODY del agente en una caja DcWindow con padding horizontal. */
function framedBody(tui: TUI, content: Component, pad = 2): Component {
  // Aire vertical: 1 fila en blanco arriba y abajo del contenido (con bordes ║).
  const inner: Component = {
    render: () => [] as string[],
    invalidate() {
      content.invalidate?.();
    },
    [LAYOUT_NODE]: () => ({
      type: "vstack",
      gap: 0,
      align: "stretch",
      entries: [
        { component: blankLine(), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
        { component: content, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: blankLine(), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
      ],
    }),
  } as unknown as Component;
  const middle: Component = {
    render: () => [] as string[],
    invalidate() {
      content.invalidate?.();
    },
    [LAYOUT_NODE]: () => ({
      type: "hstack",
      gap: 0,
      align: "stretch",
      entries: [
        { component: borderColumn(tui, FRAME.v), basis: 1, grow: 0, shrink: 0, minSize: 1 },
        { component: padColumn(tui, pad), basis: pad, grow: 0, shrink: 0, minSize: pad },
        { component: inner, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: padColumn(tui, pad), basis: pad, grow: 0, shrink: 0, minSize: pad },
        { component: borderColumn(tui, FRAME.v), basis: 1, grow: 0, shrink: 0, minSize: 1 },
      ],
    }),
  } as unknown as Component;
  return {
    render: () => [] as string[],
    invalidate() {
      content.invalidate?.();
    },
    [LAYOUT_NODE]: () => ({
      type: "vstack",
      gap: 0,
      align: "stretch",
      entries: [
        { component: hLineComp(tui, FRAME.tl, FRAME.tr), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
        { component: middle, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: hLineComp(tui, FRAME.bl, FRAME.br), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
      ],
    }),
  } as unknown as Component;
}

/**
 * Envuelve SÓLO el transcript del agente (chat) en la caja, dejando el dock
 * (input + barra) afuera. El nativo es vstack[transcript, dock] → caja en [0].
 */
function wrapTranscript(tui: TUI, left: Component): Component {
  return {
    render: () => [] as string[],
    invalidate() {
      left.invalidate?.();
    },
    [LAYOUT_NODE]: () => {
      try {
        const n = (left as Record<symbol, LayoutNodeFn>)[LAYOUT_NODE]?.() as
          | { type?: string; entries?: Array<{ component?: Component }> }
          | undefined;
        if (!n || n.type !== "vstack" || !Array.isArray(n.entries) || n.entries.length === 0) return n as never;
        const first = n.entries[0];
        if (!first?.component) return n as never;
        const entries = n.entries.slice();
        const decorated = decorateSubtree(tui, first.component);
        entries[0] = {
          ...first,
          component: shouldFrameBody() ? framedBody(tui, decorated) : decorated,
        };
        return { ...n, entries } as never;
      } catch {
        return (left as Record<symbol, LayoutNodeFn>)[LAYOUT_NODE]?.() as never;
      }
    },
  } as unknown as Component;
}

/** Nuestra señal de "rail visible", la setea el wrapper en cada render. */
let railVisible = false;
/** ¿restoreNative() actuó en este arranque? (diag de /reload) */
let restoredAtStart = false;

/** Detecta el nodo del rail de gentle-pi: hstack de 4 con un rail que es vstack[scroll,...]. */
function compHasNode(c: unknown): boolean {
  return !!c && typeof (c as Record<symbol, unknown>)[LAYOUT_NODE] === "function";
}

/** Índice del rail en el hstack: NUEVA estructura = 1, VIEJA = 3. */
function railIndex(node: { entries?: unknown[] } | undefined): number {
  const len = node?.entries?.length ?? 0;
  return len === 2 ? 1 : len === 4 ? 3 : -1;
}

/**
 * Separa el rail en sus piezas. Soporta:
 *  - NUEVA (gentle-pi ≥2.6): el rail ES un ScrollView → child = rail interno, sin face.
 *  - VIEJA: rail = vstack[scroll, faceBottom].
 */
function railParts(railEntry: unknown): { scroll?: any; innerRail?: any; face?: any } {
  const r = railEntry as { setScrollbar?: unknown; child?: unknown } | undefined;
  if (r && typeof r.setScrollbar === "function") {
    return { scroll: r, innerRail: r.child, face: undefined };
  }
  try {
    const rn = (railEntry as Record<symbol, LayoutNodeFn>)?.[LAYOUT_NODE]?.() as
      | { entries?: Array<{ component?: Record<symbol, LayoutNodeFn> }> }
      | undefined;
    const scroll = rn?.entries?.[0]?.component;
    const face = rn?.entries?.[1]?.component;
    const innerRail = (scroll as { child?: unknown } | undefined)?.child;
    return { scroll, innerRail, face };
  } catch {
    return {};
  }
}

function extractRailNode(node: unknown): { type?: string; entries?: unknown[] } | undefined {
  const n = node as { type?: string; entries?: Array<{ component?: unknown }> } | undefined;
  if (!n) return undefined;
  if (n.type === "hstack") return n;
  if (n.type === "vstack" && Array.isArray(n.entries)) {
    const hstackEntry = n.entries.find((e) => {
      const comp = e?.component as Record<symbol, LayoutNodeFn> | undefined;
      return comp && typeof comp[LAYOUT_NODE] === "function";
    });
    if (hstackEntry?.component) {
      try {
        const inner = (hstackEntry.component as Record<symbol, LayoutNodeFn>)[LAYOUT_NODE]!() as {
          type?: string;
          entries?: unknown[];
        };
        if (inner?.type === "hstack") return inner;
      } catch {
        /* noop */
      }
    }
  }
  return undefined;
}

/** Detecta el rail de gentle-pi (soporta estructura nueva de 2 y vieja de 4). */
function isGentleRail(node: unknown): boolean {
  const n = extractRailNode(node);
  if (!n || n.type !== "hstack" || !Array.isArray(n.entries)) return false;
  const idx = railIndex(n);
  if (idx < 0 || !compHasNode((n.entries[idx] as { component?: unknown })?.component)) return false;
  return true;
}

/** Instala el wrap. Devuelve true si quedó envuelto (o ya lo estaba). */
function tryWrap(tui: TUI): boolean {
  const host = tui as unknown as { layoutRoot?: Record<symbol, LayoutNodeFn> };
  const root = host.layoutRoot;
  rememberRoot(root);
  if (!root || typeof root[LAYOUT_NODE] !== "function") return false;

  // Si ya está envuelto por ESTA instancia vigente del módulo, listo:
  if (
    root[WRAPPED] === true &&
    root[LAYOUT_NODE] === (root as Record<symbol, unknown>)[G_WRAPPER_FN] &&
    (root as Record<symbol, unknown>)[G_WRAPPER_REV] === MODULE_REV
  ) {
    return true;
  }

  // Si quedó envuelto por OTRA instancia de un reload anterior, des-envolver primero:
  if (root[WRAPPED] === true && (root as Record<symbol, unknown>)[G_WRAPPER_REV] !== MODULE_REV) {
    const prev = (root as Record<symbol, unknown>)[G_PREV] as LayoutNodeFn | undefined;
    if (typeof prev === "function") {
      delete (root as Record<symbol, unknown>)[WRAPPED];
      root[LAYOUT_NODE] = prev;
    }
  }

  let node: unknown;
  try { node = root[LAYOUT_NODE](); } catch { return false; }
  if (!isGentleRail(node)) {
    // Recuperación: un restore viejo pudo dejar el root apuntando a un sub-nodo
    // (p.ej. el rail). Si tenemos el nodo previo real, lo reponemos y reintentamos.
    const prev = root[G_PREV] as LayoutNodeFn | undefined;
    if (typeof prev === "function" && root[LAYOUT_NODE] !== prev) {
      try {
        root[LAYOUT_NODE] = prev;
        node = root[LAYOUT_NODE]();
      } catch {
        return false;
      }
      trace("wrap:recovered-prev");
    }
    if (!isGentleRail(node)) return false;
  }

  // Rail de gentle-pi: ocultar scrollbar, quitar la marca centrada y manejar la cara.
  const actualRailNode = extractRailNode(node);
  try {
    const idx = railIndex(actualRailNode);
    const railEntry = idx >= 0 ? (actualRailNode!.entries![idx] as { component?: unknown })?.component : undefined;
    const { scroll, innerRail, face } = railParts(railEntry);
    scroll?.setScrollbar?.("hidden");
    (globalThis as unknown as Record<symbol, unknown>)[G_SCROLL] = scroll;
    if (innerRail && typeof innerRail.render === "function" && !innerRail[BRAND_SUPPRESSED]) {
      (innerRail as Record<symbol, boolean>)[BRAND_SUPPRESSED] = true;
      const orig = innerRail.render.bind(innerRail);
      innerRail.render = () => {
        const lines = orig();
        const bare = (l: string) => l.replace(/\x1b\[[0-9;]*m/g, "").trim();
        const i0 = lines.findIndex((l) => bare(l) !== "");
        const out = i0 < 0 ? lines : [...lines.slice(0, i0), ...lines.slice(i0 + 1)];
        let i = 0;
        while (i < out.length && bare(out[i]) === "") i++;
        return out.slice(i);
      };
    }
    if (face) {
      // Estructura VIEJA: envolver el faceBottom (separador + sin gutter + click).
      wrapFaceComponent(tui, face as Component & Record<symbol, unknown>);
      railFace = undefined;
    } else {
      // Estructura NUEVA: gentle-pi ya no renderiza la parte "face" → la re-creamos.
      railFace = facePartComponent(tui);
    }
  } catch {
    /* noop */
  }

  // Guardar el nodo PREVIO real (lo que root[LAYOUT_NODE] tenía ANTES de nuestro
  // wrap) EN EL ROOT, para deshacer tras /reload aunque el módulo se re-evalúe.
  // OJO: antes usábamos entries[1] → en la estructura nueva entries[1] = el RAIL,
  // así que "restore" dejaba el root = rail → se dibujaba la ventana de Status
  // SOLA y rompía el resto. Ese era el bug del reload.
  try {
    (root as unknown as Record<symbol, unknown>)[G_PREV] = root[LAYOUT_NODE];
  } catch {
    /* noop */
  }

  const gentle = root[LAYOUT_NODE];
  const wrapped: LayoutNodeFn = function () {
    try {
      const raw = gentle.call(root);
      const n = (extractRailNode(raw) ?? raw) as { type?: string; gap?: number; entries?: Array<Record<string, unknown>> };
      const idx = !!n && n.type === "hstack" && Array.isArray(n.entries) ? railIndex(n) : -1;
      railVisible = idx >= 0 && !prefs.hidden;
      try {
        (globalThis as unknown as Record<symbol, boolean>)[Symbol.for("dc.sidebar.rail-visible")] = railVisible;
        const term = tui?.terminal as unknown as Record<symbol, unknown> | undefined;
        if (term) term[Symbol.for("dc.sidebar.rail-visible")] = railVisible;
        const st = stateOf(tui);
        if (st && prefs.hidden) st.active = false;
      } catch {
        /* noop */
      }
      if (idx < 0) return raw;

      // Si el usuario ocultó el sidebar, devolver solo la vista del transcript sin el rail a ancho completo
      if (prefs.hidden) {
        const entries = n.entries!.slice();
        if (idx === 1 && entries[0]?.component) {
          const body = entries[0] as unknown as { component: Component };
          entries[0] = {
            ...body,
            component: shouldFrameBody() ? framedBody(tui, body.component) : body.component,
            grow: 1,
            shrink: 1,
          };
        }
        return { ...n, gap: 0, entries: entries.filter((_, i) => i !== idx) };
      }

      if (!prefs.frame) return n;
      const railEntry = n.entries![idx] as unknown as { component: Component };
      const framed = framedRail(tui, railEntry.component);
      const entries = n.entries!.slice();
      entries[idx] = { ...railEntry, component: framed, basis: RAIL_WIDTH + 2 };
      // Body: caja + padding 2 alrededor del transcript del agente (hstack nuevo:
      // entries[0]=transcript, entries[1]=rail). El dock queda FUERA de la caja.
      if (idx === 1 && n.entries![0]?.component) {
        const body = n.entries![0] as unknown as { component: Component };
        entries[0] = { ...body, component: wrapTranscript(tui, body.component) };
      }
      return { ...n, gap: 0, entries };
    } catch {
      try { return gentle.call(root); } catch { return undefined; }
    }
  };
  (wrapped as unknown as Record<symbol, boolean>)[WRAPPED] = true;
  root[LAYOUT_NODE] = wrapped;
          (root as unknown as Record<symbol, unknown>)[G_WRAPPER_FN] = wrapped;
  (root as unknown as Record<symbol, boolean>)[WRAPPED] = true;
  (root as unknown as Record<symbol, unknown>)[G_WRAPPER_REV] = MODULE_REV;
  tui.requestRender();
  return true;
}

function setFrame(on: boolean): void {
  prefs.frame = on;
  writePrefs(prefs);
  // El wrapper lee prefs.frame en cada render: alcanza con repintar.
  if (tuiRef) {
    pollWrap();
    tuiRef.requestRender();
  }
}

function setBodyFrame(on: boolean): void {
  prefs.bodyFrame = on;
  writePrefs(prefs);
  if (tuiRef) {
    pollWrap();
    tuiRef.requestRender();
  }
}

function setHeaderBar(v: boolean): void {
  prefs.headerBar = v;
  writePrefs(prefs);
  if (tuiRef) {
    if (v && savedHeaderRail) {
      const state = stateOf(tuiRef);
      if (state?.parts && !state.parts.has("header")) {
        state.parts.set("header", savedHeaderRail);
      }
    }
    bumpCache(tuiRef);
    try {
      const host = tuiRef as unknown as { layoutRoot?: Component; chatContainer?: Component };
      host.layoutRoot?.invalidate?.();
      host.chatContainer?.invalidate?.();
    } catch {}
    tuiRef.requestRender();
  }
}

function rememberRoot(root: unknown): void {
  if (root) (globalThis as unknown as Record<symbol, unknown>)[G_ROOT] = root;
}

function restoreNative(): void {
  // Usar el root guardado en globalThis, NO tuiRef: en /reload el módulo se
  // re-evalúa y tuiRef arranca undefined, pero el root sigue siendo el mismo objeto.
  const root = (globalThis as unknown as Record<symbol, unknown>)[G_ROOT] as
    | (Record<symbol, unknown> & Record<symbol, LayoutNodeFn>)
    | undefined;
  if (!root) {
    trace("restore:no-root");
    return;
  }
  const prev = (root[G_PREV] as LayoutNodeFn | undefined);
  const wrapped = root[WRAPPED] === true;
  trace(`restore:wrap=${wrapped} prev=${typeof prev === "function"}`);
  if (wrapped && typeof prev === "function") {
    delete (root as Record<symbol, unknown>)[WRAPPED];
    root[LAYOUT_NODE] = prev;
    restoredAtStart = true;
  }
}

const G_POLL_TIMER = Symbol.for("dc.sidebar.poll-timer");
function stopPollTimer(): void {
  const t = (globalThis as unknown as Record<symbol, NodeJS.Timeout | undefined>)[G_POLL_TIMER];
  if (t) {
    clearInterval(t);
    (globalThis as unknown as Record<symbol, NodeJS.Timeout | undefined>)[G_POLL_TIMER] = undefined;
  }
}
function pollWrap(): void {
  stopPollTimer();
  const timer = setInterval(() => {
    if (tuiRef) tryWrap(tuiRef);
  }, 150);
  timer.unref();
  (globalThis as unknown as Record<symbol, NodeJS.Timeout | undefined>)[G_POLL_TIMER] = timer;
}

// ── extensión ─────────────────────────────────────────────────────────────

// Instalar los interceptores LO ANTES POSIBLE (module-load): gentle-pi setea
// sus widgets y corre renderCall antes de nuestro session_start.
const FRAME_PATCHED = Symbol.for("dc.sidebar.frame-patched");

/**
 * Post-procesa el FRAME COMPLETO: `doRender` de pi-tui arma `screen` y lo pasa
 * por `applySearchHighlights(screen, layout)`. Patchear ESE método nos da las
 * líneas finales de todo lo que Pi manda a la terminal → agarra los tool rows
 * (renderCall) y las cards (renderCard) sin depender del árbol de nodos.
 */
function patchFrameDecorator(): void {
  for (const cls of [TuiAltScreen, TuiMainScreen]) {
    try {
      const proto = (cls as unknown as { prototype?: Record<string, unknown> } | undefined)?.prototype;
      if (!proto || (proto as Record<symbol, boolean>)[FRAME_PATCHED]) continue;
      const orig = proto.applySearchHighlights as
        | ((screen: string[], layout: unknown) => string[])
        | undefined;
      if (typeof orig !== "function") continue;
      (proto as Record<symbol, boolean>)[FRAME_PATCHED] = true;
      proto.applySearchHighlights = function (
        this: { terminal?: { columns?: number } },
        screen: string[],
        layout: unknown,
      ): string[] {
        const out = orig.call(this, screen, layout);
        try {
          return decorateLines(this as unknown as TUI, out, this.terminal?.columns ?? 0);
        } catch {
          return out;
        }
      };
      trace("frame-decorator");
    } catch (e) {
      trace("frame-patch-error:" + String(e));
    }
  }
}

const SCROLL_PATCHED = Symbol.for("dc.sidebar.scroll-patched");

/**
 * `ScrollView.prototype.render` es un punto compartido con gentle-pi. Si el
 * transcript se dibuja por un ScrollView de ESTE módulo, acá llegan las filas
 * de los tool results (las cards) → petal→icono + doble línea + ancho cuadrado.
 */
function patchScrollDecorator(): void {
  try {
    const proto = (ScrollView as unknown as { prototype?: Record<string, unknown> }).prototype;
    if (!proto || (proto as Record<symbol, boolean>)[SCROLL_PATCHED]) return;
    const orig = proto.render as ((width: number) => string[]) | undefined;
    if (typeof orig !== "function") return;
    (proto as Record<symbol, boolean>)[SCROLL_PATCHED] = true;
    proto.render = function (this: TUI, width: number): string[] {
      const out = orig.call(this, width);
      try {
        return decorateLines(this, out, width);
      } catch {
        return out;
      }
    };
    trace("scroll-decorator");
  } catch (e) {
    trace("scroll-patch-error:" + String(e));
  }
}

const CLEAR_PATCHED = Symbol.for("dc.sidebar.clear-patched");

/**
 * `InteractiveMode.prototype.handleClearCommand` (nueva sesión) agrega al chat
 * un `✓ New session started` (core, inmune al patch de `Text`). Como la clase
 * SÍ es la del core, la parcheamos: sacamos el Spacer+Text que agrega y lo
 * despachamos por dc-notification (Herdr).
 */
function patchClearCommand(): void {
  try {
    const proto = (InteractiveMode as unknown as { prototype?: Record<string, unknown> } | undefined)?.prototype;
    if (!proto || (proto as Record<symbol, boolean>)[CLEAR_PATCHED]) return;
    const orig = proto.handleClearCommand as ((this: unknown, ...a: unknown[]) => Promise<unknown>) | undefined;
    if (typeof orig !== "function") return;
    (proto as Record<symbol, boolean>)[CLEAR_PATCHED] = true;
    proto.handleClearCommand = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const container = (this as { chatContainer?: { children?: unknown[]; removeChild?: (c: unknown) => void } })
        .chatContainer;
      const before = Array.isArray(container?.children) ? container.children.length : -1;
      const result = await orig.call(this, ...args);
      try {
        const kids = container?.children;
        if (container && before >= 0 && Array.isArray(kids)) {
          for (let i = kids.length - 1; i >= before; i--) {
            if (typeof container.removeChild === "function") container.removeChild(kids[i]);
            else kids.splice(i, 1);
          }
        }
      } catch {
        /* noop */
      }
      try {
        notifyHerdr("pi: new session", "Nueva sesión iniciada");
      } catch {
        /* noop */
      }
      return result;
    };
    trace("clear-patcher");
  } catch (e) {
    trace("clear-patch-error:" + String(e));
  }
}

trace("rev:" + MODULE_REV);
patchExtensionWidgets();
patchTextGlyph();
patchFrameDecorator();
patchScrollDecorator();
patchClearCommand();

export default function dcSidebarExtension(pi: ExtensionAPI) {
  currentPi = pi;
  trace("module-loaded");
  try {
    fs.writeFileSync(DIAG_FILE, JSON.stringify({ loadedAt: new Date().toISOString(), rev: "reload-safe" }));
  } catch {
    /* noop */
  }
  pi.on("session_start", (event, ctx) => {
    trace("session_start");
    Object.assign(prefs, readPrefs());
    newSessionNotified = false;
    currentCtx = ctx;
    (globalThis as unknown as Record<symbol, unknown>)[G_CTX] = ctx;
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    (globalThis as unknown as Record<symbol, unknown>)[G_THEME] = () => ctx.ui.theme;

    const reason = (event as { reason?: string } | undefined)?.reason;
    const isNew =
      !reason ||
      reason === "startup" ||
      reason === "new" ||
      reason === "new-session" ||
      reason === "reload";
    const hasMessages = (ctx as any).sessionManager?.getEntries?.()?.some?.(
      (e: any) => e?.type === "message" && e?.message?.role === "user"
    );
    if (isNew && !hasMessages) {
      (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = true;
    } else {
      (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = false;
    }

    // Si quedó un wrap de una carga anterior, restaurar el nativo antes de que
    // gentle-pi vuelva a envolver (evita anidar marcos y closures viejas en /reload).
    try {
      restoreNative();
      trace("restored");
    } catch (e) {
      trace("restore-error:" + String(e));
    }

    if (tuiRef) {
      try {
        enforceBar(tuiRef);
        wrapFooterBrand(tuiRef);
        wrapMountedWidgets();
        styleCards(tuiRef);
        applyHidden(tuiRef);
        pollWrap();
      } catch {
        /* noop */
      }
    }

    try {
      ctx.ui.setWidget(ANCHOR_KEY, (tui) => {
        tuiRef = tui;
        try {
          (globalThis as unknown as Record<symbol, unknown>)[G_TUI] = tui;
        } catch {
          /* noop */
        }
        trace("widget-captured");
        try {
          enforceBar(tui);
          wrapFooterBrand(tui);
          wrapMountedWidgets();
          styleCards(tui);
          applyHidden(tui);
          pollWrap();
        } catch {
          /* noop */
        }
        return emptyPart();
      });
      trace("set-widget");
    } catch (e) {
      trace("set-widget-error:" + String(e));
    }
    // Interceptar widgets de extensión (agents/todo/changes): ocultar con rail
    // activo + chrome DcWindow cuando se muestran abajo del body.
patchExtensionWidgets();
patchTextGlyph();

    // Reintentos: el rail y el ownsHost de gentle-pi se montan después de session_start.
    for (const ms of [500, 1200, 2500, 4000]) {
      const h = setTimeout(() => {
        if (!tuiRef) {
          trace("retry-noref-" + ms);
          return;
        }
        trace("retry-" + ms);
        try {
          enforceBar(tuiRef);
          wrapFooterBrand(tuiRef);
          wrapMountedWidgets();
          styleCards(tuiRef);
          applyHidden(tuiRef);
          pollWrap();
          // Re-ocultar el scrollbar del rail por si gentle-pi lo recreó.
          const sc = (globalThis as unknown as Record<symbol, { setScrollbar?: (s: string) => void } | undefined>)[G_SCROLL];
          sc?.setScrollbar?.("hidden");
        } catch (e) {
          trace("retry-error:" + String(e));
        }
        diag(tuiRef, { phase: "retry", ms });
      }, ms);
      (h as { unref?: () => void }).unref?.();
    }
  });

  // /reload emite session_shutdown ANTES de re-arrancar (agent-session.js:2220).
  // Desenvolver NUESTRO wrap acá evita que gentle-pi envuelva el wrap viejo
  // (quedaba anidado → el sidebar se dibujaba DOS veces).
  pi.on("session_shutdown", () => {
    stopPollTimer();
    stopSidebarPulseTimer();
    (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = false;
    try {
      restoreNative();
    } catch {
      /* noop */
    }
  });

  pi.on("message_start", (event) => {
    const role = (event as { message?: { role?: string } })?.message?.role;
    if (role === "user") {
      (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = false;
      tuiRef?.requestRender();
    }
  });

  // Si algo vuelve a registrar una parte estando oculta, re-vaciar.
  pi.on("turn_start", (_event, ctx) => {
    (globalThis as unknown as Record<symbol, boolean>)[G_BANNER_ACTIVE] = false;
    if (ctx) {
      currentCtx = ctx;
      (globalThis as unknown as Record<symbol, unknown>)[G_CTX] = ctx;
    }
    if (!tuiRef) return;
    Object.assign(prefs, readPrefs());
    enforceBar(tuiRef);
    wrapFooterBrand(tuiRef);
    wrapMountedWidgets();
    if (prefs.hidden) applyHidden(tuiRef);
    tuiRef.requestRender();
  });

  pi.registerCommand("context", {
    description: "Ventana detallada de contexto y métricas de tokens (DC Studio)",
    handler: async (_args: string, ctx: ExtensionContext) => {
      await openContextModal(ctx);
    },
  });

  pi.registerShortcut("alt+shift+c", {
    description: "Ventana de contexto (DcWindow)",
    handler: async (ctx: ExtensionContext) => {
      await openContextModal(ctx);
    },
  });

  pi.registerCommand("sidebar", {
    description: "Sidebar: /sidebar [hide|show|toggle] · /sidebar frame [on|off] · /sidebar body-frame [on|off] · /sidebar barra [on|off]",
    handler: async (args: string, ctx: ExtensionContext) => {
      const parts = args.trim().toLowerCase().split(/\s+/);
      if (parts[0] === "frame") {
        const v = parts[1] === "off" ? false : parts[1] === "on" ? true : !prefs.frame;
        setFrame(v);
        notify(ctx, `sidebar frame: ${v ? "on" : "off"}`);
        return;
      }
      if (parts[0] === "body-frame" || parts[0] === "bodyframe") {
        const v = parts[1] === "on" ? true : parts[1] === "off" ? false : !prefs.bodyFrame;
        setBodyFrame(v);
        notify(ctx, `body frame: ${v ? "on" : "off"}`);
        return;
      }
      if (parts[0] === "header" || parts[0] === "barra") {
        const v = parts[1] === "on" ? true : parts[1] === "off" ? false : !prefs.headerBar;
        setHeaderBar(v);
        notify(ctx, `barra superior: ${v ? "on" : "off"}`);
        return;
      }
      prefs.hidden = parts[0] === "hide" ? true : parts[0] === "show" ? false : !prefs.hidden;
      writePrefs(prefs);
      if (tuiRef && applyHidden(tuiRef)) {
        notify(ctx, prefs.hidden ? "sidebar: oculta" : "sidebar: visible");
        return;
      }
      applyHidden(tuiRef as TUI);
    },
  });

  pi.registerCommand("barra", {
    description: "Barra superior de Gentle Shell: /barra [on|off|toggle]",
    handler: async (args: string, ctx: ExtensionContext) => {
      const arg = args.trim().toLowerCase();
      const v = arg === "on" ? true : arg === "off" ? false : !prefs.headerBar;
      setHeaderBar(v);
      notify(ctx, `barra superior: ${v ? "on" : "off"}`);
    },
  });

  const toggleSidebarHandler = async (ctx: ExtensionContext) => {
    prefs.hidden = !prefs.hidden;
    writePrefs(prefs);
    if (tuiRef) applyHidden(tuiRef);
    (ctx.ui as any).requestRender?.();
    notify(ctx, prefs.hidden ? "sidebar: oculta" : "sidebar: visible");
  };

  pi.registerShortcut("alt+shift+b", {
    description: "Mostrar/ocultar sidebar",
    handler: toggleSidebarHandler,
  });

  pi.registerShortcut("alt+b", {
    description: "Mostrar/ocultar sidebar (alternativo)",
    handler: toggleSidebarHandler,
  });
}
