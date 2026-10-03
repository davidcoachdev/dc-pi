/**
 * Coloreado con run-length chunking para arte ASCII grande de DC Studio.
 * Agrupa caracteres consecutivos del mismo rol semántico para reducir
 * las llamadas a theme.fg() y el tamaño de las secuencias de escape ANSI.
 */
export function paintBigLine(line: string, fg: (role: string, text: string) => string): string {
  if (!line) return "";

  const trimmed = line.trim();
  const startsWithCorner = trimmed.startsWith("┌") || trimmed.startsWith("└");
  const chars = Array.from(line);
  const len = chars.length;

  const getRole = (ch: string, idx: number): string => {
    const isOuter =
      ch === "┌" ||
      ch === "┐" ||
      ch === "└" ||
      ch === "┘" ||
      (ch === "─" && startsWithCorner) ||
      (ch === "│" && (idx === 0 || idx === len - 1));

    if (isOuter) return "error";
    if (ch === "~") return "text";
    if (ch === "▲") return "error";
    if ("╔║╚╞╒╝╗╛╕╜╖".includes(ch)) return "text";
    if (ch === "═" && line.includes("╔")) return "text";
    if (ch === "♥") return "error";
    if ("■♦≡".includes(ch)) return "accent";
    if ("╩‖".includes(ch)) return "muted";
    if ("╘╬«»═╝╗╛╜╖".includes(ch)) return "text";
    if (ch === "#") return "error";
    if (ch === "z" || ch === "Z") return "muted";
    if (ch === "?" || ch === "!") return "warning";

    return "accent";
  };

  let out = "";
  let currentChunk = "";
  let currentRole = "";

  for (let i = 0; i < len; i++) {
    const ch = chars[i]!;
    const role = getRole(ch, i);

    if (role === currentRole) {
      currentChunk += ch;
    } else {
      if (currentChunk) {
        out += fg(currentRole, currentChunk);
      }
      currentChunk = ch;
      currentRole = role;
    }
  }

  if (currentChunk) {
    out += fg(currentRole, currentChunk);
  }

  return out;
}
