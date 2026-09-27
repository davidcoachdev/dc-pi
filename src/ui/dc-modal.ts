import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type {
  OverlayAnchor,
  OverlayOptions,
  SizeValue,
  TUI,
} from "@earendil-works/pi-tui";
import { DcWindow, type DcFrame, type DcWindowContent } from "./dc-window.ts";

export type DcModalContentFactory<T> = (
  done: (value?: T) => void,
  theme: Theme,
  tui: TUI,
) => DcWindowContent;

export type DcModalFooter<T = void> =
  | string
  | { left: string; right?: string }
  | ((theme: Pick<Theme, "fg" | "bg" | "bold">) => string | { left: string; right?: string })
  | (() => string | { left: string; right?: string });

export interface DcModalOptions<T = void> {
  title: string | (() => string);
  glyph?: string;
  content: DcWindowContent | DcModalContentFactory<T>;
  footer?: DcModalFooter<T>;
  /** Optional callback fired when the right control in the footer is clicked. */
  onFooterRightClick?: () => void;
  paddingX?: number;
  titleBarBackground?: boolean;
  frame?: DcFrame;
  width?: SizeValue;
  maxHeight?: SizeValue | (() => number);
  anchor?: OverlayAnchor;
  /** Whether the window can be moved by dragging the title bar. Default true. */
  draggable?: boolean;
  /** Whether the body is scrollable. Default true. */
  scrollable?: boolean;
  /** Whether to show retro scrollbar when scrollable. Default true. */
  showScrollbar?: boolean;
  /** Custom fallback if called in non-TUI mode. */
  onNonTui?: () => T | undefined;
  /** Optional callback fired when the modal closes. */
  onClose?: (result?: T) => void;
}

/**
 * Cerrojo global que garantiza que solo exista UNA ventana flotante activa de DC Studio a la vez.
 * Evita que el usuario presione varias veces un atajo o comando y colapse la terminal con ventanas encimadas.
 */
let isAnyDcModalOpen = false;

/** Comprueba si ya hay una ventana flotante de DC Studio abierta. */
export function isDcModalActive(tui?: any): boolean {
  if (!isAnyDcModalOpen) return false;
  if (tui && typeof tui.hasOverlay === "function" && !tui.hasOverlay()) {
    isAnyDcModalOpen = false;
    return false;
  }
  return true;
}

/**
 * Open a DC Studio modal window over the active TUI session.
 * Centralizes TUI validation, single-modal exclusivity lock, idempotent closure,
 * DcWindow wrapping, keyboard/mouse event dispatch and title bar drag movement.
 */
export async function openDcModal<T = void>(
  ctx: ExtensionContext,
  options: DcModalOptions<T>,
): Promise<T | undefined> {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    if (options.onNonTui) {
      return options.onNonTui();
    }
    return undefined;
  }

  // Si la bandera está en true pero la TUI ya no tiene ningún overlay activo, resetear defensivamente
  const activeTui = (globalThis as any)[Symbol.for("dc.sidebar.tui-ref")];
  if (isAnyDcModalOpen && activeTui && typeof activeTui.hasOverlay === "function" && !activeTui.hasOverlay()) {
    isAnyDcModalOpen = false;
  }

  // Si ya hay un modal abierto, descartamos aperturas concurrentes para proteger la TUI
  if (isAnyDcModalOpen) {
    return undefined;
  }

  isAnyDcModalOpen = true;

  let finalResult: T | undefined = undefined;
  let settled = false;

  let offsetX = 0;
  let offsetY = 0;

  try {
    const result = await ctx.ui.custom<T | undefined>(
      (tui, theme, _kb, done) => {
        const close = (val?: T) => {
          if (!settled) {
            settled = true;
            isAnyDcModalOpen = false;
            finalResult = val;
            options.onClose?.(val);
            done(val);
          }
        };

        const resolvedContent: DcWindowContent =
          typeof options.content === "function"
            ? (options.content as DcModalContentFactory<T>)(close, theme, tui)
            : options.content;

        let dynamicHeight: number | (() => number) | undefined = undefined;
        if (typeof options.maxHeight === "function") {
          dynamicHeight = options.maxHeight;
        } else if (typeof options.maxHeight === "number") {
          dynamicHeight = options.maxHeight;
        } else if (typeof options.maxHeight === "string" && options.maxHeight.endsWith("%")) {
          const pct = parseFloat(options.maxHeight) / 100;
          dynamicHeight = () => Math.max(8, Math.floor(((tui as any)?.terminal?.rows ?? process.stdout?.rows ?? 40) * pct));
        }

        const resolvedFooter = typeof options.footer === "function"
          ? () => (options.footer as Function)(theme)
          : options.footer;

        const window = new DcWindow({
          title: options.title,
          glyph: options.glyph ?? "⛩ ",
          content: resolvedContent,
          theme,
          onClose: () => close(undefined),
          onMove: options.draggable !== false
            ? (dx, dy) => {
                offsetX += dx;
                offsetY += dy;
                tui.requestRender();
              }
            : undefined,
          footer: resolvedFooter,
          onFooterRightClick: options.onFooterRightClick,
          paddingX: options.paddingX,
          titleBarBackground: options.titleBarBackground,
          frame: options.frame ?? "double",
          maxHeight: dynamicHeight,
          scrollable: options.scrollable,
          showScrollbar: options.showScrollbar,
        });

        return {
          [Symbol.for("dc.window")]: true,
          render: (w: number) => window.render(w),
          invalidate: () => window.invalidate(),
          handleInput: (data: string) => {
            const handled = window.handleInput(data);
            if (handled) tui.requestRender();
          },
          handleMouse: (event) => {
            const res = window.handleMouse(event);
            if (res?.render) tui.requestRender();
            return res;
          },
        };
      },
      {
        overlay: true,
        overlayOptions: (): OverlayOptions => ({
          anchor: options.anchor ?? "center",
          width: options.width ?? "50%",
          maxHeight: typeof options.maxHeight === "function" ? options.maxHeight() : (options.maxHeight ?? "80%"),
          offsetX,
          offsetY,
        }),
      },
    );

    return finalResult !== undefined ? finalResult : result;
  } finally {
    isAnyDcModalOpen = false;
  }
}
