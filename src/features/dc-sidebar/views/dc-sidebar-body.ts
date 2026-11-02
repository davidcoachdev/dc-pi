import type { Component } from "@earendil-works/pi-tui";
import { justifyRow } from "../../../ui/dc-row.ts";
import { DcVStack } from "../../../ui/dc-vstack.ts";
import {
  createStatusCard,
  createProjectStatusCard,
  createFleetQuotaCard,
  createMemoryVaultCard,
  createSystemCard,
} from "../components/dc-sidebar-status-card.ts";
import { createTodoCard } from "../components/dc-sidebar-todo-card.ts";
import { createAgentsCard } from "../components/dc-sidebar-agents-card.ts";
import { createContextCard } from "../components/dc-sidebar-context-card.ts";
import { createProjectTreeCard } from "../components/dc-sidebar-tree-card.ts";
import { readSidebarPrefs } from "../core/dc-sidebar-prefs.ts";

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

/**
 * Ruteador reactivo de vistas por pestaña para el cuerpo del Sidebar.
 */
export class DcSidebarPagedBody implements Component {
  private activeTab: string;
  private currentComponent: Component;
  private tui: any;
  private reqRender: () => void;
  private projectRoot: string;

  constructor(tui: any) {
    this.tui = tui;
    this.projectRoot = process.cwd();
    this.reqRender = () => { 
      try {
        const cache = this.tui?.terminal?.[Symbol.for("gentle-pi.experimental-sidebar.cache")];
        if (cache) cache.revision = (cache.revision ?? 0) + 1;
        this.tui?.requestRender?.(); 
      } catch {}
    };

    const prefs = readSidebarPrefs();
    this.activeTab = prefs.activeTab || "main";
    this.currentComponent = this.buildTabComponent(this.activeTab);
  }

  setTab(tabId: string): void {
    if (this.activeTab !== tabId) {
      this.activeTab = tabId;
      this.currentComponent = this.buildTabComponent(tabId);
      this.reqRender();
    }
  }

  getActiveTab(): string {
    return this.activeTab;
  }

  private buildTabComponent(tabId: string): Component {
    switch (tabId) {
      case "fleet": {
        // [2:FLEET] Quotas de proveedores, Flota de Taxis y Subagentes efímeros
        const fleetCard = createFleetQuotaCard(this.reqRender);
        const agentsCard = createAgentsCard(this.tui, this.reqRender, { hideWhenEmpty: false });
        return new DcPadding(new DcVStack([fleetCard, agentsCard]), 0, 0, 1);
      }
      case "tree": {
        // [3:TREE] Explorador de Archivos del Proyecto
        const treeCard = createProjectTreeCard(this.projectRoot, undefined, this.reqRender);
        return new DcPadding(treeCard, 0, 0, 1);
      }
      case "mem": {
        // [4:MEM] Memoria Soberana: Engram Daemon + Centinela
        const memCard = createMemoryVaultCard(this.reqRender);
        return new DcPadding(memCard, 0, 0, 1);
      }
      case "sys": {
        // [5:SYS] Perfiles de Modelo + MCP Servers
        const sysCard = createSystemCard(this.reqRender);
        return new DcPadding(sysCard, 0, 0, 1);
      }
      case "main":
      default: {
        // [1:MAIN] Dashboard Central: Proyecto + Contexto + Todos
        const projectCard = createProjectStatusCard(this.reqRender);
        const contextCard = createContextCard();
        const todoCard = createTodoCard(this.tui, this.reqRender, { hideWhenEmpty: true });
        return new DcPadding(new DcVStack([projectCard, contextCard, todoCard]), 0, 0, 1);
      }
    }
  }

  render(width: number): string[] {
    return this.currentComponent.render(width);
  }

  invalidate(): void {
    this.currentComponent.invalidate?.();
  }

  handleMouse(event: any) {
    return (this.currentComponent as any).handleMouse?.(event);
  }
}

let activePagedBody: DcSidebarPagedBody | undefined;

export function getSidebarPagedBody(): DcSidebarPagedBody | undefined {
  return activePagedBody;
}

export function createSidebarBody(tui: any): Component {
  activePagedBody = new DcSidebarPagedBody(tui);
  return activePagedBody;
}
