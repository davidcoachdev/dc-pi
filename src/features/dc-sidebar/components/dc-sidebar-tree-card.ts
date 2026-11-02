import * as fs from "node:fs";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { DcSidebarCard } from "../../../ui/dc-sidebar-card.ts";
import { executeSlashCommand } from "../../../core/dc-command-executor.ts";
import { getSidebarContext } from "../dc-sidebar.ts";

const execAsync = promisify(exec);

const bloodSoft = (s: string) => `\x1b[38;2;255;128;128m${s}\x1b[0m`;
const whiteBright = (s: string) => `\x1b[97m${s}\x1b[0m`;

export interface TreeNode {
  name: string;
  relPath: string;
  isDir: boolean;
  itemCount?: number;
  children?: TreeNode[];
  gitStatus?: "M" | "?" | "A" | "D" | "R";
}

export interface TreeRow {
  lineIndex: number;
  relPath: string;
  isDir: boolean;
  depth: number;
  name: string;
  expanded: boolean;
  itemCount?: number;
  gitStatus?: string;
  prefix: string;
}

const DEFAULT_IGNORED = new Set([
  "node_modules",
  ".git",
  ".dist",
  "dist",
  "build",
  ".test-build",
  ".cache",
  "coverage",
]);

/**
 * Escanea un directorio respetando carpetas ignoradas y profundidad máxima.
 */
export function scanDirectory(
  dirPath: string,
  basePath: string,
  maxDepth = 3,
  currentDepth = 0,
): TreeNode[] {
  if (currentDepth > maxDepth) return [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const nodes: TreeNode[] = [];

    // Ordenar: primero carpetas, luego archivos alfabéticamente
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (DEFAULT_IGNORED.has(entry.name)) continue;
      // Ignorar archivos temporales o de swap
      if (entry.name.startsWith(".git") || entry.name.endsWith("~")) continue;

      const fullPath = path.join(dirPath, entry.name);
      const relPath = path.relative(basePath, fullPath);

      if (entry.isDirectory()) {
        let itemCount = 0;
        try {
          const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
          itemCount = subEntries.filter(
            (e) => !DEFAULT_IGNORED.has(e.name) && !e.name.startsWith(".git") && !e.name.endsWith("~")
          ).length;
        } catch {
          itemCount = 0;
        }

        const children = scanDirectory(fullPath, basePath, maxDepth, currentDepth + 1);
        nodes.push({
          name: entry.name,
          relPath,
          isDir: true,
          itemCount,
          children,
        });
      } else {
        nodes.push({
          name: entry.name,
          relPath,
          isDir: false,
        });
      }
    }
    return nodes;
  } catch {
    return [];
  }
}

/**
 * Consulta el estado de Git en el CWD de forma asíncrona y mapea el estatus a los nodos.
 */
export async function getGitStatusMap(cwd: string): Promise<Map<string, "M" | "?" | "A" | "D" | "R">> {
  const map = new Map<string, "M" | "?" | "A" | "D" | "R">();
  try {
    const { stdout } = await execAsync("git status --porcelain -uall", { cwd, timeout: 1500 });
    const lines = stdout.split("\n");
    for (const line of lines) {
      if (line.length < 4) continue;
      const indexStatus = line[0]!;
      const workStatus = line[1]!;
      let filePath = line.substring(3).trim();
      if (filePath.includes(" -> ")) {
        filePath = filePath.split(" -> ")[1]!.trim();
      }
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.substring(1, filePath.length - 1);
      }

      let status: "M" | "?" | "A" | "D" | "R" = "M";
      if (indexStatus === "?" || workStatus === "?") status = "?";
      else if (indexStatus === "A" || workStatus === "A") status = "A";
      else if (indexStatus === "D" || workStatus === "D") status = "D";
      else if (indexStatus === "R" || workStatus === "R") status = "R";

      map.set(filePath, status);
    }
  } catch {}
  return map;
}

/**
 * Obtiene el glifo semántico de un archivo o carpeta.
 */
export function getFileGlyph(name: string, isDir: boolean, expanded: boolean): string {
  if (isDir) {
    return expanded ? "📂" : "📁";
  }
  const ext = path.extname(name).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
      return "📘";
    case ".js":
    case ".jsx":
    case ".mjs":
      return "📒";
    case ".json":
      return "⚙️ ";
    case ".md":
      return "📜";
    case ".sh":
    case ".bash":
      return "🐚";
    case ".css":
    case ".scss":
      return "🎨";
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".webp":
    case ".svg":
    case ".ico":
    case ".bmp":
      return "🖼️ ";
    case ".rs":
      return "🦀";
    case ".go":
      return "🐹";
    case ".py":
      return "🐍";
    case ".yml":
    case ".yaml":
      return "📋";
    default:
      return "📄";
  }
}

/**
 * Componente interactivo de Árbol de Proyecto para la pestaña TREE.
 */
export class DcProjectTreeCard implements Component {
  private projectRoot: string;
  private expandedDirs: Set<string> = new Set(["src", "src/features", "test"]);
  private gitStatusMap: Map<string, "M" | "?" | "A" | "D" | "R"> = new Map();
  private lastGitCheck = 0;
  private visibleRows: TreeRow[] = [];
  private theme?: Pick<Theme, "fg" | "bg" | "bold">;
  private requestRender?: () => void;

  constructor(projectRoot: string, theme?: Pick<Theme, "fg" | "bg" | "bold">, requestRender?: () => void) {
    this.projectRoot = projectRoot;
    this.theme = theme;
    this.requestRender = requestRender;
    this.refreshGitStatus();
  }

