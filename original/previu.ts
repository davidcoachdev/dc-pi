/**
 * previu — port del plugin de opencode a extensión de pi.
 *
 * Idea principal: Yazi en un pane tmux/herdr al 40%, eligiendo
 * derecha (monitor horizontal) o abajo (monitor vertical).
 * Pi se queda siempre con el 60% para que la barra siga visible.
 *
 * Atajos:
 *   Alt+V (o /previu) → menú completo (task-manager|nvim|fzf|yazi|dc)
 *
 * Instalación: este archivo ya vive en `~/.pi/agent/extensions/`,
 * pi lo autodescubre. Aplicá cambios con `/reload` dentro de pi.
 *
 * Atajos directos vía comando:
 *   /previu              → menú completo (igual que Alt+V)
 *   /previu nvim h       → nvim a la derecha sin menú
 *   /previu fzf v        → fzf abajo sin menú
 *   /previu yazi h|v     → yazi directo sin menú
 *   modos: manager | nvim | fzf | yazi | dc
 *   dirs:  h (derecha) | v (abajo) | right | down
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Key,
	matchesKey,
	type TuiMouseEvent,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DcWindow } from "./dc-window.ts";

type ToolMode = "manager" | "nvim" | "fzf" | "yazi" | "dc-studio";
type Orientation = "h" | "v";

function isHerdr(): boolean {
	return typeof process !== "undefined" && !!process.env.HERDR_PANE_ID;
}

function isTmux(): boolean {
	return typeof process !== "undefined" && !!process.env.TMUX;
}

// ── Matemática del 40% (la barra de pi siempre queda visible) ──
// tmux: `split-window -p 40` → el pane NUEVO (yazi) ocupa 40%,
//         pi conserva el 60%. -h = lado a lado, -v = arriba/abajo.
// herdr: `--ratio 0.6` → el pane ACTUAL (pi) conserva el 60%,
//         yazi recibe el 40% restante.
// En ambos casos pi nunca baja del 60%: la barra no se tapa.
const YAZI_PCT = 40;
const PI_RATIO = 0.6;


// Colores dc-studio para fzf (inline — no dependemos de que el pane cargue fzf.fish)
const FZF_COLORS =
	"--color=fg:#ffcccc,bg:#0d0d0d,hl:#ff9999,fg+:#000000,bg+:#ff3333 " +
	"--color=hl+:#ff4d4d,info:#ff6666,prompt:#ff6666,pointer:#ff3333 " +
	"--color=marker:#ff4d4d,spinner:#ff9999,header:#262626,border:#404040,gutter:#262626 ";

// fzf con tema dc-studio inline (garantiza consistencia con los alias de fish).
// Ctrl+P / Ctrl+F → toggle del preview.
// Modo "derecha" (h): preview abajo, lista arriba (layout vertical).
// Modo "abajo" (v): horizontal — lista a la DERECHA, preview a la IZQUIERDA.
const VIEWER_FZF_RIGHT =
	'set -l sel (fzf --height=100% ' +
	'--preview="bat --theme=gruvbox-dark --color=always --style=numbers {}" ' +
	"--preview-window=down,50% " +
	FZF_COLORS +
	'--bind "ctrl-p:toggle-preview,' +
	'ctrl-down:preview-down,ctrl-up:preview-up,ctrl-right:preview-page-down,ctrl-left:preview-page-up"' +
	'); and nvim "$sel"; or exec fish';

const VIEWER_FZF_DOWN =
	'set -l sel (fzf --layout=reverse --height=100% ' +
	'--preview="bat --theme=gruvbox-dark --color=always --style=numbers {}" ' +
	"--preview-window=left,50% " +
	FZF_COLORS +
	'--bind "ctrl-p:toggle-preview,' +
	'ctrl-down:preview-down,ctrl-up:preview-up,ctrl-right:preview-page-down,ctrl-left:preview-page-up"' +
	'); and nvim "$sel"; or exec fish';

function taskManagerScript(): string {
	// El plugin original apuntaba a /home/dcdebian/...; resolvemos por $HOME
	// para que ande en cualquier usuario (dc-studio, dcdebian, etc.).
	const home = os.homedir();
	const candidates = [
		path.join(home, ".local/bin/task-manager-portable-setup.sh"),
		"/home/dcdebian/.local/bin/task-manager-portable-setup.sh",
	];
	for (const c of candidates) {
		try {
			if (fs.existsSync(c)) return c;
		} catch {
			/* seguir */
		}
	}
	return candidates[0]!;
}

