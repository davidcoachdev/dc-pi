import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey } from "@earendil-works/pi-tui";

export interface DcPromptInputOptions {
  label?: string;
  initialValue?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Componente interactivo de entrada de texto para DcWindow / openDcModal.
 * Soporta caracteres imprimibles (incluyendo caracteres acentuados UTF-8),
 * retroceso (Backspace), confirmación con Enter y cancelación con Esc.
 */
export class DcPromptInputComponent implements Component {
  private value: string;
  private readonly label: string;
  private readonly placeholder: string;
  private readonly onSubmit: (value: string) => void;
  private readonly onCancel: () => void;

  constructor(
    private readonly theme: Theme,
    private readonly tui: TUI | undefined,
    options: DcPromptInputOptions,
  ) {
    this.value = options.initialValue ?? "";
    this.label = options.label ?? "Tu nombre (para el chrome de tus mensajes):";
    this.placeholder = options.placeholder ?? "Escribí tu nombre...";
    this.onSubmit = options.onSubmit;
    this.onCancel = options.onCancel;
  }

  getValue(): string {
    return this.value;
  }

  setValue(val: string): void {
    this.value = val;
    this.tui?.requestRender();
  }

  invalidate(): void {}

  render(_width: number): string[] {
    const t = this.theme;
    const cursor = t.fg("accent", "█");
    const displayValue = this.value
      ? t.fg("text", this.value) + cursor
      : t.fg("dim", this.placeholder) + cursor;

    return [
      "",
      "  " + t.fg("muted", this.label),
      "",
      "  " + t.fg("accent", "❯ ") + displayValue,
      "",
      "  " + t.fg("dim", "Enter: guardar  ·  Esc: cancelar"),
      "",
    ];
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.enter)) {
      this.onSubmit(this.value.trim());
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.onCancel();
      return;
    }

    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      if (this.value.length > 0) {
        this.value = this.value.slice(0, -1);
        this.tui?.requestRender();
      }
      return;
    }

    // Caracteres imprimibles (evita secuencias de escape ANSI o controles)
    if (!data.startsWith("\x1b") && !matchesKey(data, Key.tab)) {
      const clean = data.replace(/[\x00-\x1f\x7f]/g, "");
      if (clean.length > 0) {
        this.value += clean;
        this.tui?.requestRender();
      }
    }
  }
}
