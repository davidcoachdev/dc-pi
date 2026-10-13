import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { renderDcCard } from "../../../ui/dc-card.ts";
import { renderProgressBar } from "../../../ui/dc-progress-bar.ts";
import { readFacePrefs, writeFacePrefs } from "../../dc-face/core/dc-face-prefs.ts";
import { openProfilePicker } from "../../dc-face/views/dc-profile-duel.ts";
import { TTS_RATES, type TtsStatus, type VoiceInfo } from "../core/dc-tts-types.ts";

export interface DcTtsPanelCallbacks {
  fetchStatus: () => Promise<TtsStatus | null>;
  fetchVoices: () => Promise<VoiceInfo[]>;
  sendAction: (path: string, body?: unknown) => Promise<any>;
  ensureDaemon: () => Promise<boolean>;
  isSoundOn: () => boolean;
  toggleSound: () => boolean;
  dictateNow: () => Promise<void>;
  getParagraphInfo: () => { current: number; total: number };
}

type ActiveTab = "control" | "voices" | "shortcuts";

interface ControlItem {
  id: string;
  icon: string;
  label: string;
  rightText?: string;
  hint?: string;
  isSeparator?: boolean;
}

function padRightVisible(text: string, width: number): string {
  const v = visibleWidth(text);
  if (v >= width) return truncateToWidth(text, width, "");
  return text + " ".repeat(width - v);
}

export class DcTtsPanel implements Component {
  private activeTab: ActiveTab = "control";
  private selectedIndex = 0;
  private status: TtsStatus;
  private voices: VoiceInfo[] = [];
  private connected = false;
  private customInputActive = false;
  private customInputText = "";
  private tabBounds: Array<{ id: ActiveTab; start: number; end: number }> = [];
  private firstRowY = 11;

  constructor(
    private readonly theme: Pick<Theme, "fg" | "bg" | "bold">,
    private readonly ctx: ExtensionContext,
    private readonly callbacks: DcTtsPanelCallbacks,
    private readonly onClose: () => void,
    private readonly requestRender: () => void,
    initialStatus: TtsStatus | null,
    initialVoices: VoiceInfo[],
  ) {
    this.connected = initialStatus !== null;
    this.status = initialStatus ?? {
      status: "offline",
      queue: 0,
      autoRead: false,
      voice: "sistema (default)",
      rate: 1.0,
      volume: 100,
      wakeWord: "dc",
      language: "es-MX",
    };
    this.voices = [...initialVoices].sort(
      (a, b) => a.culture.localeCompare(b.culture) || a.name.localeCompare(b.name),
    );
  }

  invalidate(): void {}

  async refresh(): Promise<void> {
    let st = await this.callbacks.fetchStatus();
    if (!st) {
      const started = await this.callbacks.ensureDaemon();
      if (started) {
        st = await this.callbacks.fetchStatus();
      }
    }
    const vs = await this.callbacks.fetchVoices();
    this.connected = st !== null;
    if (st) this.status = st;
    if (vs.length > 0) {
      this.voices = [...vs].sort(
        (a, b) => a.culture.localeCompare(b.culture) || a.name.localeCompare(b.name),
      );
    }
    this.requestRender();
  }

