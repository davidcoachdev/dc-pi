import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { agentVisualStateStore } from "../../core/dc-agent-state/index.ts";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { openDcModal } from "../../ui/dc-modal.ts";
import { ttsBridgeClient } from "../dc-face/core/dc-face-bridge.ts";
import { callTtsBridge, fetchTtsStatus, fetchTtsVoices } from "./core/dc-tts-client.ts";
import { ensureTtsDaemonRunning } from "./core/dc-tts-daemon.ts";
import { readTtsPrefs, writeTtsPrefs } from "./core/dc-tts-prefs.ts";
import {
  extractAssistantMessageText,
  formatOpenCodeTtsBadge,
  QuestionQueueStepper,
  type TranscriptionEvent,
  type TtsStatus,
} from "./core/dc-tts-types.ts";
import { DcTtsPanel } from "./views/dc-tts-panel.ts";

const DC_TTS_REGISTERED = Symbol.for("dc.tts.registered");

export default function dcTtsExtension(pi: ExtensionAPI): void {
  if ((pi as any)[DC_TTS_REGISTERED]) return;
  (pi as any)[DC_TTS_REGISTERED] = true;

  let lastSpokenText = "";
  let latestAssistantText = "";
  let activeCtx: ExtensionContext | undefined;
  let watchTimer: ReturnType<typeof setInterval> | null = null;
  let unsubInput: (() => void) | null = null;
  let paragraphCursor = 0;
  let paragraphTotal = 0;
  let questionStepper: QuestionQueueStepper | null = null;

  const isSoundOn = (): boolean => readTtsPrefs().soundOn;

  const markSpeakingStarted = (ctx?: ExtensionContext) => {
    if (ctx) activeCtx = ctx;
    ttsBridgeClient.setStatus("playing", readTtsPrefs().rate);
    agentVisualStateStore.setState("talking");
    startSpeechWatch(ctx);
  };

  const speakSingleQuestion = async (prompt: string, ctx?: ExtensionContext) => {
    await callTtsBridge("/stop", "POST", {});
    markSpeakingStarted(ctx);
    await callTtsBridge("/read", "POST", { text: prompt, force: true });
    startSpeechWatch(ctx);
  };

  const syncVisualStatus = async (): Promise<TtsStatus | null> => {
    const st = await fetchTtsStatus();

    try {
      activeCtx?.ui?.setStatus?.("dc-tts", formatOpenCodeTtsBadge(st, isSoundOn()));
    } catch {
      /* noop */
    }

    if (st?.status === "playing") {
      ttsBridgeClient.setStatus("playing", st.rate);
      agentVisualStateStore.setState("talking");
    } else {
      ttsBridgeClient.setStatus("idle", st?.rate);
      if (agentVisualStateStore.getState() === "talking") {
        const nextState = questionStepper?.isActive()
          ? "prompting"
          : agentVisualStateStore.isBusy()
            ? "thinking"
            : "idle";
        agentVisualStateStore.setState(nextState);
      }
    }
    return st;
  };

  const stopSpeechWatch = () => {
    if (watchTimer) {
      clearInterval(watchTimer);
      watchTimer = null;
    }
  };

  const startSpeechWatch = (ctx?: ExtensionContext) => {
    if (ctx) activeCtx = ctx;
    void syncVisualStatus();
    if (watchTimer) return;
    watchTimer = setInterval(async () => {
      const st = await syncVisualStatus();
      if (!st || st.status === "idle") {
        stopSpeechWatch();
      }
    }, 250);
    (watchTimer as any).unref?.();
  };

  const dictateAndSend = async (ctx: ExtensionContext) => {
    await ensureTtsDaemonRunning();
    const prefs = readTtsPrefs();
    dcNotifier.notify(ctx, "DC Transcription", "🎙 Escuchando micrófono (habla ahora)...", "info");
    if (prefs.soundOn) {
      await callTtsBridge("/beep", "POST", { kind: "info" });
    }
    const ev = await callTtsBridge<TranscriptionEvent>(
      "/listen",
      "POST",
      {
        action: "once",
        mode: "toggle",
        language: prefs.language || "es-MX",
        wakeWord: prefs.wakeWord || "dc",
        timeoutS: 8,
      },
      15000,
    );
    if (!ev || ev.error) {
      dcNotifier.notify(ctx, "DC Transcription", ev?.error ?? "Sin respuesta del daemon", "warning");
      return;
    }
    const spoken = (ev.command || ev.text || "").trim();
    if (!spoken) {
      dcNotifier.notify(ctx, "DC Transcription", "No se detectó voz (silencio).", "info");
      return;
    }
    dcNotifier.notify(ctx, "DC Transcription", `Reconocido: "${spoken}"`, "info");
    pi.sendUserMessage(spoken);
  };

  const openTtsModal = async (ctx: ExtensionContext) => {
    if (!ctx.hasUI) {
      dcNotifier.notify(ctx, "DC TTS", "La ventana de control requiere modo TUI interactivo", "warning");
      return;
    }

    let initialSt = await syncVisualStatus();
    if (!initialSt && readTtsPrefs().autoStart) {
      const up = await ensureTtsDaemonRunning();
      if (up) {
        initialSt = await syncVisualStatus();
      }
    }
    const initialVoices = await fetchTtsVoices();
    let liveSt: TtsStatus | null = initialSt;

    await openDcModal<void>(ctx, {
      title: () => {
        const s = liveSt;
        const stLabel = s ? `${s.status} · queue ${s.queue}` : "service offline";
        const arLabel = s?.autoRead ? "auto-read: ON" : "auto-read: OFF";
        return `TTS — ${stLabel} · ${arLabel}`;
      },
      glyph: "⛩ ",
      frame: "double",
      width: "68%",
      maxHeight: "82%",
      footer: (theme) => ({
        left: `  ${theme.fg("accent", "Tab")} pestaña   ${theme.fg("accent", "↑↓")} navegar   ${theme.fg("accent", "←→")} ajustar   ${theme.fg("accent", "Enter")} ejecutar   ${theme.fg("accent", "[p]")} pausa   ${theme.fg("accent", "[t]")} auto-read`,
        right: `${theme.fg("accent", "[ Esc Cerrar ]")}  `,
      }),
      content: (done, theme, tui) =>
        new DcTtsPanel(
          theme,
          ctx,
          {
            fetchStatus: async () => {
              liveSt = await syncVisualStatus();
              return liveSt;
            },
            fetchVoices: () => fetchTtsVoices(),
            ensureDaemon: () => ensureTtsDaemonRunning(),
            sendAction: async (path, body) => {
              const res = await callTtsBridge(path, "POST", body ?? {});
              if (res && typeof res.status === "string" && typeof res.autoRead === "boolean") {
                liveSt = res as TtsStatus;
                ttsBridgeClient.setRate(liveSt.rate);
                writeTtsPrefs({
                  autoRead: liveSt.autoRead,
                  voice: liveSt.voice,
                  rate: liveSt.rate,
                  volume: liveSt.volume,
                });
              }
              if (path === "/read" && res) {
                if (typeof res.paragraphs === "number") paragraphTotal = res.paragraphs;
                if (typeof res.paragraphIndex === "number") paragraphCursor = res.paragraphIndex;
                startSpeechWatch(ctx);
              } else if (path === "/nav" && res) {
                if (typeof res.target === "number") paragraphCursor = res.target;
                startSpeechWatch(ctx);
              } else {
                startSpeechWatch(ctx);
              }
              return res;
            },
            isSoundOn,
            toggleSound: () => {
              const next = !isSoundOn();
              writeTtsPrefs({ soundOn: next });
              void syncVisualStatus();
              return next;
            },
            dictateNow: () => dictateAndSend(ctx),
            getParagraphInfo: () => ({ current: paragraphCursor, total: paragraphTotal }),
          },
          () => done(undefined),
          () => tui.requestRender(),
          initialSt,
          initialVoices,
        ),
    });
  };

  pi.on("session_start", async (_ev, ctx) => {
    activeCtx = ctx;
    const prefs = readTtsPrefs();
    ttsBridgeClient.setRate(prefs.rate);
    if (prefs.autoStart) {
      void ensureTtsDaemonRunning().then(() => syncVisualStatus());
    } else {
      void syncVisualStatus();
    }

    try {
      unsubInput?.();
      unsubInput = ctx.ui.onTerminalInput((data: string) => {
        if (matchesKey(data, "alt+u")) {
          void openTtsModal(ctx);
          return { consume: true };
        }
        if (matchesKey(data, "alt+p")) {
          void callTtsBridge<TtsStatus>("/toggle", "POST", {}).then((r) => {
            if (r?.status === "paused") dcNotifier.notify(ctx, "DC TTS", "⏸ Pausado", "info");
            else if (r?.status === "playing") dcNotifier.notify(ctx, "DC TTS", "▶ Reanudado", "info");
            startSpeechWatch(ctx);
          });
          return { consume: true };
        }
        if (matchesKey(data, "alt+x")) {
          void callTtsBridge("/stop", "POST", {}).then(() => {
            dcNotifier.notify(ctx, "DC TTS", "⏹ Detenido", "info");
            void syncVisualStatus();
          });
          return { consume: true };
        }
        if (matchesKey(data, "alt+r")) {
          void callTtsBridge("/nav", "POST", { direction: "replay" }).then(() => {
            paragraphCursor = 0;
            dcNotifier.notify(ctx, "DC TTS", "🔁 Repitiendo última respuesta", "info");
            startSpeechWatch(ctx);
          });
          return { consume: true };
        }
        if (matchesKey(data, "alt+,")) {
          void callTtsBridge<{ target?: number }>("/nav", "POST", { direction: "prev" }).then((r) => {
            if (typeof r?.target === "number") paragraphCursor = r.target;
            dcNotifier.notify(
              ctx,
              "DC TTS",
              `⏮ Párrafo anterior (${paragraphCursor + 1}/${paragraphTotal || 1})`,
              "info",
            );
            startSpeechWatch(ctx);
          });
          return { consume: true };
        }
        if (matchesKey(data, "alt+.")) {
          void callTtsBridge<{ target?: number }>("/nav", "POST", { direction: "next" }).then((r) => {
            if (typeof r?.target === "number") paragraphCursor = r.target;
            dcNotifier.notify(
              ctx,
              "DC TTS",
              `⏭ Párrafo siguiente (${paragraphCursor + 1}/${paragraphTotal || 1})`,
              "info",
            );
            startSpeechWatch(ctx);
          });
          return { consume: true };
        }
        if (matchesKey(data, "alt+v")) {
          void dictateAndSend(ctx);
          return { consume: true };
        }
        if (questionStepper?.isActive()) {
          const nextPrompt = questionStepper.handleKey(data);
          if (nextPrompt === "__DONE__") {
            questionStepper = null;
            void callTtsBridge("/stop", "POST", {}).then(() => syncVisualStatus());
          } else if (typeof nextPrompt === "string" && nextPrompt.length > 0) {
            void speakSingleQuestion(nextPrompt, ctx);
          }
        }
        return undefined;
      });
    } catch {
      /* noop */
    }
  });

  pi.on("session_shutdown", () => {
    stopSpeechWatch();
    unsubInput?.();
    unsubInput = null;
  });

  pi.on("message_end", async (event: any) => {
    const msg = event?.message;
    if (!msg || msg.role !== "assistant") return;
    const text = extractAssistantMessageText(msg);
    if (text) {
      latestAssistantText = text;
    }
  });

  pi.on("agent_settled", async (_ev, ctx) => {
    if (ctx) activeCtx = ctx;
    questionStepper = null;
    if (!latestAssistantText || latestAssistantText === lastSpokenText) return;
    lastSpokenText = latestAssistantText;

    const res = await callTtsBridge<{
      status?: string;
      paragraphs?: number;
      paragraphIndex?: number;
      skipped?: boolean;
      filtered?: boolean;
    }>("/read", "POST", { text: latestAssistantText });

    if (res && !res.skipped && !res.filtered) {
      if (isSoundOn()) {
        void callTtsBridge("/beep", "POST", { kind: "result" });
      }
      paragraphTotal = res.paragraphs ?? 1;
      paragraphCursor = res.paragraphIndex ?? 0;
      markSpeakingStarted(ctx);
    } else {
      await syncVisualStatus();
    }
  });

  pi.on("tool_call", async (event: any, ctx) => {
    const name = event?.toolName;
    const input = event?.input;
    if (!input) return;

    if (name === "ask_user_choice" && typeof input.question === "string") {
      if (isSoundOn()) void callTtsBridge("/beep", "POST", { kind: "alert" });
      questionStepper = new QuestionQueueStepper([
        { question: input.question, options: input.options },
      ]);
      const first = questionStepper.currentPrompt();
      if (first) {
        await speakSingleQuestion(first, ctx);
      }
    } else if (name === "ask_user_question" && Array.isArray(input.questions)) {
      if (isSoundOn()) void callTtsBridge("/beep", "POST", { kind: "alert" });
      questionStepper = new QuestionQueueStepper(input.questions);
      const first = questionStepper.currentPrompt();
      if (first) {
        await speakSingleQuestion(first, ctx);
      }
    }
  });

  pi.on("tool_result", async (event: any) => {
    const name = event?.toolName;
    if (name === "ask_user_question" || name === "ask_user_choice") {
      questionStepper = null;
    }
  });

  pi.registerCommand("dc-tts", {
    description:
      "Abrir ventana DC Studio de control TTS & Asistente de Voz (/dc-tts [toggle|stop|prev|next|replay|dictate|start])",
    handler: async (args, ctx) => {
      const sub = (args || "").trim().toLowerCase();
      if (sub === "start") {
        const ok = await ensureTtsDaemonRunning();
        dcNotifier.notify(
          ctx,
          "DC TTS",
          ok ? "Daemon Go activo en 127.0.0.1:9877" : "No se pudo iniciar el daemon Go",
          ok ? "info" : "error",
        );
        await syncVisualStatus();
        return;
      }
      if (sub === "toggle" || sub === "pause") {
        await callTtsBridge("/toggle", "POST", {});
        startSpeechWatch(ctx);
        return;
      }
      if (sub === "stop") {
        await callTtsBridge("/stop", "POST", {});
        await syncVisualStatus();
        return;
      }
      if (sub === "prev") {
        await callTtsBridge("/nav", "POST", { direction: "prev" });
        startSpeechWatch(ctx);
        return;
      }
      if (sub === "next") {
        await callTtsBridge("/nav", "POST", { direction: "next" });
        startSpeechWatch(ctx);
        return;
      }
      if (sub === "replay") {
        await callTtsBridge("/nav", "POST", { direction: "replay" });
        startSpeechWatch(ctx);
        return;
      }
      if (sub === "dictate" || sub === "listen") {
        await dictateAndSend(ctx);
        return;
      }
      await openTtsModal(ctx);
    },
  });

  try {
    pi.registerShortcut("alt+u" as never, {
      description: "Abrir ventana DC Studio de configuración TTS y Asistente",
      handler: async (ctx) => {
        await openTtsModal(ctx);
      },
    });
    pi.registerShortcut("alt+p" as never, {
      description: "Pausar / Reanudar lectura TTS actual",
      handler: async (ctx) => {
        await callTtsBridge("/toggle", "POST", {});
        startSpeechWatch(ctx);
      },
    });
    pi.registerShortcut("alt+," as never, {
      description: "Ir al párrafo anterior del TTS",
      handler: async (ctx) => {
        await callTtsBridge("/nav", "POST", { direction: "prev" });
        startSpeechWatch(ctx);
      },
    });
    pi.registerShortcut("alt+." as never, {
      description: "Ir al párrafo siguiente del TTS",
      handler: async (ctx) => {
        await callTtsBridge("/nav", "POST", { direction: "next" });
        startSpeechWatch(ctx);
      },
    });
    pi.registerShortcut("alt+r" as never, {
      description: "Repetir la última respuesta con TTS",
      handler: async (ctx) => {
        await callTtsBridge("/nav", "POST", { direction: "replay" });
        startSpeechWatch(ctx);
      },
    });
    pi.registerShortcut("alt+x" as never, {
      description: "Detener inmediatamente la lectura TTS",
      handler: async () => {
        await callTtsBridge("/stop", "POST", {});
        await syncVisualStatus();
      },
    });
    pi.registerShortcut("alt+v" as never, {
      description: "Dictar instrucción por voz para Pi (dc-transcription)",
      handler: async (ctx) => {
        await dictateAndSend(ctx);
      },
    });
  } catch {
    /* fallback si el host no soporta registerShortcut */
  }
}