function readLast(path_: string): string | undefined {
	try {
		const s = fs.readFileSync(path_, "utf8").trim();
		return s || undefined;
	} catch {
		return undefined;
	}
}

async function showManagerSetup(
	cwd: string,
	ctx: ExtensionContext,
): Promise<void> {
	try {
		const script = taskManagerScript();
		if (!fs.existsSync(script)) {
			ctx.ui.notify(
				`No encontré el setup de task-manager en ${script}`,
				"error",
			);
			return;
		}
		const out = execFileSync("bash", [script, cwd], {
			encoding: "utf8",
		}) as string;

		let htmlPath = `${cwd}/task-manager-portable/Task-Manager-Portable.html`;
		const last = readLast("/tmp/task-manager-portable-last.html");
		if (last) htmlPath = last;

		let wslHtmlPath = `file://wsl.localhost/DcDev${htmlPath}`;
		const wslLast = readLast("/tmp/task-manager-portable-last-wsl.html");
		if (wslLast) wslHtmlPath = wslLast;

		const notImplemented =
			out.includes("no implementado") ||
			out.includes("Task Manager no implementado");
		if (notImplemented) {
			const lines = out
				.split("\n")
				.filter(
					(l) =>
						l.includes("no implementado") ||
						l.includes("Task Manager no implementado") ||
						l.includes("task-tracker-manager"),
				);
			const msg =
				lines.join(" — ").trim() || `Task Manager no implementado en ${cwd}`;
			ctx.ui.notify(`⚠️ Task Manager no implementado — ${msg}`, "warning");
			console.log("[previu] " + out);
			return;
		}
		const failed = out.includes("⚠️") || out.includes("Abre manualmente");
		const opened = !failed && out.includes("✔ Abierto");
		void opened;
		ctx.ui.notify(
			failed
				? `✔ task-manager instalado en ${wslHtmlPath} — abrilo manualmente (sin browser detectado)`
				: `✔ task-manager abierto en navegador: ${wslHtmlPath}`,
			failed ? "warning" : "info",
		);
		console.log("[previu] " + out);
	} catch (e) {
		console.error("[previu] task-manager setup falló:", e);
		ctx.ui.notify(`task-manager falló: ${String(e)}`, "error");
	}
}

function tmuxSplit(
	args: string[],
	ctx: ExtensionContext,
	okMsg: string,
): boolean {
	try {
		execFileSync("tmux", ["list-sessions"], { stdio: "ignore" });
	} catch {
		ctx.ui.notify(
			"No hay servidor tmux. Abrí pi dentro de tmux (ej. `ti`) y reintentá.",
			"error",
		);
		return false;
	}
	try {
		execFileSync("tmux", args, { stdio: "ignore" });
		ctx.ui.notify(okMsg, "info");
		return true;
	} catch (e) {
		console.error("[previu] tmux split falló:", e);
		ctx.ui.notify(`previu falló: ${String(e)}`, "error");
		return false;
	}
}

function herdrSplit(
	direction: "right" | "down",
	cwd: string,
	cmd: string,
	ctx: ExtensionContext,
	okMsg: string,
): boolean {
	const currentPaneId = process.env.HERDR_PANE_ID || "";
	if (!currentPaneId) {
		ctx.ui.notify("No se pudo obtener el pane ID de herdr.", "error");
		return false;
	}
	let newPaneId: string;
	try {
		const out = execFileSync(
			"herdr",
			[
				"pane",
				"split",
				currentPaneId,
				"--direction",
				direction,
				"--ratio",
				String(PI_RATIO),
				"--cwd",
				cwd,
				"--focus",
			],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		);
		const parsed = JSON.parse((out as string).trim());
		newPaneId = parsed.result.pane.pane_id;
	} catch (e) {
		console.error("[previu] herdr split falló:", e);
		ctx.ui.notify("Error al hacer split en herdr.", "error");
		return false;
	}
	try {
		execFileSync("herdr", ["pane", "run", newPaneId, "fish", "-lc", cmd], {
			stdio: "ignore",
		});
		ctx.ui.notify(okMsg, "info");
		return true;
	} catch (e) {
		console.error("[previu] herdr run falló:", e);
		ctx.ui.notify(`previu falló: ${String(e)}`, "error");
		return false;
	}
}