  private getControlItems(): ControlItem[] {
    const t = this.theme;
    const ar = this.status.autoRead;
    const snd = this.callbacks.isSoundOn();
    const facePrefs = readFacePrefs();
    const curProf = facePrefs.profile ?? "dcdev";
    const ratePct = Math.round(((this.status.rate - 0.25) / 1.75) * 100);
    const rateBar = renderProgressBar(ratePct, 10, "█", "░");
    const volBar = renderProgressBar(this.status.volume, 10, "█", "░");
    const voiceShort = this.status.voice
      ? this.status.voice.replace("Microsoft ", "").replace(" Desktop", "")
      : "sistema (default)";

    return [
      { id: "resume", icon: "▶", label: "Play / Resume", rightText: "[Enter / p]" },
      { id: "pause", icon: "⏸", label: "Pause", rightText: "[p]" },
      { id: "stop", icon: "⏹", label: "Stop", rightText: "[Alt+X / s]" },
      { id: "replay", icon: "🔁", label: "Replay última respuesta", rightText: "[Alt+R]" },
      { id: "prev", icon: "⏮", label: "Párrafo anterior", rightText: "[Alt+,]" },
      { id: "next", icon: "⏭", label: "Párrafo siguiente", rightText: "[Alt+.]" },
      { id: "sep1", icon: "", label: "sep", isSeparator: true },
      {
        id: "autoread",
        icon: ar ? "🔊" : "🔈",
        label: `Auto-read: ${ar ? t.fg("accent", "ON") : t.fg("dim", "OFF")}`,
        rightText: ar ? "click/Enter desactivar [t]" : "click/Enter activar [t]",
      },
      {
        id: "sound",
        icon: snd ? "🔔" : "🔕",
        label: `Sound (Beeps): ${snd ? t.fg("accent", "ON") : t.fg("dim", "OFF")}`,
        rightText: snd ? "click/Enter silenciar" : "click/Enter activar",
      },
      { id: "sep2", icon: "", label: "sep", isSeparator: true },
      {
        id: "avatar",
        icon: "🎭",
        label: `Avatar — ${t.bold(curProf)}`,
        rightText: "←/→ rotar · Enter duelo ▶",
      },
      {
        id: "voice",
        icon: "🌐",
        label: `Voz: ${t.bold(voiceShort)}`,
        rightText: "←/→ cambiar · Enter lista ▶",
      },
      {
        id: "rate",
        icon: "⚡",
        label: `Velocidad: ${t.bold(`${this.status.rate}×`)}  [${rateBar}]`,
        rightText: "←/→ ajustar (0.5×..2.0×)",
      },
      {
        id: "volume",
        icon: "🔉",
        label: `Volumen: ${t.bold(`${this.status.volume}%`)}   [${volBar}]`,
        rightText: "←/→ ajustar (0%..100%)",
      },
      { id: "sep3", icon: "", label: "sep", isSeparator: true },
      {
        id: "dictate",
        icon: "🎙",
        label: "Dictar comando por voz ahora (dc-transcription)",
        rightText: "[Alt+V]",
      },
      {
        id: "custom",
        icon: "💬",
        label: this.customInputActive
          ? `Texto: ${t.fg("accent", this.customInputText + "█")}`
          : "Speak custom text…",
        rightText: this.customInputActive ? "[Enter hablar · Esc cancelar]" : "[Enter escribir]",
      },
      {
        id: "help",
        icon: "🔑",
        label: "Ver atajos (comandos)",
        rightText: "▶",
      },
      {
        id: "refresh",
        icon: "🔄",
        label: this.connected ? "Refresh status" : "Iniciar / Reconectar Daemon Go",
        rightText: "[r]",
      },
    ];
  }

  private getSelectableControlIndices(items: ControlItem[]): number[] {
    const out: number[] = [];
    for (let i = 0; i < items.length; i++) {
      if (!items[i]?.isSeparator) out.push(i);
    }
    return out;
  }

  private getShortcutItems(): Array<{ key: string; desc: string; cmd: string }> {
    return [
      { key: "Alt+U", desc: "Abrir esta ventana de configuración TTS", cmd: "config" },
      { key: "Alt+P  /  [p]", desc: "Pausar / Reanudar voz en curso", cmd: "toggle" },
      { key: "Alt+X  /  [s]", desc: "Detener inmediatamente la lectura TTS", cmd: "stop" },
      { key: "Alt+,  /  Alt+←", desc: "Saltar al párrafo anterior", cmd: "prev" },
      { key: "Alt+.  /  Alt+→", desc: "Saltar al párrafo siguiente", cmd: "next" },
      { key: "Alt+R", desc: "Repetir la última respuesta completa", cmd: "replay" },
      { key: "Alt+V", desc: "Dictar instrucción por voz para Pi (dc-transcription)", cmd: "dictate" },
      { key: "Alt+C", desc: "Abrir selector de perfil de Avatar (dcdev / cubis)", cmd: "avatar" },
      { key: "[t]", desc: "Alternar Auto-lectura ON / OFF", cmd: "autoread" },
    ];
  }

