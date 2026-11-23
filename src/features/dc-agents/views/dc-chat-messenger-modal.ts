import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  Markdown,
  type MarkdownTheme,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { openDcModal } from "../../../ui/dc-modal.ts";
import {
  dcChatDatabase,
  type ChatThread,
  type ChatMessageRecord,
} from "../daemon/dc-chat-sqlite-db.ts";
import { dcChatDispatcher } from "../daemon/dc-chat-dispatcher.ts";

/**
 * Panel interactivo tipo "WhatsApp / Messenger" para Super-Agentes:
 * - Panel Izquierdo: Lista de hilos/conversaciones (Issues, Terceros, Agentes) con conteo de no leídos.
 * - Panel Derecho: Historial de mensajes con renderizado Markdown enriquecido, réplicas citadas y respuestas con scroll independiente.
 * - Caja de entrada inferior: Permite al usuario escribir directamente al Super-Agente y recibir respuesta en vivo.
 * - Navegación:
 *   - Flechas Izquierda / Derecha: Cambiar foco entre panel de hilos y panel de mensajes/input.
 *   - Flechas Arriba / Abajo: Cambiar de conversación / hilo seleccionado.
 *   - Ctrl + Flechas Arriba / Abajo (o Rueda del mouse / PageUp / PageDown): Scrollear el área del chat de mensajes.
 */
export class DcChatMessengerPanel implements Component {
  private threads: ChatThread[] = [];
  private selectedThreadIndex = 0;
  private messages: ChatMessageRecord[] = [];
  private inputText = "";
  private isProcessing = false;
  private activePanel: "threads" | "chat" = "chat";
  private chatScrollOffset = 0;
  private maxChatScroll = 0;
  private autoScrollToBottom = true;
  private mdTheme: MarkdownTheme;

  constructor(
    private readonly theme: Theme,
    private readonly onClose: () => void,
    private readonly requestRender?: () => void,
  ) {
    this.mdTheme = this.createMarkdownTheme(theme);
    this.refresh();
  }

  private createMarkdownTheme(theme: Theme): MarkdownTheme {
    const fg = (color: string, s: string) => {
      try {
        if (theme && typeof theme.fg === "function") return theme.fg(color as any, s);
      } catch {}
      return s;
    };
    const bold = (s: string) => {
      try {
        if (theme && typeof theme.bold === "function") return theme.bold(s);
      } catch {}
      return `\x1b[1m${s}\x1b[22m`;
    };

    return {
      heading: (s: string) => fg("accent", bold(s)),
      bold: (s: string) => bold(s),
      italic: (s: string) => `\x1b[3m${s}\x1b[23m`,
      underline: (s: string) => `\x1b[4m${s}\x1b[24m`,
      strikethrough: (s: string) => `\x1b[9m${s}\x1b[29m`,
      code: (s: string) => `\x1b[38;2;250;204;21m${s}\x1b[0m`,
      codeBlock: (s: string) => `\x1b[38;2;250;204;21m${s}\x1b[0m`,
      codeBlockBorder: (s: string) => fg("dim", s),
      listBullet: (s: string) => fg("accent", s),
      quote: (s: string) => fg("dim", s),
      quoteBorder: (s: string) => fg("dim", s),
      hr: (s: string) => fg("border", s),
      link: (s: string) => fg("accent", `\x1b[4m${s}\x1b[24m`),
      linkUrl: (s: string) => fg("dim", s),
    };
  }

  private renderMarkdown(rawText: string, width: number): string[] {
    const safeW = Math.max(16, width);
    const md = new Markdown(rawText || "", 0, 0, this.mdTheme);
    return md.render(safeW);
  }

