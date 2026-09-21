/**
 * caritas — picker de kaomoji con Alt+C o /caritas.
 *
 * Abre un modal flotante DcWindow estilo Windows 3.1 / DOS
 * con selección completa estilo dc-changes (barra selectedBg a todo el ancho,
 * rueda del mouse ítem por ítem, clic directo y enter para pegar en el editor).
 *
 * Instalación: este archivo vive en `~/.pi/agent/extensions/`,
 * pi lo autodescubre. Aplicá cambios con `/reload` dentro de pi.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Component,
	type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { DcWindow } from "./dc-window.ts";

// ── Caritas: base dc-face (una por estado) + clásicas ──
const CARITAS: Array<{ face: string; mood: string }> = [
	// dc-face
	{ face: "≧( ❂‿❂ )≦", mood: "feliz" },
	{ face: "( ≖.≖ )", mood: "pensando" },
	{ face: "m(◔◡◔)m", mood: "escribiendo" },
	{ face: "^( '-' )^", mood: "trabajando" },
	{ face: "( -_- ) z Z Z", mood: "dormido" },
	{ face: "( ◐.◐ )", mood: "compactando" },
	{ face: "( ʘ‿ʘ )", mood: "reintentando" },
	{ face: "( ʘoʘ )", mood: "hablando" },
	{ face: "( ◐‿◐ )!", mood: "permiso" },
	{ face: "( ◐‿◐ )?", mood: "pregunta" },
	// clásicas
	{ face: "¯\\_(ツ)_/¯", mood: "meh" },
	{ face: "( ͡° ͜ʖ ͡°)", mood: "lenny" },
	{ face: "ʕ•ᴥ•ʔ", mood: "osito" },
	{ face: "(╯°□°）╯", mood: "flip" },
	{ face: "(¬‿¬)", mood: "cómplice" },
	{ face: "(◕‿◕)", mood: "contento" },
	{ face: "(＾▽＾)", mood: "alegre" },
	{ face: "(//∇//)", mood: "sonrojado" },
	{ face: "(¬_¬)", mood: "sospecha" },
	{ face: "(づ｡◕‿‿◕｡)づ", mood: "abrazo" },
];

const CARITAS_ROWS_PAGE = 10;

class CaritasPanel implements Component {
	private selectedIndex = 0;
	private scrollOffset = 0;
	private lastWidth = 0;
	private lastRows = 0;

	constructor(
		private readonly items: Array<{ value: string; label: string; description: string }>,
		private readonly theme: Theme,
		private readonly onSelect: (val: string) => void,
		private readonly onCancel: () => void,
		private readonly requestRender: () => void,
	) {}

	invalidate(): void {}

	private ensureCursorVisible(): void {
		this.selectedIndex = Math.max(0, Math.min(this.items.length - 1, this.selectedIndex));
		const maxOff = Math.max(0, this.items.length - CARITAS_ROWS_PAGE);
		if (this.selectedIndex < this.scrollOffset) {
			this.scrollOffset = this.selectedIndex;
		} else if (this.selectedIndex >= this.scrollOffset + CARITAS_ROWS_PAGE) {
			this.scrollOffset = Math.max(0, this.selectedIndex - CARITAS_ROWS_PAGE + 1);
		}
		this.scrollOffset = Math.max(0, Math.min(maxOff, this.scrollOffset));
	}

	render(width: number): string[] {
		const t = this.theme;
		const innerW = Math.max(20, width);
		this.lastWidth = innerW;
		this.lastRows = Math.min(this.items.length, CARITAS_ROWS_PAGE);
		this.ensureCursorVisible();

		const pad = (s: string, len: number) => {
			const v = visibleWidth(s);
			return v >= len ? truncateToWidth(s, len, "") : s + " ".repeat(len - v);
		};

		const visible = this.items.slice(this.scrollOffset, this.scrollOffset + CARITAS_ROWS_PAGE);
		const out: string[] = [];

		for (let i = 0; i < visible.length; i++) {
			const itemIdx = this.scrollOffset + i;
			const item = visible[i]!;
			const isSelected = itemIdx === this.selectedIndex;

			const bullet = isSelected ? t.fg("accent", "●") : t.fg("dim", "○");
			const face = pad(item.label, 18);
			const mood = t.fg("muted", `[${item.description}]`);
			const rawRow = ` ${bullet} ${face} ${mood}`;
			const paddedRow = pad(rawRow, innerW);

			if (isSelected) {
				out.push(t.bg("selectedBg", t.bold(paddedRow)));
			} else {
				out.push(t.fg("text", paddedRow));
			}
		}

		// Relleno de filas si son menos del alto de página
		for (let i = visible.length; i < CARITAS_ROWS_PAGE; i++) {
			out.push(" ".repeat(innerW));
		}

		return out;
	}

	handleInput(data: string): boolean {
		if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
			this.onCancel();
			return true;
		}
		if (matchesKey(data, Key.up)) {
			if (this.selectedIndex > 0) {
				this.selectedIndex--;
				this.ensureCursorVisible();
				this.requestRender();
			}
			return true;
		}
		if (matchesKey(data, Key.down)) {
			if (this.selectedIndex < this.items.length - 1) {
				this.selectedIndex++;
				this.ensureCursorVisible();
				this.requestRender();
			}
			return true;
		}
		if (matchesKey(data, Key.pageUp)) {
			this.selectedIndex = Math.max(0, this.selectedIndex - CARITAS_ROWS_PAGE);
			this.ensureCursorVisible();
			this.requestRender();
			return true;
		}
		if (matchesKey(data, Key.pageDown)) {
			this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + CARITAS_ROWS_PAGE);
			this.ensureCursorVisible();
			this.requestRender();
			return true;
		}
		if (matchesKey(data, Key.home)) {
			this.selectedIndex = 0;
			this.ensureCursorVisible();
			this.requestRender();
			return true;
		}
		if (matchesKey(data, Key.end)) {
			this.selectedIndex = Math.max(0, this.items.length - 1);
			this.ensureCursorVisible();
			this.requestRender();
			return true;
		}
		if (matchesKey(data, Key.enter) || data === " ") {
			const item = this.items[this.selectedIndex];
			if (item) this.onSelect(item.value);
			return true;
		}
		return false;
	}

	handleMouse(event: TuiMouseEvent): { handled: boolean } | undefined {
		const { type } = event;
		const delta = (event as { wheelDelta?: number }).wheelDelta ?? 0;
		const y = (event as { y?: number }).y ?? 0;

		// Rueda: navega elemento por elemento (estilo dc-changes)
		if (type === "wheel" && delta !== 0) {
			if (delta > 0) {
				this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
			} else {
				this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			}
			this.ensureCursorVisible();
			this.requestRender();
			return { handled: true };
		}

		// Clic: selecciona y enfoca. Si ya estaba seleccionado, aplica.
		if (type === "click" && (event as { button?: string }).button !== "right") {
			const clickedIdx = this.scrollOffset + y;
			if (clickedIdx >= 0 && clickedIdx < this.items.length) {
				if (this.selectedIndex === clickedIdx) {
					// Segundo clic en el mismo elemento: aplica
					const item = this.items[clickedIdx];
					if (item) this.onSelect(item.value);
				} else {
					// Primer clic: selecciona fila con barra selectedBg
					this.selectedIndex = clickedIdx;
					this.requestRender();
				}
				return { handled: true };
			}
		}

		return undefined;
	}
}

/**
 * Selector en VENTANA FLOTANTE DcWindow estilo Windows 3.1 / DOS.
 * Retorna el `value` elegido o `null` si se cancela con esc.
 */