/** Abre nvim/fzf/yazi en un pane al 40%. `dc-studio` va por openDcStudio(). */
async function openPanel(
	mode: "nvim" | "fzf" | "yazi",
	orientation: Orientation,
	cwd: string,
	ctx: ExtensionContext,
): Promise<void> {
	const dir = cwd && cwd.trim() ? cwd : ".";
	const where = orientation === "h" ? "derecha" : "abajo";
	const flag = orientation === "v" ? "-v" : "-h";

	const fishCmd =
		mode === "nvim"
			? "nvim ."
			: mode === "yazi"
				? "yazi ."
				: orientation === "v"
					? VIEWER_FZF_DOWN
					: VIEWER_FZF_RIGHT;

	if (isTmux()) {
		const args = ["split-window", "-p", String(YAZI_PCT), flag, "-c", dir];
		args.push("fish", "-lc", fishCmd);
		tmuxSplit(args, ctx, `✔ previu — ${mode} → panel ${where} (${YAZI_PCT}%)`);
		return;
	}
	if (isHerdr()) {
		herdrSplit(
			orientation === "h" ? "right" : "down",
			dir,
			fishCmd,
			ctx,
			`✔ previu — ${mode} → panel ${where} (${YAZI_PCT}%)`,
		);
		return;
	}
	ctx.ui.notify(
		"No estás en tmux ni herdr. Abrí pi dentro de tmux o herdr y reintentá.",
		"error",
	);
}

/** dc-studio launcher: `dc` (fish -lc lo ejecuta con tu entorno fish). */
async function openDcStudio(
	orientation: Orientation,
	cwd: string,
	ctx: ExtensionContext,
): Promise<void> {
	const dir = cwd && cwd.trim() ? cwd : ".";
	const where = orientation === "h" ? "derecha" : "abajo";
	const okMsg = `✔ previu — dc-studio → panel ${where} (${YAZI_PCT}%)`;
	if (isTmux()) {
		const flag = orientation === "v" ? "-v" : "-h";
		tmuxSplit(
			["split-window", "-p", String(YAZI_PCT), flag, "-c", dir, "fish", "-lc", "dc"],
			ctx,
			okMsg,
		);
		return;
	}
	if (isHerdr()) {
		herdrSplit(
			orientation === "h" ? "right" : "down",
			dir,
			"dc",
			ctx,
			okMsg,
		);
		return;
	}
	ctx.ui.notify(
		"No estás en tmux ni herdr. Abrí pi dentro de tmux o herdr y reintentá.",
		"error",
	);
}

const TOOL_LABELS: Record<ToolMode, string> = {
	manager: "📊  task-manager",
	nvim: "📝  nvim",
	fzf: "🔍  fzf",
	yazi: "🦆  yazi",
	"dc-studio": "🧰  dc-studio",
};

function parseToolArg(s: string | undefined): ToolMode | undefined {
	if (!s) return undefined;
	const t = s.toLowerCase();
	if (t === "manager" || t === "task-manager" || t === "taskmanager")
		return "manager";
	if (t === "nvim" || t === "vim") return "nvim";
	if (t === "fzf") return "fzf";
	if (t === "yazi") return "yazi";
	if (t === "dc" || t === "dc-studio" || t === "dcstudio") return "dc-studio";
	return undefined;
}

function parseOrientationArg(s: string | undefined): Orientation | undefined {
	if (!s) return undefined;
	const t = s.toLowerCase();
	if (t === "h" || t === "right" || t === "derecha" || t === "r") return "h";
	if (t === "v" || t === "down" || t === "abajo" || t === "d") return "v";
	return undefined;
}

/**
 * Fila de encabezado: titulo a la izquierda, hint de cierre a la derecha
 * en la MISMA linea (estilo panel Agents).
 */
class TitleBar {
	private left: string;
	private right: string;

	constructor(left: string, right: string) {
		this.left = left;
		this.right = right;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const gap = Math.max(2, width - visibleWidth(this.left) - visibleWidth(this.right));
		return [truncateToWidth(`${this.left}${" ".repeat(gap)}${this.right}`, width)];
	}
}