  private refresh(): void {
    this.threads = dcChatDatabase.listThreads();
    const hasControl = this.threads.some((t) => t.id === "dc-control");
    const hasAgent86 = this.threads.some((t) => t.id === "general-86");
    const hasAgent99 = this.threads.some((t) => t.id === "general-99");

    if (!hasControl) {
      dcChatDatabase.upsertThread({
        id: "dc-control",
        title: "DC-Control • Centro de Mando",
        participant: "dc_control",
        unreadCount: 0,
        updatedAt: Date.now() + 2000,
      });
      dcChatDatabase.addMessage({
        id: `welcome-control-${Date.now()}`,
        threadId: "dc-control",
        sender: "dc_control",
        senderRole: "agent",
        incomingText: "Inicialización de la Torre de Control.",
        replyText: "### 🎮 DC-Control Online\nConsulta aquí el estado de sesiones vivas, labs, o envía directivas globales al sistema.",
        status: "sent",
        timestamp: Date.now(),
      });
    }

    if (!hasAgent86) {
      dcChatDatabase.upsertThread({
        id: "general-86",
        title: "Super-Agente #86 • Issues",
        participant: "super_agent_86",
        unreadCount: 0,
        updatedAt: Date.now() + 1000,
      });
      dcChatDatabase.addMessage({
        id: `welcome-86-${Date.now()}`,
        threadId: "general-86",
        sender: "super_agent_86",
        senderRole: "agent",
        incomingText: "Buzón de mensajería autónomo inicializado en SQLite.",
        replyText: "Listo para supervisar y registrar réplicas de comentarios de GitHub. Puedes escribirme abajo.",
        status: "sent",
        timestamp: Date.now(),
      });
    }

    if (!hasAgent99) {
      dcChatDatabase.upsertThread({
        id: "general-99",
        title: "Super-Agente #99 • PRs",
        participant: "super_agent_99",
        unreadCount: 0,
        updatedAt: Date.now(),
      });
      dcChatDatabase.addMessage({
        id: `welcome-99-${Date.now()}`,
        threadId: "general-99",
        sender: "super_agent_99",
        senderRole: "agent",
        incomingText: "Inspectora de Pull Requests en línea.",
        replyText: "### 🕵️‍♀️ Super-Agente #99 (Quality Gate)\nAudito Blast Radius, suites de pruebas y cumplimiento KISS en PRs de GitHub.",
        status: "sent",
        timestamp: Date.now(),
      });
    }

    this.threads = dcChatDatabase.listThreads();

    if (this.selectedThreadIndex >= this.threads.length) {
      this.selectedThreadIndex = Math.max(0, this.threads.length - 1);
    }

    const currentThread = this.threads[this.selectedThreadIndex];
    if (currentThread) {
      this.messages = dcChatDatabase.getMessagesForThread(currentThread.id);
      dcChatDatabase.markThreadRead(currentThread.id);
    } else {
      this.messages = [];
    }
    this.autoScrollToBottom = true;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const w = Math.max(64, width);
    const innerW = w - 2;
    const lines: string[] = [];

    const bloodBright = (s: string) => `\x1b[38;2;255;51;51m${s}\x1b[0m`;
    const greenBright = (s: string) => `\x1b[38;2;46;204;113m${s}\x1b[0m`;
    const yellowBright = (s: string) => `\x1b[38;2;250;204;21m${s}\x1b[0m`;
    const cyanBright = (s: string) => `\x1b[38;2;56;189;248m${s}\x1b[0m`;
    const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
    const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

    const leftColW = Math.min(36, Math.max(24, Math.floor(innerW * 0.32)));
    const rightColW = innerW - leftColW - 1;

    // Calcular altura dinámica disponible basada en terminal o default 22 filas
    const termRows = (process.stdout?.rows && process.stdout.rows > 0) ? process.stdout.rows : 30;
    // 80% de alto de pantalla menos márgenes del marco DcWindow
    const chatViewportHeight = Math.max(12, Math.min(35, Math.floor(termRows * 0.8) - 8));

    // --- COLUMNA IZQUIERDA (Hilos / Conversaciones) ---
    const leftLines: string[] = [];
    const isThreadsFocused = this.activePanel === "threads";
    const leftHeaderTag = isThreadsFocused ? bloodBright("▶ ") : "  ";
    leftLines.push(`${leftHeaderTag}${bold("Hilos & Issues")} ${dim(`(${this.threads.length})`)}`);
    leftLines.push(dim("─".repeat(leftColW)));

    for (let i = 0; i < this.threads.length; i++) {
      const th = this.threads[i]!;
      const isSel = i === this.selectedThreadIndex;
      const pointer = isSel ? (isThreadsFocused ? bloodBright("● ") : cyanBright("○ ")) : "  ";
      const badge = th.unreadCount > 0 ? bloodBright(` (${th.unreadCount})`) : "";
      const rawTitle = `${th.title}${badge}`;
      const title = truncateToWidth(rawTitle, leftColW - 3, "…");
      const part = truncateToWidth(`  ${dim(th.participant)}`, leftColW - 1, "");

      if (isSel && isThreadsFocused) {
        leftLines.push(`\x1b[7m${pointer}${title}\x1b[27m`);
      } else if (isSel) {
        leftLines.push(`${pointer}${bold(title)}`);
      } else {
        leftLines.push(`${pointer}${title}`);
      }
      leftLines.push(part);
      leftLines.push("");
    }

    // --- COLUMNA DERECHA (Historial de Mensajes del hilo activo con Markdown) ---
    const allRightLines: string[] = [];
    const activeThread = this.threads[this.selectedThreadIndex];
    const isChatFocused = this.activePanel === "chat";

    if (activeThread) {
      const activeHeaderTag = isChatFocused ? bloodBright("▶ ") : "  ";
      allRightLines.push(`${activeHeaderTag}${bold(greenBright("●"))} ${bold(activeThread.title)} ${dim(`(${activeThread.participant})`)}`);
      allRightLines.push(dim("─".repeat(rightColW)));

      if (this.messages.length === 0) {
        allRightLines.push(dim("  (Sin mensajes en este hilo)"));
      } else {
        for (const msg of this.messages) {
          const dateStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          const isOwner = msg.senderRole === "owner";
          const isAgent = msg.senderRole === "agent";

          let senderTag = `${yellowBright(`@${msg.sender}`)} ${dim(`[${dateStr}]`)}`;
          if (isOwner) {
            senderTag = `${bloodBright(`👤 @${msg.sender} (Tú)`)} ${dim(`[${dateStr}]`)}`;
          } else if (isAgent) {
            senderTag = `${greenBright(`🤖 Super-Agent 86`)} ${dim(`[${dateStr}]`)}`;
          }

          allRightLines.push(senderTag);

          // Cita previa si existe
          if (msg.quotedText) {
            const quoteLines = msg.quotedText.split("\n");
            for (const ql of quoteLines) {
              allRightLines.push(`  ${dim("│")} ${dim(ql.replace(/^>\s*/, ""))}`);
            }
          }

          // Mensaje recibido renderizado con Markdown completo
          const contentMdLines = this.renderMarkdown(msg.incomingText, rightColW - 4);
          for (const ml of contentMdLines) {
            allRightLines.push(`  ${msg.isMalicious ? bloodBright(ml) : ml}`);
          }

          // Respuesta del agente si existe renderizada con Markdown
          if (msg.replyText) {
            allRightLines.push(`  ${greenBright("↳")} ${dim("Respuesta del Agente:")}`);
            const replyMdLines = this.renderMarkdown(msg.replyText, rightColW - 6);
            for (const rml of replyMdLines) {
              allRightLines.push(`    ${greenBright("┃")} ${rml}`);
            }
          }
          allRightLines.push("");
        }
      }
    } else {
      allRightLines.push(dim("Selecciona un hilo a la izquierda."));
    }

    // Calcular scroll de la columna derecha
    const totalRightLines = allRightLines.length;
    this.maxChatScroll = Math.max(0, totalRightLines - chatViewportHeight);

    if (this.autoScrollToBottom) {
      this.chatScrollOffset = this.maxChatScroll;
    } else {
      this.chatScrollOffset = Math.max(0, Math.min(this.chatScrollOffset, this.maxChatScroll));
    }

    const visibleRightLines = allRightLines.slice(
      this.chatScrollOffset,
      this.chatScrollOffset + chatViewportHeight,
    );

    // Indicador visual de scrollbar para el chat derecho
    const scrollPercent = this.maxChatScroll > 0
      ? Math.round((this.chatScrollOffset / this.maxChatScroll) * 100)
      : 100;
    const scrollInfo = this.maxChatScroll > 0
      ? dim(` [Scroll ${scrollPercent}%]`)
      : "";

    // Componer ambas columnas lado a lado dentro del viewport
    for (let r = 0; r < chatViewportHeight; r++) {
      const lText = leftLines[r] ?? "";
      let rText = visibleRightLines[r] ?? "";

      if (r === 0 && scrollInfo && rText) {
        rText = truncateToWidth(rText, rightColW - visibleWidth(scrollInfo), "") + scrollInfo;
      }

      const lPadded = lText + " ".repeat(Math.max(0, leftColW - visibleWidth(lText)));
      const rPadded = truncateToWidth(rText, rightColW, "");
      lines.push(`${lPadded} ${dim("│")} ${rPadded}`);
    }

    lines.push(dim("─".repeat(innerW)));

    // Caja de entrada interactiva de mensaje
    const activeParticipant = activeThread?.participant === "dc_control"
      ? "DC-Control"
      : activeThread?.participant === "super_agent_86"
        ? "Agente #86 (Issues)"
        : activeThread?.participant === "super_agent_99"
          ? "Agente #99 (PRs)"
          : activeThread?.title || "Destino";

    const promptPrefix = isChatFocused
      ? `  ${bloodBright(`💬 Tú ➔ ${activeParticipant}:`)} `
      : `  ${dim(`💬 Tú ➔ ${activeParticipant}:`)} `;
    const cursorChar = isChatFocused ? "\x1b[7m \x1b[27m" : "";
    const availableInputW = innerW - visibleWidth(promptPrefix) - 2;
    const displayInput = truncateToWidth(this.inputText, availableInputW, "");
    const placeholder = !this.inputText
      ? (isChatFocused ? dim("Escribe tu pregunta o directiva y presiona Enter...") : dim("(Presiona ➔ para escribir)"))
      : "";

    lines.push(`${promptPrefix}${displayInput}${cursorChar} ${placeholder}`);

    return lines;
  }

