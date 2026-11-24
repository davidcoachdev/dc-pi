import * as fs from "node:fs";
import * as path from "node:path";
import { getDcStudioDir } from "../../../core/dc-paths.ts";
import { assertPathWithinRoots } from "../../../core/dc-path-confinement.ts";

const SAFE_CHAT_ID_RE = /^[A-Za-z0-9._-]+$/;

export function assertValidChatMessageId(id: string): string {
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    !SAFE_CHAT_ID_RE.test(id) ||
    id === "." ||
    id === ".." ||
    id.includes("..")
  ) {
    throw new Error(
      `ID de mensaje inválido: "${String(id)}". Solo se permiten [A-Za-z0-9._-] sin ".." ni separadores de ruta.`,
    );
  }
  return id;
}

export interface ChatMessageEntry {
  id: string;
  issueNumber: number;
  authorLogin: string;
  incomingText: string;
  proposedReply: string;
  status: "pending_review" | "approved" | "rejected" | "sent";
  isMalicious?: boolean;
  receivedAt: number;
  reviewedAt?: number;
  finalReply?: string;
}

/**
 * Gestor persistente del buzón de Chat / Messenger para Super-Agentes.
 * Guarda los mensajes en ~/.pi/agent/dc-studio/chat_messages/
 */
export class DcSuperAgentChatManager {
  private static instance?: DcSuperAgentChatManager;
  private chatDir: string;

  constructor(customBaseDir?: string) {
    const base = customBaseDir || getDcStudioDir();
    this.chatDir = path.join(base, "chat_messages");
    this.ensureDir();
  }

  public static getInstance(): DcSuperAgentChatManager {
    if (!DcSuperAgentChatManager.instance) {
      DcSuperAgentChatManager.instance = new DcSuperAgentChatManager();
    }
    return DcSuperAgentChatManager.instance;
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.chatDir)) {
      try {
        fs.mkdirSync(this.chatDir, { recursive: true });
      } catch {}
    }
  }

  private resolveMessageFile(id: string): string {
    const safeId = assertValidChatMessageId(id);
    const candidate = path.join(this.chatDir, `${safeId}.json`);
    return assertPathWithinRoots(candidate, [this.chatDir], "archivo de mensaje de chat");
  }

  public recordMessage(msg: Omit<ChatMessageEntry, "receivedAt" | "status"> & { status?: ChatMessageEntry["status"] }): ChatMessageEntry {
    this.ensureDir();
    const safeId = assertValidChatMessageId(msg.id);
    const entry: ChatMessageEntry = {
      ...msg,
      id: safeId,
      status: msg.status || "pending_review",
      receivedAt: Date.now(),
    };
    const file = this.resolveMessageFile(safeId);
    try {
      fs.writeFileSync(file, JSON.stringify(entry, null, 2), "utf8");
    } catch {}
    return entry;
  }

  public updateStatus(id: string, status: ChatMessageEntry["status"], finalReply?: string): void {
    this.ensureDir();
    const file = this.resolveMessageFile(id);
    if (fs.existsSync(file)) {
      try {
        const raw = fs.readFileSync(file, "utf8");
        const entry = JSON.parse(raw) as ChatMessageEntry;
        entry.status = status;
        entry.reviewedAt = Date.now();
        if (finalReply) entry.finalReply = finalReply;
        fs.writeFileSync(file, JSON.stringify(entry, null, 2), "utf8");
      } catch {}
    }
  }

  public getPendingMessages(): ChatMessageEntry[] {
    return this.listMessages().filter((m) => m.status === "pending_review");
  }

  public listMessages(limit = 50): ChatMessageEntry[] {
    this.ensureDir();
    try {
      const files = fs.readdirSync(this.chatDir).filter((f) => f.endsWith(".json"));
      const list: ChatMessageEntry[] = [];
      for (const f of files) {
        try {
          const filePath = assertPathWithinRoots(
            path.join(this.chatDir, f),
            [this.chatDir],
            "archivo de mensaje de chat",
          );
          const raw = fs.readFileSync(filePath, "utf8");
          list.push(JSON.parse(raw));
        } catch {}
      }
      return list.sort((a, b) => b.receivedAt - a.receivedAt).slice(0, limit);
    } catch {
      return [];
    }
  }
}

export const dcSuperAgentChatManager = DcSuperAgentChatManager.getInstance();
