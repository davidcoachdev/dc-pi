import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { dcNotifier } from "../../integrations/dc-notify/dc-notifier.ts";
import { agentVisualStateStore, type AgentState } from "../../core/dc-agent-state/index.ts";
import {
  ANIM_MS,
  computeTalkAnimMs,
  DOT,
  type FaceMode,
  setFaceFrameIndex,
  setActiveFaceMode,
  mapAgentStateToFaceMode,
} from "./core/dc-face-types.ts";
import { readFacePrefs, writeFacePrefs } from "./core/dc-face-prefs.ts";
import { ttsBridgeClient } from "./core/dc-face-bridge.ts";
import { getMiniFaceFrame } from "./art/mini.ts";
import { bigFramesFor, bigDefaultFor } from "./art/index.ts";
import { openProfilePicker } from "./views/dc-profile-duel.ts";

export const FACE_KEY = Symbol.for("dc.face.mini");
export const FACE_DEMO_KEY = Symbol.for("dc.face.demo");

function bumpCache(tui: any): void {
  try {
    const term = tui?.terminal as Record<symbol, { revision?: number }> | undefined;
    const cache = term?.[Symbol.for("gentle-pi.experimental-sidebar.cache")];
    if (cache) cache.revision = (cache.revision ?? 0) + 1;
  } catch {
    /* noop */
  }
}

