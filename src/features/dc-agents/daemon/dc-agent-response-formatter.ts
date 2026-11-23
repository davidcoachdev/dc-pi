export type AgentRoleType = "super_agent_86" | "super_agent_99" | "dc_control" | "security_shield";

export interface FormattedResponseOptions {
  role: AgentRoleType;
  quote?: string;
  body: string;
  footer?: string;
}

/**
 * Formateador Canónico Institucional de Respuestas para DC Studio.
 * Garantiza que cada Super-Agente mantenga una identidad de marca coherente,
 * estructurada y profesional en GitHub y en el sistema de chat.
 */
export class DcAgentResponseFormatter {
  private static signatures: Record<AgentRoleType, string> = {
    super_agent_86: "🤖 **DC Super-Agent 86** • *Issue Sentinel*",
    super_agent_99: "🕵️‍♀️ **DC Super-Agent 99** • *PR Quality Gate*",
    dc_control: "🎮 **DC-Control Tower** • *System Supervisor*",
    security_shield: "🛡️ **DC Security Shield** • *Community Standards*",
  };

  public static getSignature(role: AgentRoleType): string {
    return this.signatures[role] || "🤖 **DC Agent**";
  }

  public static format(options: FormattedResponseOptions): string {
    const signature = this.getSignature(options.role);
    const parts: string[] = [];

    // 1. Bloque de réplica / cita si existe
    if (options.quote) {
      const cleanQuote = options.quote
        .split("\n")
        .map((l) => (l.trim().startsWith(">") ? l : `> ${l}`))
        .join("\n");
      parts.push(cleanQuote);
      parts.push("");
    }

    // 2. Encabezado con firma institucional
    parts.push(`${signature}:`);
    parts.push("");

    // 3. Cuerpo del mensaje
    parts.push(options.body.trim());

    // 4. Pie de página opcional
    if (options.footer) {
      parts.push("");
      parts.push("---");
      parts.push(options.footer.trim());
    }

    return parts.join("\n");
  }

  public static formatUltimatum(username: string, strikeNumber: number, maxStrikes = 3, reason?: string): string {
    const isFinal = strikeNumber >= maxStrikes;
    const body = isFinal
      ? `🚫 **Cuenta Bloqueada por Infracción de Normas**\n\n` +
        `Hola @${username}, has acumulado **${strikeNumber}/${maxStrikes} faltas** por violaciones reiteradas a las normas de convivencia técnica del proyecto.\n` +
        (reason ? `*Motivo de la infracción:* ${reason}\n\n` : "\n") +
        `Tu comentario ha sido eliminado y tu cuenta de GitHub ha sido **bloqueada** para interactuar en este repositorio. Si consideras que se trata de un error, el titular del proyecto (@davidcoachdev) puede revisar el expediente en la Oficina de Control.`
      : `⚠️ **Advertencia de Normas de la Comunidad (Falta ${strikeNumber}/${maxStrikes})**\n\n` +
        `Hola @${username}, tu comentario anterior ha sido eliminado por no cumplir las normas del proyecto.\n` +
        (reason ? `*Motivo:* ${reason}\n\n` : "\n") +
        `Te quedan **${maxStrikes - strikeNumber} oportunidad(es)** antes de proceder al bloqueo permanente de tu cuenta en este repositorio. Te invitamos a mantener un tono técnico, constructivo y respetuoso.`;

    return this.format({
      role: "security_shield",
      body,
      footer: "Directivas de Moderación y Seguridad de DC Studio",
    });
  }
}