/**
 * Separador horizontal que engancha en los bordes laterales.
 */
class Rule {
	private color: (s: string) => string;

	constructor(color: (s: string) => string) {
		this.color = color;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return [this.color("\u251c" + "\u2500".repeat(Math.max(1, width - 2)) + "\u2524")];
	}
}

/**
 * Caja de bordes COMPLETOS y CUADRADOS: esquinas ┌┐└┘ y laterales │.
 * Envuelve el contenido y lo rellena al ancho disponible (respetando
 * códigos ANSI al medir con visibleWidth).
 */
class SquareBox {
	private content: {
		render(width: number): string[];
		invalidate(): void;
	};
	private color: (s: string) => string;

	constructor(
		content: { render(width: number): string[]; invalidate(): void },
		color: (s: string) => string,
	) {
		this.content = content;
		this.color = color;
	}

	invalidate(): void {
		this.content.invalidate();
	}

	render(width: number): string[] {
		const inner = Math.max(4, width - 2);
		const top = this.color("┌" + "─".repeat(inner) + "┐");
		const bottom = this.color("└" + "─".repeat(inner) + "┘");
		const side = this.color("│");
		const lines = this.content.render(inner).map((line) => {
			const v = visibleWidth(line);
			const cell =
				v > inner
					? truncateToWidth(line, inner)
					: line + " ".repeat(inner - v);
			return `${side}${cell}${side}`;
		});
		return [top, ...lines, bottom];
	}
}

/**
 * Selector en VENTANA FLOTANTE (modal centrado sobre el TUI),
 * no inline en la barra del editor.
 * Fuera del TUI (RPC/print) `custom()` no anda → fallback al select inline.
 * Retorna el `value` elegido o `null` si se cancela (esc o Cancelar).
 */
class PreviuSelectPanel implements Component {
	private selectedIndex = 0;
	private scrollOffset = 0;

	constructor(
		private readonly items: Array<{ value: string; label: string; description?: string }>,
		private readonly theme: Theme,
		private readonly onSelect: (val: string) => void,
		private readonly onCancel: () => void,
		private readonly requestRender: () => void,
	) {}

	invalidate(): void {}

	private ensureCursorVisible(): void {
		this.selectedIndex = Math.max(0, Math.min(this.items.length - 1, this.selectedIndex));
		const maxOff = Math.max(0, this.items.length - 8);
		if (this.selectedIndex < this.scrollOffset) {
			this.scrollOffset = this.selectedIndex;
		} else if (this.selectedIndex >= this.scrollOffset + 8) {
			this.scrollOffset = Math.max(0, this.selectedIndex - 8 + 1);
		}
		this.scrollOffset = Math.max(0, Math.min(maxOff, this.scrollOffset));
	}

