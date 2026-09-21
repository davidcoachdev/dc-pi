import type { Component, TUI } from "@earendil-works/pi-tui";
import * as process from "node:process";
import { LAYOUT_NODE, LayoutNodeFn } from "../core/dc-sidebar-types.ts";
import { processBottomBar, renderBottomBar } from "./dc-bottom-bar-layout.ts";
import { buildLeftBox, buildCenterBox, buildRightBox, BRAND_TEXT } from "./dc-bottom-bar-boxes.ts";
import { isRailActive } from "../runtime/dc-sidebar-host.ts";
import { getProjectInfo } from "../providers/dc-project-provider.ts";
import { getMcpServersInfo } from "../providers/dc-mcp-provider.ts";

export const FOOTER_ORIG = Symbol.for("dc.sidebar.footer-orig-render");
export const FOOTER_WRAPPED = Symbol.for("dc.sidebar.footer-wrapped");

/**
 * Recursively traverses the layout node tree to reliably locate the dock footer component,
 * regardless of whether gentle-pi inserted a header vstack, an hstack host, or native Pi nodes.
 */
export function findDockFooterFromNode(node: any): (Component & Record<symbol, unknown>) | undefined {
  if (!node || !Array.isArray(node.entries)) return undefined;

  // 1. If this node is a vstack
  if (node.type === "vstack" || !node.type) {
    // Check if entries[1] is a dock (standard Pi layout: [transcript, dock])
    if (node.entries.length >= 2) {
      const maybeDock = node.entries[1]?.component;
      if (maybeDock && typeof maybeDock[LAYOUT_NODE] === "function") {
        try {
          const dockNode = maybeDock[LAYOUT_NODE]();
          if (Array.isArray(dockNode?.entries) && dockNode.entries.length > 0) {
            if (dockNode.type === "hstack") {
              // gentle-pi with header: entries[1] was hstackHost!
              const found = findDockFooterFromNode(dockNode);
              if (found) return found;
            } else {
              const last = dockNode.entries[dockNode.entries.length - 1]?.component;
              if (last && typeof last.render === "function") {
                return last as (Component & Record<symbol, unknown>);
              }
            }
          }
        } catch {
          /* noop */
        }
      }
    }
  }

  // 2. If this node is an hstack: search entries (left is entries[0] or entries[1])
  if (node.type === "hstack") {
    for (const entry of node.entries) {
      const comp = entry?.component;
      if (comp && typeof comp[LAYOUT_NODE] === "function") {
        try {
          const inner = comp[LAYOUT_NODE]();
          const found = findDockFooterFromNode(inner);
          if (found) return found;
        } catch {
          /* noop */
        }
      }
    }
  }

  return undefined;
}

/**
 * Traverses the TUI layout root to locate the footer component inside the dock.
 */
export function findDockFooter(tui: any): (Component & Record<symbol, unknown>) | undefined {
  try {
    const host = tui as unknown as { layoutRoot?: Record<symbol, LayoutNodeFn> };
    const root = host?.layoutRoot;
    if (!root || typeof root[LAYOUT_NODE] !== "function") return undefined;

    const node = root[LAYOUT_NODE]();
    return findDockFooterFromNode(node);
  } catch {
    return undefined;
  }
}

/**
 * Intercepts gentle-pi's shell dock footer:
 * (a) Hides it completely when the rail/sidebar is physically active.
 * (b) Formats it with DC Studio boxes and brand when the sidebar is hidden.
 */
export function wrapFooterBrand(tui: any, getTheme?: () => any): boolean {
  try {
    const footer = findDockFooter(tui);
    if (!footer) return false;

    const stored = footer[FOOTER_ORIG] as ((w: number) => string[]) | undefined;
    const orig = stored ?? ((footer[FOOTER_ORIG] = footer.render.bind(footer)) as (w: number) => string[]);

    footer.render = (width: number): string[] => {
      // 1. If sidebar is physically visible on screen, suppress bottom bar completely
      if (isRailActive(tui)) {
        return [];
      }

      // 2. If sidebar is hidden, render bottom bar with DC branding
      const theme = getTheme?.();
      let rawLines: string[] = [];
      try {
        rawLines = orig(Math.max(240, width * 2));
      } catch {
        /* noop */
      }

      // If gentle-pi returned content lines, filter and format them
      if (rawLines && rawLines.length > 0 && rawLines.some((l) => l.trim().length > 0)) {
        return rawLines.map((line: string) => processBottomBar(line, width, theme));
      }

      // Fallback: construct DC Studio bottom bar directly if gentle-pi was suppressed
      const proj = getProjectInfo();
      const location = proj.branch && proj.branch !== "master" && proj.branch !== "main"
        ? `${proj.displayCwd} ±${proj.branch}`
        : (proj.branch ? `${proj.displayCwd} » ${proj.branch}` : proj.displayCwd);

      const mcpInfo = getMcpServersInfo();
      const mcpText = mcpInfo.totalCount > 0 ? `🔌 ${mcpInfo.enabledCount} MCPs` : "";

      const right = buildRightBox(undefined, theme);
      return [renderBottomBar({ brand: BRAND_TEXT, location, session: mcpText, face: right }, width)];
    };

    footer[FOOTER_WRAPPED] = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Restores the original footer render method if wrapped.
 */
export function unwrapFooterBrand(tui: any): void {
  try {
    const footer = findDockFooter(tui);
    if (footer && footer[FOOTER_ORIG]) {
      footer.render = footer[FOOTER_ORIG] as (w: number) => string[];
      delete footer[FOOTER_WRAPPED];
      delete footer[FOOTER_ORIG];
    }
  } catch {
    /* noop */
  }
}
