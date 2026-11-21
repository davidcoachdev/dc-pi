import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { DcTabs, type DcTabItem } from "../../../ui/dc-tabs.ts";
import { readSidebarPrefs, writeSidebarPrefs } from "../core/dc-sidebar-prefs.ts";

export const SIDEBAR_TABS: readonly DcTabItem[] = [
  { id: "main", key: "1", label: "MAIN" },
  { id: "work", key: "2", label: "WORK" },
  { id: "taxis", key: "3", label: "TAXIS" },
  { id: "ctrl", key: "4", label: "CTRL" },
  { id: "mobile", key: "5", label: "MOBILE" },
  { id: "tree", key: "6", label: "TREE" },
  { id: "mem", key: "7", label: "MEM" },
  { id: "sys", key: "8", label: "SYS" },
];

export class DcSidebarTabs implements Component {
  private tabsComponent: DcTabs;
  private onTabChange?: (tabId: string) => void;

  constructor(theme?: any, onTabChange?: (tabId: string) => void) {
    const prefs = readSidebarPrefs();
    const activeTab = prefs.activeTab || "main";
    this.onTabChange = onTabChange;

    this.tabsComponent = new DcTabs({
      theme,
      tabs: [...SIDEBAR_TABS],
      activeId: activeTab,
      variant: "sentinel",
      prefixGlyph: "⛩️ ",
      fullWidthBorder: true,
      paddingX: 1,
      onSelect: (id) => {
        writeSidebarPrefs({ activeTab: id });
        this.onTabChange?.(id);
      },
    });
  }

  getTabs(): readonly DcTabItem[] {
    return this.tabsComponent.options.tabs;
  }

  setTabs(tabs: DcTabItem[]): void {
    this.tabsComponent.options.tabs = [...tabs];
    this.invalidate();
  }

  getActiveTab(): string {
    return this.tabsComponent.getActiveId();
  }

  setActiveTab(id: string): void {
    this.tabsComponent.setActiveId(id);
    writeSidebarPrefs({ activeTab: id });
    this.onTabChange?.(id);
  }

  render(width: number): string[] {
    return this.tabsComponent.render(width);
  }

  invalidate(): void {
    this.tabsComponent.invalidate();
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    return this.tabsComponent.handleMouse(event);
  }
}