  invalidate(): void {}

  refreshGitStatus(): void {
    const now = Date.now();
    if (now - this.lastGitCheck > 3000) {
      this.lastGitCheck = now;
      void getGitStatusMap(this.projectRoot).then((map) => {
        this.gitStatusMap = map;
        this.requestRender?.();
      });
    }
  }

  toggleDir(relPath: string): void {
    if (this.expandedDirs.has(relPath)) {
      this.expandedDirs.delete(relPath);
    } else {
      this.expandedDirs.add(relPath);
    }
    this.requestRender?.();
  }

  private flattenTree(
    nodes: TreeNode[],
    depth = 0,
    ancestorContinues: boolean[] = [],
  ): TreeRow[] {
    const rows: TreeRow[] = [];
    const count = nodes.length;

    for (let i = 0; i < count; i++) {
      const node = nodes[i]!;
      const isLast = (i === count - 1);
      const isExpanded = this.expandedDirs.has(node.relPath);
      const status = this.gitStatusMap.get(node.relPath);

      // Construir líneas de guía que unen visualmente la carpeta padre con sus hijos
      let prefix = "";
      if (depth > 0) {
        for (let d = 1; d < depth; d++) {
          prefix += ancestorContinues[d] ? "│   " : "    ";
        }
        prefix += isLast ? "└── " : "├── ";
      }

      rows.push({
        lineIndex: 0,
        relPath: node.relPath,
        isDir: node.isDir,
        depth,
        name: node.name,
        expanded: isExpanded,
        itemCount: node.itemCount,
        gitStatus: status,
        prefix,
      });

      if (node.isDir && isExpanded && node.children && node.children.length > 0) {
        const nextContinues = [...ancestorContinues];
        nextContinues[depth] = !isLast;
        rows.push(...this.flattenTree(node.children, depth + 1, nextContinues));
      }
    }
    return rows;
  }

  render(width: number): string[] {
    const t = this.theme ?? {
      fg: (_col: string, s: string) => s,
      bg: (_col: string, s: string) => s,
      bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
    };

    this.refreshGitStatus();
    const treeNodes = scanDirectory(this.projectRoot, this.projectRoot, 3);
    const flattened = this.flattenTree(treeNodes);

    const safeW = Math.max(20, width);
    const outputLines: string[] = [];
    this.visibleRows = [];

    // Header informativo del proyecto
    const totalFiles = flattened.filter((r) => !r.isDir).length;
    const headerStr = ` ${t.fg("dim", `Explorador (${totalFiles} archivos en vista)`)}`;
    outputLines.push(truncateToWidth(headerStr, safeW, ""));

    for (let i = 0; i < flattened.length; i++) {
      const row = flattened[i]!;
      row.lineIndex = outputLines.length;
      this.visibleRows.push(row);

      const prefixStyled = row.prefix ? bloodSoft(row.prefix) : "";
      // Carpetas: triángulo blanco (▾ desplegado / ▸ contraído). Archivos: rombito sutil (◈ )
      const indicator = row.isDir
        ? (row.expanded ? whiteBright("▾ ") : whiteBright("▸ "))
        : t.fg("dim", "◈ ");
      const glyph = getFileGlyph(row.name, row.isDir, row.expanded);

      let nameStyled = row.isDir ? t.bold(t.fg("accent", row.name)) : t.fg("dim", row.name);

      let itemsBadge = "";
      if (row.isDir && typeof row.itemCount === "number") {
        const label = row.itemCount === 1 ? "item" : "items";
        itemsBadge = ` ${t.fg("dim", `(${row.itemCount} ${label})`)}`;
      }

      let badge = "";
      if (row.gitStatus) {
        if (row.gitStatus === "M") badge = ` ${t.bold(t.fg("warning", "[M]"))}`;
        else if (row.gitStatus === "?") badge = ` ${t.fg("dim", "[?]")}`;
        else if (row.gitStatus === "A") badge = ` ${t.fg("accent", "[A]")}`;
      }

      const lineContent = ` ${prefixStyled}${indicator}${glyph} ${nameStyled}${itemsBadge}${badge}`;
      outputLines.push(truncateToWidth(lineContent, safeW, ""));
    }

    if (flattened.length === 0) {
      outputLines.push(truncateToWidth(`   ${t.fg("dim", "(Directorio vacío)")}`, safeW, ""));
    }

    return outputLines;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "click" && event.button === "left") {
      const target = this.visibleRows.find((r) => r.lineIndex === event.y);
      if (target) {
        if (target.isDir) {
          this.toggleDir(target.relPath);
          return { handled: true, render: true };
        } else {
          // Abrir archivo con editor / preview
          const ctx = getSidebarContext();
          void executeSlashCommand(ctx, `/read ${target.relPath}`, `Abrir ${target.relPath}`);
          return { handled: true, render: true };
        }
      }
    }
    return undefined;
  }
}

/**
 * Función factory para construir la tarjeta de Árbol de Proyecto en el sidebar.
 */
export function createProjectTreeCard(projectRoot: string, theme?: Pick<Theme, "fg" | "bg" | "bold">, requestRender?: () => void): DcSidebarCard {
  const treeComp = new DcProjectTreeCard(projectRoot, theme, requestRender);
  const projName = path.basename(projectRoot) || "workspace";
  return new DcSidebarCard({
    glyph: "📁 ",
    title: `PROYECTO - ${projName}`,
    content: treeComp,
    paddingX: 1,
  });
}
