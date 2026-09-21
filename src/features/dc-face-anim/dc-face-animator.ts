import type { ExtensionContext, WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";
import type { AgentState, AgentVisualStateStore } from "../../core/dc-agent-state/dc-agent-state.ts";
import { getFaceFrames } from "./dc-face-anim-frames.ts";

export interface DcFaceAnimatorOptions {
  /** Intervalo en milisegundos entre frames de animación (por defecto 250ms). */
  intervalMs?: number;
  /** Función opcional para colorear el frame de texto. */
  colorFn?: (frame: string, state: AgentState) => string;
  /** Si el animador está activo. */
  enabled?: boolean;
}

/**
 * Conecta el almacén de estados del agente (AgentVisualStateStore) con el indicador
 * de trabajo de Pi (ctx.ui.setWorkingIndicator) usando los kaomojis animados de DC Studio.
 */
export class DcFaceAnimator {
  private enabled: boolean;
  private intervalMs: number;
  private colorFn: (frame: string, state: AgentState) => string;
  private unsubscribe?: () => void;
  private activeCtx?: ExtensionContext;

  constructor(
    private readonly store: AgentVisualStateStore,
    options: DcFaceAnimatorOptions = {},
  ) {
    this.enabled = options.enabled ?? true;
    this.intervalMs = options.intervalMs ?? 250;
    this.colorFn = options.colorFn ?? ((f) => f);

    this.unsubscribe = this.store.subscribe((state) => {
      this.onStateChange(state);
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(val: boolean): void {
    this.enabled = val;
    if (this.activeCtx) {
      if (val) {
        this.applyIndicator(this.activeCtx, this.store.getState());
      } else {
        this.activeCtx.ui.setWorkingIndicator();
      }
    }
  }

  attachUI(ctx: ExtensionContext): void {
    this.activeCtx = ctx;
    if (this.enabled) {
      this.applyIndicator(ctx, this.store.getState());
    }
  }

  detachUI(): void {
    if (this.activeCtx) {
      this.activeCtx.ui.setWorkingIndicator();
      this.activeCtx = undefined;
    }
  }

  getWorkingIndicatorOptions(state: AgentState): WorkingIndicatorOptions {
    const rawFrames = getFaceFrames(state);
    const coloredFrames = rawFrames.map((f) => this.colorFn(f, state));

    return {
      frames: coloredFrames,
      intervalMs: this.intervalMs,
    };
  }

  private applyIndicator(ctx: ExtensionContext, state: AgentState): void {
    if (!ctx.hasUI) return;
    try {
      const options = this.getWorkingIndicatorOptions(state);
      ctx.ui.setWorkingIndicator(options);
    } catch {
      /* noop si no está disponible */
    }
  }

  private onStateChange(state: AgentState): void {
    if (this.activeCtx && this.enabled) {
      this.applyIndicator(this.activeCtx, state);
    }
  }

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    this.detachUI();
  }
}
