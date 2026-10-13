import { DEFAULT_TTS_HTTP_URL, type TtsStatus, type VoiceInfo } from "./dc-tts-types.ts";

export async function callTtsBridge<T = any>(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
  timeoutMs = 4000,
  baseUrl = DEFAULT_TTS_HTTP_URL,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  (timer as any).unref?.();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkTtsHealth(baseUrl = DEFAULT_TTS_HTTP_URL, timeoutMs = 600): Promise<boolean> {
  const res = await callTtsBridge<{ ok?: boolean }>("/health", "GET", undefined, timeoutMs, baseUrl);
  return Boolean(res?.ok);
}

export async function fetchTtsStatus(baseUrl = DEFAULT_TTS_HTTP_URL, timeoutMs = 1000): Promise<TtsStatus | null> {
  return callTtsBridge<TtsStatus>("/status", "GET", undefined, timeoutMs, baseUrl);
}

export async function fetchTtsVoices(baseUrl = DEFAULT_TTS_HTTP_URL, timeoutMs = 3000): Promise<VoiceInfo[]> {
  const res = await callTtsBridge<{ voices?: VoiceInfo[] }>("/voices", "GET", undefined, timeoutMs, baseUrl);
  return res?.voices ?? [];
}