  render(width: number): string[] {
    const t = this.theme;
    const safeW = Math.max(44, width);

    const statusDot = !this.connected
      ? t.fg("error", "● offline")
      : this.status.status === "playing"
        ? t.fg("accent", "▶ playing")
        : this.status.status === "paused"
          ? t.fg("warning" as any, "⏸ paused")
          : t.fg("accent", "● idle");

    const arBadge = this.status.autoRead
      ? t.fg("accent", "🔊 auto-read: ON")
      : t.fg("dim", "🔈 auto-read: OFF");
    const sndBadge = this.callbacks.isSoundOn()
      ? t.fg("accent", "🔔 sound: ON")
      : t.fg("dim", "🔕 sound: OFF");
    const prof = readFacePrefs().profile ?? "dcdev";
    const pInfo = this.callbacks.getParagraphInfo();
    const paraLabel = pInfo.total > 0 ? `${pInfo.current + 1}/${pInfo.total}` : "0/0";

    const cardLines = renderDcCard(
      {
        title: `🔊 TTS Monitor & Asistente`,
        titleRight: `${statusDot} · queue ${this.status.queue} · ${arBadge}`,
        borderColor: (s) => t.fg("border", s),
        titleColor: (s) => t.bold(t.fg("accent", s)),
        lines: [
          ` 🌐 Voz: ${t.bold(this.status.voice || "default")}   ⚡ ${this.status.rate}×   🔉 ${this.status.volume}%   📄 Párrafo: ${paraLabel}`,
          ` 🎭 Avatar: ${t.bold(prof)}   ${sndBadge}   🎙 Wake-word: "${this.status.wakeWord ?? "dc"}" (${this.status.language ?? "es-MX"})`,
        ],
      },
      safeW,
    );

    const tabs: Array<{ id: ActiveTab; label: string }> = [
      { id: "control", label: "🎛  Control TTS" },
      { id: "voices", label: `🌐 Voces SAPI (${this.voices.length})` },
      { id: "shortcuts", label: "🔑 Atajos & Comandos" },
    ];

    this.tabBounds = [];
    let col = 1;
    const tabParts: string[] = [];
    for (let i = 0; i < tabs.length; i++) {
      const tb = tabs[i]!;
      const isSel = tb.id === this.activeTab;
      const cell = ` ${tb.label} `;
      const len = visibleWidth(cell);
      this.tabBounds.push({ id: tb.id, start: col, end: col + len });
      col += len;
      tabParts.push(
        isSel ? t.bg("selectedBg", t.bold(t.fg("accent", cell))) : t.fg("dim", cell),
      );
      if (i < tabs.length - 1) {
        tabParts.push(t.fg("dim", "│"));
        col += 1;
      }
    }

    const tabsRow = " " + tabParts.join("");
    const tabsDivider = " " + t.fg("border", "─".repeat(Math.max(0, safeW - 2)));

    const out: string[] = [
      ...cardLines,
      "",
      padRightVisible(tabsRow, safeW),
      padRightVisible(tabsDivider, safeW),
    ];

    this.firstRowY = out.length;

    if (this.activeTab === "control") {
      const items = this.getControlItems();
      const selectable = this.getSelectableControlIndices(items);
      if (!selectable.includes(this.selectedIndex)) {
        this.selectedIndex = selectable[0] ?? 0;
      }

      for (let i = 0; i < items.length; i++) {
        const it = items[i]!;
        if (it.isSeparator) {
          out.push(padRightVisible(`   ${t.fg("dim", "─────────────────────────────")}`, safeW));
          continue;
        }
        const isSel = i === this.selectedIndex;
        const bullet = isSel ? t.fg("accent", "●") : t.fg("dim", "○");
        const left = ` ${bullet}  ${it.icon}  ${isSel ? t.bold(it.label) : it.label}`;
        const right = it.rightText ? t.fg("dim", `${it.rightText} `) : "";
        const leftW = visibleWidth(left);
        const rightW = visibleWidth(right);
        const gap = Math.max(1, safeW - leftW - rightW);
        const row = truncateToWidth(left + " ".repeat(gap) + right, safeW, "");
        const padded = padRightVisible(row, safeW);
        out.push(isSel ? t.bg("selectedBg", padded) : padded);
      }
    } else if (this.activeTab === "voices") {
      out.push("");
      if (this.voices.length === 0) {
        out.push(padRightVisible(`  ${t.fg("dim", "No se detectaron voces SAPI en el servicio.")}`, safeW));
      } else {
        this.selectedIndex = Math.max(0, Math.min(this.voices.length - 1, this.selectedIndex));
        for (let i = 0; i < this.voices.length; i++) {
          const v = this.voices[i]!;
          const isSel = i === this.selectedIndex;
          const isCurrent = v.name === this.status.voice;
          const bullet = isCurrent ? t.fg("accent", "●") : isSel ? t.fg("accent", "◉") : t.fg("dim", "○");
          const badge = isCurrent ? t.fg("accent", " [ACTIVA]") : "";
          const rowText = ` ${bullet}  🌐  ${t.bold(v.culture)} — ${v.name} ${t.fg("dim", `(${v.gender})`)}${badge}`;
          const padded = padRightVisible(rowText, safeW);
          out.push(isSel ? t.bg("selectedBg", padded) : padded);
        }
      }
    } else {
      out.push("");
      const sc = this.getShortcutItems();
      this.selectedIndex = Math.max(0, Math.min(sc.length - 1, this.selectedIndex));
      for (let i = 0; i < sc.length; i++) {
        const row = sc[i]!;
        const isSel = i === this.selectedIndex;
        const bullet = isSel ? t.fg("accent", "●") : t.fg("dim", "○");
        const keyCol = padRightVisible(row.key, 18);
        const line = ` ${bullet}  ${t.bold(t.fg("accent", keyCol))} ${t.fg("dim", "→")}  ${row.desc}`;
        const padded = padRightVisible(line, safeW);
        out.push(isSel ? t.bg("selectedBg", padded) : padded);
      }
    }

    return out;
  }