async function floatingSelect(
	ctx: ExtensionContext,
	title: string,
	options: Array<{ value: string; label: string; description: string }>,
): Promise<string | null> {
	if (ctx.mode !== "tui") {
		const choice = await ctx.ui.select(
			title,
			options.map((o) => o.label),
		);
		if (!choice) return null;
		return options.find((o) => o.label === choice)?.value ?? null;
	}

	const result = await ctx.ui.custom<string | null>(
		(tui, theme, _kb, done) => {
			const panel = new CaritasPanel(
				options,
				theme,
				(val) => done(val),
				() => done(null),
				() => tui.requestRender(),
			);

			const win = new DcWindow({
				title,
				glyph: "☻",
				theme,
				content: panel,
				footer: `${theme.fg("accent", "↑/↓ / Clic")} elegir   ${theme.fg("accent", "Rueda/PgUp/Dn")} scroll   ${theme.fg("accent", "Enter")} pegar   ${theme.fg("accent", "esc/q")} cerrar`,
				onClose: () => done(null),
				paddingX: 1,
				frame: "double",
			});

			return {
				[Symbol.for("dc.window")]: true,
				render: (w) => win.render(w),
				invalidate: () => win.invalidate(),
				handleInput: (data) => {
					win.handleInput(data);
					tui.requestRender();
				},
				handleMouse: (event) => {
					const res = win.handleMouse(event);
					if (res) tui.requestRender();
					return res;
				},
			};
		},
		{
			overlay: true,
			overlayOptions: { anchor: "center", width: "44%", maxHeight: "78%" },
		},
	);
	return result ?? null;
}

export default function (pi: ExtensionAPI) {
	async function showCaritas(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI) {
			ctx.ui.notify("caritas necesita TUI (no hay UI en este modo).", "error");
			return;
		}
		const picked = await floatingSelect(
			ctx,
			"Caritas — ¿cuál pegamos?",
			CARITAS.map((c) => ({
				value: c.face,
				label: c.face,
				description: c.mood,
			})),
		);
		if (!picked) return; // esc sale
		ctx.ui.pasteToEditor(picked);
		ctx.ui.notify(`✔ ${picked} → editor`, "info");
	}

	pi.registerCommand("caritas", {
		description: "Picker de kaomoji: elegí una carita y la pega en el editor",
		handler: async (_args, ctx) => {
			await showCaritas(ctx);
		},
	});
}