  handleInput(data: string): boolean | void {
    if (matchesKey(data, Key.escape)) {
      this.onClose();
      return true;
    }

    // Flechas Izquierda / Derecha: cambiar de panel activo
    if (matchesKey(data, Key.left)) {
      this.activePanel = "threads";
      this.requestRender?.();
      return true;
    }
    if (matchesKey(data, Key.right)) {
      this.activePanel = "chat";
      this.requestRender?.();
      return true;
    }

    // Ctrl + Arriba / Ctrl + Abajo: Scrollear el área del chat (soporta múltiples emuladores y terminales)
    const isCtrlUp =
      matchesKey(data, "ctrl+up") ||
      matchesKey(data, Key.ctrl("up")) ||
      matchesKey(data, Key.pageUp) ||
      data === "\x1b[1;5A" ||
      data === "\x1b[5A" ||
      data === "\x1bOa" ||
      data === "\x1b[5~";

    const isCtrlDown =
      matchesKey(data, "ctrl+down") ||
      matchesKey(data, Key.ctrl("down")) ||
      matchesKey(data, Key.pageDown) ||
      data === "\x1b[1;5B" ||
      data === "\x1b[5B" ||
      data === "\x1bOb" ||
      data === "\x1b[6~";

    if (isCtrlUp) {
      this.autoScrollToBottom = false;
      this.chatScrollOffset = Math.max(0, this.chatScrollOffset - 3);
      this.requestRender?.();
      return true;
    }

    if (isCtrlDown) {
      this.chatScrollOffset = Math.min(this.maxChatScroll, this.chatScrollOffset + 3);
      if (this.chatScrollOffset >= this.maxChatScroll) {
        this.autoScrollToBottom = true;
      }
      this.requestRender?.();
      return true;
    }

    // Flechas Arriba / Abajo: Cambiar de conversación / hilo
    if (matchesKey(data, Key.up)) {
      if (this.selectedThreadIndex > 0) {
        this.selectedThreadIndex--;
        const currentThread = this.threads[this.selectedThreadIndex];
        if (currentThread) {
          this.messages = dcChatDatabase.getMessagesForThread(currentThread.id);
          dcChatDatabase.markThreadRead(currentThread.id);
        }
        this.autoScrollToBottom = true;
        this.chatScrollOffset = 0;
        this.requestRender?.();
      }
      return true;
    }

    if (matchesKey(data, Key.down)) {
      if (this.selectedThreadIndex < this.threads.length - 1) {
        this.selectedThreadIndex++;
        const currentThread = this.threads[this.selectedThreadIndex];
        if (currentThread) {
          this.messages = dcChatDatabase.getMessagesForThread(currentThread.id);
          dcChatDatabase.markThreadRead(currentThread.id);
        }
        this.autoScrollToBottom = true;
        this.chatScrollOffset = 0;
        this.requestRender?.();
      }
      return true;
    }

    // Manejo de escritura en la barra de entrada
    if (matchesKey(data, Key.backspace)) {
      if (this.inputText.length > 0) {
        this.inputText = this.inputText.slice(0, -1);
        this.requestRender?.();
      }
      return true;
    }

    // Enviar mensaje al Super-Agente
    if (matchesKey(data, Key.enter)) {
      const text = this.inputText.trim();
      if (!text || this.isProcessing) return true;

      this.inputText = "";
      this.isProcessing = true;
      this.autoScrollToBottom = true;

      const activeThread = this.threads[this.selectedThreadIndex];
      const threadId = activeThread?.id || "general-86";
      const issueNum = activeThread?.issueNumber || 86;

      const userMsgId = `usr-${Date.now()}`;
      dcChatDatabase.addMessage({
        id: userMsgId,
        threadId,
        sender: "davidcoachdev",
        senderRole: "owner",
        incomingText: text,
        status: "sent",
        timestamp: Date.now(),
      });

      this.refresh();
      this.requestRender?.();

      // Consultar al despachador inteligente central (DC-Control / Super-Agentes)
      void (async () => {
        try {
          const result = await dcChatDispatcher.dispatch({
            threadId,
            sender: "davidcoachdev",
            text,
            issueNumber: activeThread?.issueNumber,
            issueTitle: activeThread?.title,
          });

          const agentMsgId = `agent-${Date.now()}`;
          dcChatDatabase.addMessage({
            id: agentMsgId,
            threadId,
            sender: result.respondent,
            senderRole: "agent",
            incomingText: text,
            quotedText: `> ${text}`,
            replyText: result.reply,
            status: "sent",
            timestamp: Date.now(),
          });
        } catch (err: any) {
          const errMsgId = `err-${Date.now()}`;
          dcChatDatabase.addMessage({
            id: errMsgId,
            threadId,
            sender: "system",
            senderRole: "agent",
            incomingText: text,
            replyText: `⚠️ Error procesando consulta: ${err?.message || "Desconocido"}`,
            status: "sent",
            timestamp: Date.now(),
          });
        } finally {
          this.isProcessing = false;
          this.refresh();
          this.autoScrollToBottom = true;
          this.requestRender?.();
        }
      })();

      return true;
    }

    // Caracteres imprimibles en la caja de entrada
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.inputText += data;
      this.activePanel = "chat";
      this.requestRender?.();
      return true;
    }

