import type { Component } from "@earendil-works/pi-tui";
import { justifyRow } from "../../../ui/dc-row.ts";
import { DcVStack } from "../../../ui/dc-vstack.ts";
import { createStatusCard } from "../components/dc-sidebar-status-card.ts";
import { createTodoCard } from "../components/dc-sidebar-todo-card.ts";
import { createAgentsCard } from "../components/dc-sidebar-agents-card.ts";
import { createContextCard } from "../components/dc-sidebar-context-card.ts";

export class DcPadding implements Component {
  constructor(
    private child: Component, 
    private padTop: number = 0, 
    private padBottom: number = 0, 
    private padX: number = 1
  ) {}
  
  render(width: number): string[] {
    const innerWidth = Math.max(0, width - this.padX * 2);
    const lines = this.child.render(innerWidth) || [];
    
    const padStr = " ".repeat(this.padX);
    const paddedLines = lines.map(l => padStr + l + padStr);
    
    const empty = " ".repeat(width);
    const topPad = new Array(this.padTop).fill(empty);
    const botPad = new Array(this.padBottom).fill(empty);
    
    return [...topPad, ...paddedLines, ...botPad];
  }
  
  invalidate() { this.child.invalidate?.(); }
  
  handleMouse(event: any) {
    if (event.y >= this.padTop) {
      const childEvent = { ...event, y: event.y - this.padTop };
      if (typeof childEvent.x === "number") {
        childEvent.x -= this.padX;
      }
      return (this.child as any).handleMouse?.(childEvent);
    }
    return undefined;
  }
}

export class DcJustifiedRow implements Component {
  constructor(
    public left: string | (() => string),
    public right: string | (() => string),
    public onClick?: () => void,
  ) {}
  render(width: number): string[] {
    const leftText = typeof this.left === "function" ? this.left() : this.left;
    const rightText = typeof this.right === "function" ? this.right() : this.right;
    return [justifyRow(leftText, rightText, width)];
  }
  invalidate() {}
  handleMouse(event: any) {
    if (!this.onClick) return undefined;
    if (event.button !== undefined && event.button !== "left") return undefined;
    if (event.type === "press") {
      return { handled: true };
    }
    if (event.type === "click") {
      this.onClick();
      return { handled: true };
    }
    return undefined;
  }
}

export function createSidebarBody(tui: any): Component {
  const reqRender = () => { 
    try {
      const cache = tui?.terminal?.[Symbol.for("gentle-pi.experimental-sidebar.cache")];
      if (cache) cache.revision = (cache.revision ?? 0) + 1;
      tui?.requestRender?.(); 
    } catch {}
  };

  // Ensamblado modular y reactivo: las tarjetas de Todo y Agentes
  // siguen la regla "no se ven solo cuando se utilizan" (hideWhenEmpty: true).
  // Si no tienen tareas vivas o subagentes en ejecución, no ocupan espacio en el rail.
  const statusCard = createStatusCard(reqRender);
  const todoCard = createTodoCard(tui, reqRender, { hideWhenEmpty: true });
  const agentsCard = createAgentsCard(tui, reqRender, { hideWhenEmpty: true });
  const contextCard = createContextCard();

  const bodyStack = new DcVStack([
    statusCard,
    todoCard,
    agentsCard,
    contextCard
  ]);

  return new DcPadding(bodyStack, 0, 0, 1);
}