	render(width: number): string[] {
		const t = this.theme;
		const innerW = Math.max(20, width);
		this.ensureCursorVisible();

		const pad = (s: string, len: number) => {
			const v = visibleWidth(s);
			return v >= len ? truncateToWidth(s, len, "") : s + " ".repeat(len - v);
		};

		const visible = this.items.slice(this.scrollOffset, this.scrollOffset + 8);
		const out: string[] = [];

		for (let i = 0; i < visible.length; i++) {
			const itemIdx = this.scrollOffset + i;
			const item = visible[i]!;
			const isSelected = itemIdx === this.selectedIndex;

			const bullet = isSelected ? t.fg("accent", "●") : t.fg("dim", "○");
			const label = item.label;
			const desc = item.description ? t.fg("muted", ` (${item.description})`) : "";
			const rawRow = ` ${bullet} ${label}${desc}`;
			const paddedRow = pad(rawRow, innerW);

			if (isSelected) {
				out.push(t.bg("selectedBg", t.bold(paddedRow)));
			} else {
				out.push(t.fg("text", paddedRow));
			}
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

		if (type === "click" && (event as { button?: string }).button !== "right") {
			const clickedIdx = this.scrollOffset + y;
			if (clickedIdx >= 0 && clickedIdx < this.items.length) {
				if (this.selectedIndex === clickedIdx) {
					const item = this.items[clickedIdx];
					if (item) this.onSelect(item.value);
				} else {
					this.selectedIndex = clickedIdx;
					this.requestRender();
				}
				return { handled: true };
			}
		}

		return undefined;
	}
}

async function floatingSelect(
	ctx: ExtensionContext,
	title: string,
	options: Array<{ value: string; label: string; description?: string }>,
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
			const panel = new PreviuSelectPanel(
				options,
				theme,
				(val) => done(val),
				() => done(null),
				() => tui.requestRender(),
			);
			const win = new DcWindow({
				title,
				glyph: "▸",
				theme,
				content: panel,
				footer: `${theme.fg("accent", "↑/↓ / Clic")} elegir   ${theme.fg("accent", "Enter")} abrir   ${theme.fg("accent", "esc/q")} cerrar`,
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
			overlayOptions: { anchor: "center", width: "42%", maxHeight: "70%" },
		},
	);
	return result ?? null;
}

export default function (pi: ExtensionAPI) {
	async function showDirectionMenu(
		ctx: ExtensionContext,
		mode: "nvim" | "fzf" | "yazi" | "dc-studio",
	): Promise<void> {
		if (!ctx.hasUI) {
			ctx.ui.notify("previu necesita TUI (no hay UI en este modo).", "error");
			return;
		}
		const cwd = ctx.cwd || process.cwd();
		const label =
			mode === "nvim"
				? "📝 nvim"
				: mode === "yazi"
					? "🦆 yazi"
					: mode === "dc-studio"
						? "🧰 dc-studio"
						: "🔍 fzf+bat";
		const picked = await floatingSelect(
			ctx,
			`previu — ${label} · ¿dónde abrir?`,
			[
				{ value: "h", label: `→  A la derecha (${YAZI_PCT}%)` },
				{ value: "v", label: `↓  Abajo        (${YAZI_PCT}%)` },
			],
		);
		if (!picked) return; // esc sale; sin opcion Cancelar
		const orientation = picked as Orientation;
		if (mode === "dc-studio") await openDcStudio(orientation, cwd, ctx);
		else await openPanel(mode, orientation, cwd, ctx);
	}

	async function showToolMenu(ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI) {
			ctx.ui.notify("previu necesita TUI (no hay UI en este modo).", "error");
			return;
		}
		const cwd = ctx.cwd || process.cwd();
		const choice = await floatingSelect(ctx, "previu — Alt+v", [
			{ value: "manager", label: TOOL_LABELS.manager },
			{ value: "nvim", label: TOOL_LABELS.nvim },
			{ value: "fzf", label: TOOL_LABELS.fzf },
			{ value: "yazi", label: TOOL_LABELS.yazi },
			{ value: "dc-studio", label: TOOL_LABELS["dc-studio"] },
		]);
		if (!choice) return; // esc sale; sin opcion Cancelar
		if (choice === "manager") {
			await showManagerSetup(cwd, ctx);
		} else if (
			choice === "nvim" ||
			choice === "fzf" ||
			choice === "yazi" ||
			choice === "dc-studio"
		) {
			await showDirectionMenu(
				ctx,
				choice as "nvim" | "fzf" | "yazi" | "dc-studio",
			);
		}
	}

	pi.registerCommand("previu", {
		description:
			"Abre task-manager, nvim, fzf+bat, yazi o dc-studio en un pane tmux/herdr al 40% (derecha/abajo). Uso: /previu [nvim|fzf|yazi|manager|dc] [h|v]",
		handler: async (args, ctx) => {
			const parts = (args || "").trim().split(/\s+/).filter(Boolean);
			const tool = parseToolArg(parts[0]);
			const orientation = parseOrientationArg(parts[1]);
			const cwd = ctx.cwd || process.cwd();

			if (!tool) {
				await showToolMenu(ctx);
				return;
			}
			if (tool === "manager") {
				await showManagerSetup(cwd, ctx);
				return;
			}
			if (!orientation) {
				await showDirectionMenu(ctx, tool);
				return;
			}
			if (tool === "dc-studio") await openDcStudio(orientation, cwd, ctx);
			else await openPanel(tool, orientation, cwd, ctx);
		},
	});

	// Alt+v — igual que en opencode. En Linux no choca con nada de pi
	// (en Windows/WSL Alt+v es pegar imagen, ahí usá /previu).
	pi.registerShortcut("alt+shift+v", {
		description: "previu (manager visual en pane tmux/herdr)",
		handler: async (ctx) => {
			await showToolMenu(ctx);
		},
	});

}