    return undefined;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    // Rueda del mouse sobre el área del chat para hacer scroll
    if (event.type === "wheel" && typeof event.wheelDelta === "number") {
      if (event.wheelDelta > 0) {
        this.chatScrollOffset = Math.min(this.maxChatScroll, this.chatScrollOffset + 2);
        if (this.chatScrollOffset >= this.maxChatScroll) {
          this.autoScrollToBottom = true;
        } else {
          this.autoScrollToBottom = false;
        }
        this.requestRender?.();
        return { handled: true };
      } else if (event.wheelDelta < 0) {
        this.autoScrollToBottom = false;
        this.chatScrollOffset = Math.max(0, this.chatScrollOffset - 2);
        this.requestRender?.();
        return { handled: true };
      }
    }

    if (event.type === "click" && event.button === "left") {
      this.requestRender?.();
      return { handled: true };
    }
    return undefined;
  }
}

/**
 * Abre el visor completo de Chat Messenger de Super-Agentes respaldado en SQLite.
 * Dimensiones: 80% de ancho y 80% de alto con el footer oficial de DcWindow.
 */
export async function openAgentChatMessengerModal(ctx: ExtensionContext): Promise<void> {
  await openDcModal(ctx, {
    title: "💬 DC Studio • Centro de Mando & Mensajería Global",
    glyph: "💬 ",
    width: "80%",
    maxHeight: "80%",
    scrollable: false, // El scrolling interno lo maneja DcChatMessengerPanel con Ctrl+Up/Down
    footer: {
      left: "[←/→] Cambiar Panel  [↑/↓] Cambiar Conversación  [Ctrl+↑/↓] Scroll Chat",
      right: "[Esc] Cerrar",
    },
    content: (done, theme, tui) => {
      return new DcChatMessengerPanel(
        theme,
        () => done(),
        () => {
          try { (tui as any)?.requestRender?.(); } catch {}
        },
      );
    },
  });
}
