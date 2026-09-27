/**
 * Convierte un documento Markdown en texto plano optimizado para síntesis de voz (TTS).
 * Remueve bloques de código, tablas complejas, enlaces crudos y formateo que suena mal al hablarse.
 */
export function markdownToSpokenText(markdown: string): string {
  if (!markdown) return "";

  let text = markdown
    // 1. Quitar frontmatter YAML
    .replace(/^---\s*[\r\n][\s\S]*?[\r\n]---\s*/u, "")
    // 2. Quitar bloques de código multilínea ``` ... ```
    .replace(/```[\w-]*[\r\n][\s\S]*?```/gu, " ")
    .replace(/~~~[\w-]*[\r\n][\s\S]*?~~~/gu, " ")
    // 3. Quitar comentarios HTML
    .replace(/<!--[\s\S]*?-->/gu, " ")
    // 4. Convertir imágenes ![alt](url) a vacío
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    // 5. Convertir links [texto](url) a sólo el texto
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    // 6. Quitar código inline `codigo`
    .replace(/`([^`]+)`/gu, "$1")
    // 7. Quitar encabezados #, ##, ###
    .replace(/^#{1,6}\s+(.+)$/gmu, "$1. ")
    // 8. Quitar líneas de tablas | col | col |
    .replace(/^\|.*\|$/gmu, " ")
    // 9. Quitar citas >
    .replace(/^>\s*/gmu, "")
    // 10. Quitar viñetas de listas -, *, +
    .replace(/^[\s]*[-*+]\s+/gmu, "")
    // 11. Quitar negritas y cursivas
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/gu, "$1")
    // 12. Quitar líneas divisorias --- o ===
    .replace(/^[-=_]{3,}\s*$/gmu, "");

  // Normalizar espacios y saltos de línea repetidos
  text = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");

  return text.replace(/\s{2,}/g, " ").trim();
}
