/**
 * Coloreado por carácter para arte ASCII grande de DC Studio.
 * Port fiel del plugin OpenCode / Gentle-pi.
 * Mapea caracteres individuales a roles de tema de Pi (accent, error, text, muted, warning).
 */
export function paintBigLine(line: string, fg: (role: string, text: string) => string): string {
  return Array.from(line)
    .map((ch, idx) => {
      let role = "accent";
      const isOuter =
        ch === "┌" ||
        ch === "┐" ||
        ch === "└" ||
        ch === "┘" ||
        (ch === "─" && (line.trim().startsWith("┌") || line.trim().startsWith("└"))) ||
        (ch === "│" && (idx === 0 || idx === line.length - 1));

      if (isOuter) role = "error";
      else if ("~".includes(ch)) role = "text";
      else if ("▲".includes(ch)) role = "error";
      else if ("╔║╚╞╒╝╗╛╕╜╖".includes(ch)) role = "text";
      else if ("═".includes(ch) && line.includes("╔")) role = "text";
      else if ("♥".includes(ch)) role = "error";
      else if ("■♦≡".includes(ch)) role = "accent";
      else if ("╩‖".includes(ch)) role = "muted";
      else if ("╘╬╕╒«»═╝╗╛╜╖".includes(ch)) role = "text";
      else if ("#".includes(ch)) role = "error";
      else if ("zZ".includes(ch)) role = "muted";
      else if ("?!".includes(ch)) role = "warning";

      return fg(role, ch);
    })
    .join("");
}