  private moveSelection(delta: number): void {
    if (this.activeTab === "control") {
      const items = this.getControlItems();
      const selectable = this.getSelectableControlIndices(items);
      if (selectable.length === 0) return;
      const curPos = Math.max(0, selectable.indexOf(this.selectedIndex));
      const nextPos = Math.max(0, Math.min(selectable.length - 1, curPos + delta));
      this.selectedIndex = selectable[nextPos]!;
      this.requestRender();
    } else if (this.activeTab === "voices") {
      if (this.voices.length === 0) return;
      this.selectedIndex = Math.max(0, Math.min(this.voices.length - 1, this.selectedIndex + delta));
      this.requestRender();
    } else {
      const sc = this.getShortcutItems();
      this.selectedIndex = Math.max(0, Math.min(sc.length - 1, this.selectedIndex + delta));
      this.requestRender();
    }
  }

  private switchTab(next: ActiveTab): void {
    this.activeTab = next;
    this.selectedIndex = 0;
    this.requestRender();
  }

  private async adjustHorizontal(dir: -1 | 1): Promise<void> {
    if (this.activeTab !== "control") return;
    const item = this.getControlItems()[this.selectedIndex];
    if (!item) return;

    if (item.id === "rate") {
      const curIdx = TTS_RATES.findIndex((r) => Math.abs(r - this.status.rate) < 0.05);
      const baseIdx = curIdx >= 0 ? curIdx : 2;
      const nextRate = TTS_RATES[Math.max(0, Math.min(TTS_RATES.length - 1, baseIdx + dir))]!;
      const st = await this.callbacks.sendAction("/rate", { rate: nextRate });
      if (st) this.status = st;
      this.requestRender();
    } else if (item.id === "volume") {
      const nextVol = Math.max(0, Math.min(100, this.status.volume + dir * 10));
      const st = await this.callbacks.sendAction("/volume", { volume: nextVol });
      if (st) this.status = st;
      this.requestRender();
    } else if (item.id === "voice" && this.voices.length > 0) {
      const curIdx = this.voices.findIndex((v) => v.name === this.status.voice);
      const nextIdx = (curIdx + dir + this.voices.length) % this.voices.length;
      const nextVoice = this.voices[nextIdx]!;
      const st = await this.callbacks.sendAction("/voice", { voice: nextVoice.name });
      if (st) this.status = st;
      this.requestRender();
    } else if (item.id === "avatar") {
      const profiles = ["dcdev", "cubis", "neko"];
      const cur = readFacePrefs().profile ?? "dcdev";
      const idx = Math.max(0, profiles.indexOf(cur));
      const next = profiles[(idx + dir + profiles.length) % profiles.length]!;
      writeFacePrefs({ profile: next });
      this.requestRender();
    }
  }

