/**
 * Catálogo de iconos para herramientas en DC Studio.
 */
export const DC_TOOL_ICONS: Record<string, string> = {
  write: "✍",
  read: "📖",
  edit: "✏",
  bash: "📟",
  grep: "🔍",
  find: "🔎",
  ls: "📂",
  todo: "📋",
  agent: "🤖",
  subagent_run: "🤖",
  subagent_result: "🤖",
  mem_save: "🧠",
  mem_search: "🧠",
  mem_update: "🧠",
  mem_delete: "🧠",
  mem_context: "🧠",
  mem_session_summary: "🧠",
  fetch_content: "🌐",
  web_search: "🌐",
  source_check: "🔎",
};

/**
 * Obtiene el icono emoji correspondiente al nombre de la herramienta.
 */
export function getToolIcon(toolName?: string): string {
  if (!toolName) return "🛠";
  const lower = toolName.trim().toLowerCase();
  return DC_TOOL_ICONS[lower] ?? "🛠";
}
