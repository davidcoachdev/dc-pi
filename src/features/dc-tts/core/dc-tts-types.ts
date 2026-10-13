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