  private async triggerSelected(): Promise<void> {
    if (this.activeTab === "voices") {
      const chosen = this.voices[this.selectedIndex];
      if (!chosen) return;
      const st = await this.callbacks.sendAction("/voice", { voice: chosen.name });
      if (st) this.status = st;
      await this.callbacks.sendAction("/speak", {
        text: `Voz activada: ${chosen.name.replace("Microsoft ", "").replace(" Desktop", "")}`,
      });
      await this.refresh();
      return;
    }

    if (this.activeTab === "shortcuts") {
      const sc = this.getShortcutItems()[this.selectedIndex];
      if (!sc) return;
      if (sc.cmd === "toggle") await this.callbacks.sendAction("/toggle", {});
      else if (sc.cmd === "stop") await this.callbacks.sendAction("/stop", {});
      else if (sc.cmd === "prev") await this.callbacks.sendAction("/nav", { direction: "prev" });
      else if (sc.cmd === "next") await this.callbacks.sendAction("/nav", { direction: "next" });
      else if (sc.cmd === "replay") await this.callbacks.sendAction("/nav", { direction: "replay" });
      else if (sc.cmd === "autoread") await this.callbacks.sendAction("/autoread", {});
      else if (sc.cmd === "dictate") {
        this.onClose();
        await this.callbacks.dictateNow();
        return;
      } else if (sc.cmd === "avatar") {
        this.onClose();
        const t = setTimeout(() => void openProfilePicker(this.ctx), 50);
        (t as any).unref?.();
        return;
      }
      await this.refresh();
      return;
    }

    const item = this.getControlItems()[this.selectedIndex];
    if (!item || item.isSeparator) return;

    switch (item.id) {
      case "resume":
        await this.callbacks.sendAction("/resume", {});
        await this.refresh();
        break;
      case "pause":
        await this.callbacks.sendAction("/pause", {});
        await this.refresh();
        break;
      case "stop":
        await this.callbacks.sendAction("/stop", {});
        await this.refresh();
        break;
      case "replay":
        await this.callbacks.sendAction("/nav", { direction: "replay" });
        await this.refresh();
        break;
      case "prev":
        await this.callbacks.sendAction("/nav", { direction: "prev" });
        await this.refresh();
        break;
      case "next":
        await this.callbacks.sendAction("/nav", { direction: "next" });
        await this.refresh();
        break;
      case "autoread":
        await this.callbacks.sendAction("/autoread", {});
        await this.refresh();
        break;
      case "sound":
        this.callbacks.toggleSound();
        this.requestRender();
        break;
      case "avatar": {
        this.onClose();
        const t = setTimeout(() => void openProfilePicker(this.ctx), 50);
        (t as any).unref?.();
        break;
      }
      case "voice":
        this.switchTab("voices");
        break;
      case "rate":
        await this.adjustHorizontal(1);
        break;
      case "volume":
        await this.adjustHorizontal(1);
        break;
      case "dictate":
        this.onClose();
        await this.callbacks.dictateNow();
        break;
      case "custom":
        this.customInputActive = true;
        this.customInputText = "";
        this.requestRender();
        break;
      case "help":
        this.switchTab("shortcuts");
        break;
      case "refresh":
        await this.refresh();
        break;
    }
  }

