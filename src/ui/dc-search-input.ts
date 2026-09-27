import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";

export interface DcSearchInputOptions {
  /** Placeholder when query is empty. Defaults to "Buscar..." */
  placeholder?: string;
  /** Fixed visible width for the query text area (default: 32). */
  width?: number;
  /** Custom theme color functions (optional). */
  theme?: {
    fg?: (color: string, text: string) => string;
    bold?: (text: string) => string;
  };
  /** Show (Esc limpia) hint when there is active text. Defaults to true. */
  showEscHint?: boolean;
}

/**
 * Reusable, single-line search input box with horizontal autoscroll.
 * Keeps a fixed visible width so the surrounding UI never stretches or shifts
 * when typing long queries.
 */
export class DcSearchInput {
  private query: string = "";
  private width: number;
  private placeholder: string;
  private showEscHint: boolean;
  private theme?: {
    fg?: (color: string, text: string) => string;
    bold?: (text: string) => string;
  };

  constructor(options: DcSearchInputOptions = {}) {
    this.width = options.width ?? 32;
    this.placeholder = options.placeholder ?? "Buscar...";
    this.showEscHint = options.showEscHint ?? true;
    this.theme = options.theme;
  }

  getPlaceholder(): string {
    return this.placeholder;
  }

  setPlaceholder(p: string): void {
    this.placeholder = p;
  }

  getQuery(): string {
    return this.query;
  }

  setQuery(q: string): void {
    this.query = q;
  }

  clear(): void {
    this.query = "";
  }

  isEmpty(): boolean {
    return this.query.length === 0;
  }

  append(char: string): void {
    this.query += char;
  }

  backspace(): boolean {
    if (this.query.length > 0) {
      this.query = this.query.slice(0, -1);
      return true;
    }
    return false;
  }

  /**
   * Returns the query formatted with sliding-window scrolling to fit inside `maxChars`.
   * When query length exceeds `maxChars`, it keeps the tail visible so the user
   * always sees the cursor and the last typed character.
   */
  getVisibleQuery(maxChars: number = this.width): string {
    if (!this.query) return "";
    const vLen = visibleWidth(this.query);
    if (vLen <= maxChars) {
      return this.query;
    }
    // Tail sliding window: take the rightmost characters that fit in maxChars
    // Add a subtle left indicator '…' to show there is text scrolled to the left
    const avail = Math.max(1, maxChars - 1);
    const tail = this.query.slice(-avail);
    return `…${tail}`;
  }

  /**
   * Renders the complete search line box with icon, text and esc hint.
   * Total width is guaranteed not to exceed totalWidth.
   */
  render(totalWidth: number = this.width): string {
    const fg = this.theme?.fg ?? ((_c, text) => text);
    const bold = this.theme?.bold ?? ((text) => text);

    const icon = `${fg("accent", "🔍")} `;
    const iconW = visibleWidth(icon);
    const escHintText = this.showEscHint && this.query ? ` ${fg("dim", "(Esc limpia)")}` : "";
    const escW = visibleWidth(escHintText);

    // Remaining width available for query text
    const queryAvailW = Math.max(8, totalWidth - iconW - escW);

    let queryText = "";
    if (this.query) {
      const visibleQ = this.getVisibleQuery(queryAvailW);
      queryText = bold(fg("text", visibleQ));
    } else {
      queryText = fg("dim", truncateToWidth(this.placeholder, queryAvailW, ""));
    }

    const raw = `${icon}${queryText}${escHintText}`;
    const rawVLen = visibleWidth(raw);
    const padCount = Math.max(0, totalWidth - rawVLen);
    return raw + " ".repeat(padCount);
  }
}
