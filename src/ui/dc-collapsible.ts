import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { justifyRow } from "./dc-row.ts";
import { DcVStack } from "./dc-vstack.ts";

export interface DcCollapsibleOptions {
  /** Título principal (siempre visible, ej. "🧮 Quota:") */
  title: string;
  /** Información compacta que SOLO se muestra cuando está CONTRAÍDO (ej. "ac2-20%-80%") */
  collapsedInfo?: string;
  /** Acción o texto adicional a la derecha antes de la flecha (ej. "[↗]"), o función según estado de expansión */
  titleRight?: string | ((expanded: boolean) => string);
  /** Texto adicional a la derecha que SOLO se muestra cuando está CONTRAÍDO */
  collapsedTitleRight?: string;
  onTitleRightClick?: () => void;
  expanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  children?: Component[];
  /** Opcional: hijos a mostrar cuando está contraído (ej. barra compacta "Restante ▰▰...") */
  collapsedChildren?: Component[];
  requestRender?: () => void;
}

export class DcCollapsible implements Component {
  public expanded: boolean;
  private childrenStack: DcVStack;
  private collapsedStack: DcVStack | undefined;
  private lastWidth = 40;

  constructor(public options: DcCollapsibleOptions) {
    this.expanded = options.expanded ?? false;
    this.childrenStack = new DcVStack(options.children ?? []);
    if (options.collapsedChildren) {
      this.collapsedStack = new DcVStack(options.collapsedChildren);
    }
  }

  render(width: number): string[] {
    this.lastWidth = width;
    const arrow = this.expanded ? "▲" : "▼";
    
    // Regla del lab:
    // - Si está ABIERTO: solo el título limpio
    // - Si está CERRADO: título + info de resumen
    let left = this.options.title;
    if (!this.expanded && this.options.collapsedInfo) {
      left = `${left} ${this.options.collapsedInfo}`;
    }

    let rightInfo = "";
    if (typeof this.options.titleRight === "function") {
      rightInfo = this.options.titleRight(this.expanded);
    } else if (!this.expanded && this.options.collapsedTitleRight) {
      rightInfo = this.options.collapsedTitleRight;
    } else if (this.options.titleRight) {
      rightInfo = this.options.titleRight;
    }

    const rightText = rightInfo 
      ? `\x1b[2m${rightInfo}\x1b[22m \x1b[38;2;255;51;51m${arrow}\x1b[0m` 
      : `\x1b[38;2;255;51;51m${arrow}\x1b[0m`;

    const header = justifyRow(" " + left, rightText + " ", width);

    let childLines: string[] = [];
    if (this.expanded) {
      childLines = this.childrenStack.render(width);
    } else if (this.collapsedStack) {
      childLines = this.collapsedStack.render(width);
    }

    return [header, ...childLines];
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.button !== undefined && event.button !== "left") return undefined;
    
    if (event.y === 0) {
      const isRightClickZone = this.options.onTitleRightClick &&
        event.x !== undefined &&
        (event.x >= Math.max(20, this.lastWidth - 12) || (event.x >= 30 && event.x <= 48));
      if (isRightClickZone) {
        if (event.type === "press") return { handled: true };
        if (event.type === "click") {
          this.options.onTitleRightClick?.();
          return { handled: true };
        }
      }
      if (event.type === "press") return { handled: true };
      if (event.type === "click") {
        this.expanded = !this.expanded;
        if (this.options.onToggle) this.options.onToggle(this.expanded);
        if (this.options.requestRender) this.options.requestRender();
        return { handled: true };
      }
    }

    if (event.y !== undefined && event.y > 0) {
      const childEvent = { ...event, y: event.y - 1 };
      if (this.expanded) {
        return this.childrenStack.handleMouse(childEvent);
      } else if (this.collapsedStack) {
        return this.collapsedStack.handleMouse(childEvent);
      }
    }
    return undefined;
  }

  invalidate() {
    this.childrenStack.invalidate();
    this.collapsedStack?.invalidate();
  }
}
