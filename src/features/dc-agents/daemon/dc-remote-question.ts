import * as fs from "node:fs";
import * as path from "node:path";
import { getDcStudioDir } from "../../../core/dc-paths.ts";

export interface AgentQuestionPacket {
  id: string; // uuid único de la pregunta
  issueNumber: number;
  issueTitle: string;
  contextSummary: string; // Qué estaba haciendo, qué archivos leyó
  question: string; // Pregunta directa y concreta
  options?: string[]; // Ej: ["Por repositorio actual", "Global"]
  allowCustomText?: boolean; // Habilitar caja de texto libre (por defecto true)
  createdAt: number;
  expiresAt: number;
}

export interface AgentAnswerPacket {
  questionId: string;
  chosenOption?: string; // Si seleccionó [1], [2], etc.
  customText?: string; // Si escribió texto libre
  answeredAt: number;
  source: "option" | "custom_text" | "dismissed";
}

/**
 * Gestor IPC de Consultas Remotas entre Workers en Background y la Sesión Principal de Pi.
 * Utiliza un directorio atómico de buzón en ~/.pi/agent/dc-studio/questions/ y answers/.
 */
export class DcRemoteQuestionManager {
  private static instance?: DcRemoteQuestionManager;
  private questionsDir: string;
  private answersDir: string;

  constructor(customBaseDir?: string) {
    const base = customBaseDir || getDcStudioDir();
    this.questionsDir = path.join(base, "questions");
    this.answersDir = path.join(base, "answers");
    this.ensureDirs();
  }

  public static getInstance(): DcRemoteQuestionManager {
    if (!DcRemoteQuestionManager.instance) {
      DcRemoteQuestionManager.instance = new DcRemoteQuestionManager();
    }
    return DcRemoteQuestionManager.instance;
  }

  private ensureDirs(): void {
    if (!fs.existsSync(this.questionsDir)) {
      fs.mkdirSync(this.questionsDir, { recursive: true });
    }
    if (!fs.existsSync(this.answersDir)) {
      fs.mkdirSync(this.answersDir, { recursive: true });
    }
  }

  /**
   * Un worker en background emite una pregunta y queda a la espera de respuesta (bloqueante sincrónico o promesa).
   */
  public postQuestion(packet: Omit<AgentQuestionPacket, "id" | "createdAt" | "expiresAt"> & { id?: string; timeoutMs?: number }): AgentQuestionPacket {
    this.ensureDirs();
    const id = packet.id || `q-${packet.issueNumber}-${Date.now()}`;
    const timeout = packet.timeoutMs || 10 * 60 * 1000; // 10 minutos por defecto
    const now = Date.now();

    const fullPacket: AgentQuestionPacket = {
      id,
      issueNumber: packet.issueNumber,
      issueTitle: packet.issueTitle,
      contextSummary: packet.contextSummary,
      question: packet.question,
      options: packet.options && packet.options.length > 0 ? packet.options : ["Continuar", "Cancelar"],
      allowCustomText: packet.allowCustomText !== false,
      createdAt: now,
      expiresAt: now + timeout,
    };

    const filePath = path.join(this.questionsDir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fullPacket, null, 2), "utf8");
    return fullPacket;
  }

  /**
   * La sesión interactiva responde a la pregunta abierta.
   */
  public postAnswer(answer: AgentAnswerPacket): void {
    this.ensureDirs();
    const filePath = path.join(this.answersDir, `${answer.questionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(answer, null, 2), "utf8");

    // Limpiar archivo de pregunta una vez respondida
    const qPath = path.join(this.questionsDir, `${answer.questionId}.json`);
    if (fs.existsSync(qPath)) {
      try { fs.unlinkSync(qPath); } catch { /* best effort */ }
    }
  }

  /**
   * Espera sincrónica/asincrónica a que la respuesta esté disponible en disco.
   */
  public async waitForAnswer(questionId: string, timeoutMs: number = 600000): Promise<AgentAnswerPacket> {
    const answerPath = path.join(this.answersDir, `${questionId}.json`);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (fs.existsSync(answerPath)) {
        try {
          const raw = fs.readFileSync(answerPath, "utf8");
          const parsed = JSON.parse(raw);
          // Limpiar archivo de respuesta una vez leída
          try { fs.unlinkSync(answerPath); } catch { /* best effort */ }
          return parsed as AgentAnswerPacket;
        } catch {
          /* archivo a medio escribir, esperar siguiente tick */
        }
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    return {
      questionId,
      answeredAt: Date.now(),
      source: "dismissed",
      customText: "Timeout: No se recibió respuesta humana a tiempo.",
    };
  }

  /**
   * Consulta si hay preguntas pendientes de resolver en el buzón.
   */
  public getPendingQuestions(): AgentQuestionPacket[] {
    this.ensureDirs();
    try {
      const files = fs.readdirSync(this.questionsDir).filter((f) => f.endsWith(".json"));
      const packets: AgentQuestionPacket[] = [];
      const now = Date.now();

      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(this.questionsDir, f), "utf8");
          const p = JSON.parse(raw) as AgentQuestionPacket;
          if (p.expiresAt > now) {
            packets.push(p);
          } else {
            // Limpiar expirados
            try { fs.unlinkSync(path.join(this.questionsDir, f)); } catch { /* noop */ }
          }
        } catch {
          /* ignore */
        }
      }

      return packets.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }
}

export const dcRemoteQuestionManager = DcRemoteQuestionManager.getInstance();
