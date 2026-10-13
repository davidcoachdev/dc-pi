export const DEFAULT_TTS_HTTP_URL = process.env.DC_TTS_HTTP_URL || "http://127.0.0.1:9877";
export const DEFAULT_TTS_TCP_ADDR = process.env.DC_TTS_TCP_ADDR || "127.0.0.1:9876";

export interface TtsStatus {
  status: string;
  queue: number;
  autoRead: boolean;
  voice: string;
  rate: number;
  volume: number;
  listenMode?: string;
  wakeWord?: string;
  language?: string;
  error?: string;
}

export interface VoiceInfo {
  name: string;
  culture: string;
  gender: string;
}

export interface TranscriptionEvent {
  event: string;
  mode?: string;
  text?: string;
  command?: string;
  wakeMatched?: boolean;
  choiceIndex: number;
  confidence?: number;
  language?: string;
  error?: string;
}

export interface DcTtsPrefs {
  autoStart?: boolean;
  autoRead?: boolean;
  soundOn?: boolean;
  voice?: string;
  rate?: number;
  volume?: number;
  language?: string;
  wakeWord?: string;
}

export const TTS_RATES = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0] as const;

/**
 * Formatea el badge de estado estilo OpenCode para la barra de estado de Pi:
 * `▶ tts (2) 🔊 🔔 ⚡1.25× 🔉90%` | `⏸ tts 🔈 🔕` | `● tts down`
 */
export function formatOpenCodeTtsBadge(st: TtsStatus | null, soundOn = true): string {
  if (!st) return "● tts down";
  const icon = st.status === "playing" ? "▶" : "⏸";
  const q = st.queue > 0 ? ` (${st.queue})` : "";
  const ar = st.autoRead ? " 🔊" : " 🔈";
  const snd = soundOn ? " 🔔" : " 🔕";
  const spd = st.rate !== 1 ? ` ⚡${st.rate}×` : "";
  const vol = st.volume !== 100 ? ` 🔉${st.volume}%` : "";
  return `${icon} tts${q}${ar}${snd}${spd}${vol}`;
}

/**
 * Extrae el texto visible de un mensaje de Pi ignorando bloques internos de pensamiento y toolCalls.
 */
export function extractAssistantMessageText(message: any): string {
  if (!message) return "";
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim();
  }
  if (typeof message.content === "string" && message.content.trim()) {
    return message.content.trim();
  }
  if (Array.isArray(message.content)) {
    const parts: string[] = [];
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;
      if (
        block.type === "thinking" ||
        block.type === "thought" ||
        block.type === "toolCall" ||
        block.type === "tool_use"
      ) {
        continue;
      }
      if (block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
    return parts.join("\n\n").trim();
  }
  return "";
}

export interface QuestionOptionInput {
  label?: string;
  description?: string;
}

export interface QuestionItemInput {
  question?: string;
  header?: string;
  multiSelect?: boolean;
  options?: QuestionOptionInput[];
}

interface InternalQuestionState {
  prompt: string;
  optionCount: number;
  multiSelect: boolean;
  answered: boolean;
  cursorRow: number;
  editingCustom: boolean;
  customTextLen: number;
}

/**
 * Gestiona la lectura secuencial (una por una) de las preguntas de `ask_user_question` y `ask_user_choice`.
 * Lee únicamente la pregunta activa, espera a que el usuario conteste con Enter (o cambie de pestaña con Tab),
 * y al avanzar lee la siguiente pregunta.
 */
export class QuestionQueueStepper {
  private items: InternalQuestionState[] = [];
  private currentIndex = 0;
  private active = false;

