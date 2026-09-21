import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";

export class DcVStack implements Component {
  private lineMap: Array<{ comp: Component; startY: number; endY: number }> = [];

  constructor(public children: Component[]) {}

  render(width: number): string[] {
    const out: string[] = [];
    this.lineMap = [];
    for (const c of this.children) {
      if (!c) continue;
      const startY = out.length;
      const lines = c.render(width) || [];
      out.push(...lines);
      this.lineMap.push({ comp: c, startY, endY: startY + lines.length });
    }
    return out;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.y === undefined) return undefined;
    for (const m of this.lineMap) {
      if (event.y >= m.startY && event.y < m.endY) {
        const childEvent = { ...event, y: event.y - m.startY };
        if (typeof (m.comp as any).handleMouse === "function") {
          const res = (m.comp as any).handleMouse(childEvent);
          if (res?.handled) return res;
        }
      }
    }
    return undefined;
  }

  invalidate() {
    this.children.forEach(c => c?.invalidate?.());
  }
}
