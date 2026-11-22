import * as fs from "node:fs";
import * as path from "node:path";
import { getDcStudioDir } from "../../../core/dc-paths.ts";

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

  public recordMessage(msg: Omit<ChatMessageEntry, "receivedAt" | "status"> & { status?: ChatMessageEntry["status"] }): ChatMessageEntry {
    this.ensureDir();
    const entry: ChatMessageEntry = {
      ...msg,
      status: msg.status || "pending_review",
      receivedAt: Date.now(),
    };
    const file = path.join(this.chatDir, `${entry.id}.json`);
    try {
      fs.writeFileSync(file, JSON.stringify(entry, null, 2), "utf8");
    } catch {}
    return entry;
  }

  public updateStatus(id: string, status: ChatMessageEntry["status"], finalReply?: string): void {
    this.ensureDir();
    const file = path.join(this.chatDir, `${id}.json`);
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
          const raw = fs.readFileSync(path.join(this.chatDir, f), "utf8");
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