  constructor(rawQuestions: QuestionItemInput[]) {
    const valid = (rawQuestions || []).filter(
      (q) => q && typeof q.question === "string" && q.question.trim().length > 0,
    );
    const total = valid.length;
    this.items = valid.map((q, idx) => {
      const opts = Array.isArray(q.options)
        ? q.options
            .map((o, i) => `Opción ${i + 1}: ${o?.label ?? ""}`)
            .join(". ")
        : "";
      const prefix = total > 1 ? `Pregunta ${idx + 1} de ${total}: ` : "";
      const prompt = `${prefix}${q.question!.trim()}${opts ? `. ${opts}` : ""}`;
      return {
        prompt,
        optionCount: Array.isArray(q.options) ? q.options.length : 0,
        multiSelect: Boolean(q.multiSelect),
        answered: false,
        cursorRow: 0,
        editingCustom: false,
        customTextLen: 0,
      };
    });
    this.active = this.items.length > 0;
  }

  isActive(): boolean {
    return this.active && this.items.length > 0;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  currentPrompt(): string | null {
    if (!this.isActive()) return null;
    return this.items[this.currentIndex]?.prompt ?? null;
  }

  clear(): void {
    this.active = false;
  }

  handleKey(data: string): string | "__DONE__" | null {
    if (!this.isActive() || !data) return null;
    const cur = this.items[this.currentIndex];
    if (!cur) return null;

    if (cur.editingCustom) {
      if (data === "\x1b") {
        cur.editingCustom = false;
        cur.customTextLen = 0;
        return null;
      }
      if (data === "\x7f" || data === "\b") {
        cur.customTextLen = Math.max(0, cur.customTextLen - 1);
        return null;
      }
      if (data === "\r" || data === "\n") {
        if (cur.customTextLen > 0) {
          return this.commitCurrentAndAdvance();
        }
        return null;
      }
      if (data.length >= 1 && data.charCodeAt(0) >= 32) {
        cur.customTextLen += data.length;
      }
      return null;
    }

    // Cancelación con Esc o Ctrl+C
    if (data === "\x1b" || data === "\x03") {
      this.active = false;
      return "__DONE__";
    }

    // Cambio de pestaña de pregunta con Tab / Shift+Tab
    if (data === "\t") {
      if (this.items.length <= 1) return null;
      this.currentIndex = (this.currentIndex + 1) % this.items.length;
      return this.currentPrompt();
    }
    if (data === "\x1b[Z") {
      if (this.items.length <= 1) return null;
      this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
      return this.currentPrompt();
    }

    // Navegación vertical entre opciones (0 .. optionCount, donde optionCount es "Type something.")
    if (data === "\x1b[B" || data === "\x1bOB" || data === "j") {
      cur.cursorRow = Math.min(cur.optionCount, cur.cursorRow + 1);
      return null;
    }
    if (data === "\x1b[A" || data === "\x1bOA" || data === "k") {
      cur.cursorRow = Math.max(0, cur.cursorRow - 1);
      return null;
    }

    // Espacio en multiSelect marca/desmarca sin avanzar de pregunta
    if (data === " " && cur.multiSelect) {
      return null;
    }

    // Si está posicionado en la fila "Type something." y empieza a escribir texto
    if (
      cur.cursorRow === cur.optionCount &&
      data.length === 1 &&
      data.charCodeAt(0) >= 32 &&
      data !== " "
    ) {
      cur.editingCustom = true;
      cur.customTextLen = 1;
      return null;
    }

    // Confirmación con Enter
    if (data === "\r" || data === "\n") {
      if (cur.cursorRow === cur.optionCount && cur.customTextLen === 0) {
        cur.editingCustom = true;
        return null;
      }
      return this.commitCurrentAndAdvance();
    }

    return null;
  }

  private commitCurrentAndAdvance(): string | "__DONE__" {
    const cur = this.items[this.currentIndex];
    if (cur) {
      cur.answered = true;
    }
    for (let offset = 1; offset < this.items.length; offset++) {
      const candidate = (this.currentIndex + offset) % this.items.length;
      if (!this.items[candidate]?.answered) {
        this.currentIndex = candidate;
        return this.currentPrompt() ?? "__DONE__";
      }
    }
    this.active = false;
    return "__DONE__";
  }
}