export default function dcFaceExtension(pi: ExtensionAPI): void {
  let ctxRef: ExtensionContext | null = null;
  let tuiRef: any = null;
  let animTimer: ReturnType<typeof setInterval> | null = null;
  let demoTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubInput: (() => void) | null = null;
  let unsubStore: (() => void) | null = null;
  let unsubTts: (() => void) | null = null;

  let frameIdx = 0;
  let activeMode: FaceMode = "feliz";
  let animIntervalMs = 0;
  let isDemoActive = false;

  const getProfile = () => readFacePrefs().profile ?? "dcdev";
  const getTui = () => tuiRef ?? (globalThis as any)[Symbol.for("dc.sidebar.tui-ref")];

  const publishMiniFace = () => {
    setFaceFrameIndex(frameIdx);
    setActiveFaceMode(activeMode);
    const raw = getMiniFaceFrame(activeMode, frameIdx);
    const tts = ttsBridgeClient.getStatus() === "playing" ? " ▶" : "";
    const plain = `${activeMode} ${raw}${tts}`;
    try {
      (globalThis as any)[FACE_KEY] = plain;
    } catch {
      /* noop */
    }
  };

  const paintIndicator = () => {
    if (!ctxRef) return;
    const theme = ctxRef.ui.theme;
    try {
      if (activeMode === "pensando" || activeMode === "reintentando") {
        ctxRef.ui.setWorkingIndicator({
          frames: ["◐", "◑", "◒", "◓"].map((s) => (theme ? theme.fg("accent", s) : s)),
          intervalMs: 120,
        });
      } else if (activeMode === "trabajando" || activeMode === "compactando") {
        ctxRef.ui.setWorkingIndicator({
          frames: ["<", "^", ">", "v"].map((s) => (theme ? theme.fg("accent", s) : s)),
          intervalMs: 150,
        });
      } else if (activeMode === "escribiendo" || activeMode === "hablando") {
        ctxRef.ui.setWorkingIndicator({
          frames: ["·", "•", "●", "•"].map((s) => (theme ? theme.fg("accent", s) : s)),
          intervalMs:
            activeMode === "hablando" ? computeTalkAnimMs(ttsBridgeClient.getRate()) : 150,
        });
      } else {
        ctxRef.ui.setWorkingIndicator(undefined); // default spinner
      }
    } catch {
      /* noop */
    }
  };

  /**
   * Determina si un modo tiene animación de múltiples frames.
   * 'feliz' es estático en reposo inicial (1 solo frame: ≧(❂‿❂)≦).
   * 'dormido' tiene 4 frames de sueño (z, z Z, z Z Z) y se anima continuamente hasta que el agente cambie de estado.
   * Todos los estados activos (pensando, trabajando, escribiendo, compactando, etc.) se animan continuamente.
   */
  const hasAnimatedFrames = (mode: FaceMode): boolean => {
    return mode !== "feliz";
  };

  const syncFaceMode = (mode: FaceMode) => {
    const modeChanged = activeMode !== mode;
    activeMode = mode;
    if (modeChanged) {
      // Para 'hablando', iniciar en frame 1 (boca abierta) para respuesta visual inmediata
      frameIdx = mode === "hablando" ? 1 : 0;
    }
    publishMiniFace();
    paintIndicator();
    const tui = getTui();
    if (tui) {
      bumpCache(tui);
      tui.requestRender?.();
    }

    // Animar continuamente cualquier modo que tenga múltiples frames (incluido 'dormido' y 'hablando')
    // 'hablando' escala dinámicamente con computeTalkAnimMs(rate); el resto usa ANIM_MS (900ms)
    const shouldAnimate = hasAnimatedFrames(activeMode) && !isDemoActive;
    const targetInterval =
      activeMode === "hablando" ? computeTalkAnimMs(ttsBridgeClient.getRate()) : ANIM_MS;

    if (shouldAnimate && (!animTimer || animIntervalMs !== targetInterval)) {
      if (animTimer) {
        clearInterval(animTimer);
        animTimer = null;
      }
      animIntervalMs = targetInterval;
      animTimer = setInterval(() => {
        if (!isDemoActive) {
          frameIdx = (frameIdx + 1) % 10000;
          publishMiniFace();
          const t = getTui();
          if (t) {
            bumpCache(t);
            t.requestRender?.();
          }
        }
      }, targetInterval);
      animTimer.unref?.();
    } else if (!shouldAnimate && animTimer) {
      clearInterval(animTimer);
      animTimer = null;
      animIntervalMs = 0;
    }
  };

  const stopDemo = () => {
    if (demoTimer) {
      clearTimeout(demoTimer);
      demoTimer = null;
    }
    isDemoActive = false;
    const currentState = agentVisualStateStore.getState() ?? "idle";
    const nextMode: FaceMode =
      ttsBridgeClient.getStatus() === "playing" ? "hablando" : mapAgentStateToFaceMode(currentState);
    syncFaceMode(nextMode);
  };

  const startDemo = (ctx: ExtensionContext, only?: FaceMode) => {
    stopDemo();
    isDemoActive = true;
    const profile = getProfile();
    const modes: FaceMode[] = only ? [only] : (Object.keys(DOT) as FaceMode[]);
    const steps: Array<{ mode: FaceMode; frame: number }> = [];

    for (const m of modes) {
      const big = bigFramesFor(profile, m) ?? [bigDefaultFor(profile)];
      for (let f = 0; f < big.length; f++) {
        steps.push({ mode: m, frame: f });
      }
    }

    let i = 0;
    const step = () => {
      const s = steps[i];
      if (!s) {
        stopDemo();
        dcNotifier.notify(ctx, "DC Face", `Demo de caras finalizado (${profile})`, "info");
        return;
      }

      activeMode = s.mode;
      frameIdx = s.frame;
      publishMiniFace();
      paintIndicator();
      const tui = getTui();
      if (tui) {
        bumpCache(tui);
        tui.requestRender?.();
      }

      i += 1;
      demoTimer = setTimeout(step, 700);
    };

    step();
  };

  // Exponer control de demo para el Sidebar Footer
  (globalThis as any)[FACE_DEMO_KEY] = () => {
    try {
      if (isDemoActive) {
        stopDemo();
      } else if (ctxRef) {
        startDemo(ctxRef);
      }
    } catch {
      /* noop */
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;

    try {
      ctx.ui.setWidget(
        "dc-face-anchor",
        (tui) => {
          tuiRef = tui;
          return { render: () => [], invalidate() {} };
        },
        { placement: "belowEditor" },
      );
    } catch {
      /* noop */
    }

    // Sincronización de estado con AgentVisualStateStore
    unsubStore = agentVisualStateStore.subscribe((state) => {
      if (!isDemoActive) {
        if (ttsBridgeClient.getStatus() === "playing") {
          syncFaceMode("hablando");
        } else {
          syncFaceMode(mapAgentStateToFaceMode(state));
        }
      }
    });

    // Sincronización con TTS bridge (tiene prioridad visual mientras la voz está hablando)
    unsubTts = ttsBridgeClient.subscribe((ttsStatus) => {
      if (!isDemoActive) {
        if (ttsStatus === "playing") {
          syncFaceMode("hablando");
        } else if (activeMode === "hablando") {
          const fallbackState = agentVisualStateStore.getState() ?? "idle";
          syncFaceMode(
            fallbackState === "talking" ? "feliz" : mapAgentStateToFaceMode(fallbackState),
          );
        }
      }
    });

    // Captura global de atajo Alt+C
    unsubInput = ctx.ui.onTerminalInput((data: string) => {
      if (!matchesKey(data, "alt+c")) return undefined;
      void openProfilePicker(ctx);
      return { consume: true };
    });

    // Inicializar estado reactivo sin polling ciego
    const initMode: FaceMode =
      ttsBridgeClient.getStatus() === "playing"
        ? "hablando"
        : mapAgentStateToFaceMode(agentVisualStateStore.getState() ?? "idle");
    syncFaceMode(initMode);
  });

  pi.on("session_shutdown", () => {
    stopDemo();
    ttsBridgeClient.stopPolling();
    if (animTimer) {
      clearInterval(animTimer);
      animTimer = null;
      animIntervalMs = 0;
    }
    setActiveFaceMode(undefined);
    unsubStore?.();
    unsubStore = null;
    unsubTts?.();
    unsubTts = null;
    unsubInput?.();
    unsubInput = null;
    ctxRef = null;
  });

  // Comando canónico /dc-face
  pi.registerCommand("dc-face", {
    description: "Gestión de presencia animada y selector de perfiles de DC Studio (/dc-face [pick|demo|cubis|dcdev])",
    handler: async (args: string | undefined, ctx: ExtensionContext) => {
      const sub = (args || "").trim().toLowerCase();

      if (sub === "pick" || sub === "perfil") {
        await openProfilePicker(ctx);
        return;
      }

      if (sub === "demo off" || sub === "stop") {
        stopDemo();
        dcNotifier.notify(ctx, "DC Face", "Demo de caras detenido", "info");
        return;
      }

      if (sub === "demo" || sub.startsWith("demo ")) {
        const only = sub.split(/\s+/)[1] as FaceMode | undefined;
        startDemo(ctx, only);
        dcNotifier.notify(ctx, "DC Face", `Demo de caras activo (${getProfile()}) — /dc-face demo off para parar`, "info");
        return;
      }

      if (sub === "cubis" || sub === "dcdev") {
        writeFacePrefs({ profile: sub });
        frameIdx = 0;
        publishMiniFace();
        dcNotifier.notify(ctx, "DC Face", `Perfil cambiado a: ${sub}`, "info");
        return;
      }

      // Por defecto: mostrar picker de perfiles
      await openProfilePicker(ctx);
    },
  });

  // Alias /dc-faces para abrir directamente el duelo/selector de perfiles
  pi.registerCommand("dc-faces", {
    description: "Abrir selector de perfiles de caritas de DC Studio",
    handler: async (_args: string | undefined, ctx: ExtensionContext) => {
      await openProfilePicker(ctx);
    },
  });

  // Atajo canónico Alt+C
  pi.registerShortcut("alt+c", {
    description: "Abrir selector de perfiles de caritas (dcdev vs cubis)",
    handler: async (ctx: ExtensionContext) => {
      await openProfilePicker(ctx);
    },
  });
}
