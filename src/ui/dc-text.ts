import type { Component } from "@earendil-works/pi-tui";

export class DcText implements Component {
  constructor(public text: string) {}

  render(width: number): string[] {
    if (this.text === "─") {
      return ["\x1b[2m" + "─".repeat(Math.max(0, width)) + "\x1b[22m"];
    }
    const t = this.text;
    const plainLength = t.replace(/\x1b\[[0-9;]*m/g, "").length;
    return [t + " ".repeat(Math.max(0, width - plainLength))];
  }

  invalidate() {}
}