  handleInput(data: string): boolean {
    if (this.customInputActive) {
      if (matchesKey(data, Key.escape)) {
        this.customInputActive = false;
        this.customInputText = "";
        this.requestRender();
        return true;
      }
      if (matchesKey(data, Key.enter)) {
        const text = this.customInputText.trim();
        this.customInputActive = false;
        this.customInputText = "";
        if (text) {
          void this.callbacks.sendAction("/read", { text, force: true }).then(() => this.refresh());
        } else {
          this.requestRender();
        }
        return true;
      }
      if (matchesKey(data, Key.backspace)) {
        this.customInputText = this.customInputText.slice(0, -1);
        this.requestRender();
        return true;
      }
      if (data.length >= 1 && data.charCodeAt(0) >= 32) {
        this.customInputText += data;
        this.requestRender();
      }
      return true;
    }

    if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
      this.onClose();
      return true;
    }
    if (matchesKey(data, Key.tab)) {
      const order: ActiveTab[] = ["control", "voices", "shortcuts"];
      const next = order[(order.indexOf(this.activeTab) + 1) % order.length]!;
      this.switchTab(next);
      return true;
    }
    if (matchesKey(data, Key.up) || data === "k") {
      this.moveSelection(-1);
      return true;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.moveSelection(1);
      return true;
    }
    if (matchesKey(data, Key.left) || data === "h") {
      void this.adjustHorizontal(-1);
      return true;
    }
    if (matchesKey(data, Key.right) || data === "l") {
      void this.adjustHorizontal(1);
      return true;
    }
    if (matchesKey(data, Key.enter) || data === " ") {
      void this.triggerSelected();
      return true;
    }

    if (data === "p" || data === "P") {
      void this.callbacks.sendAction("/toggle", {}).then(() => this.refresh());
      return true;
    }
    if (data === "s" || data === "S") {
      void this.callbacks.sendAction("/stop", {}).then(() => this.refresh());
      return true;
    }
    if (data === "t" || data === "T") {
      void this.callbacks.sendAction("/autoread", {}).then(() => this.refresh());
      return true;
    }
    if (data === "r" || data === "R") {
      void this.refresh();
      return true;
    }

    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click" || (event.button ?? "left") !== "left") {
      return undefined;
    }

    if (event.y === this.firstRowY - 2) {
      for (const b of this.tabBounds) {
        if (event.x >= b.start && event.x <= b.end) {
          this.switchTab(b.id);
          return { handled: true };
        }
      }
    }

    if (event.y >= this.firstRowY) {
      if (this.activeTab === "control") {
        const idx = event.y - this.firstRowY;
        const items = this.getControlItems();
        if (idx >= 0 && idx < items.length && !items[idx]?.isSeparator) {
          this.selectedIndex = idx;
          void this.triggerSelected();
          return { handled: true };
        }
      } else {
        const idx = event.y - (this.firstRowY + 1);
        if (this.activeTab === "voices" && idx >= 0 && idx < this.voices.length) {
          this.selectedIndex = idx;
          void this.triggerSelected();
          return { handled: true };
        }
        const sc = this.getShortcutItems();
        if (this.activeTab === "shortcuts" && idx >= 0 && idx < sc.length) {
          this.selectedIndex = idx;
          void this.triggerSelected();
          return { handled: true };
        }
      }
    }

    return undefined;
  }
}
