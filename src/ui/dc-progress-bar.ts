/**
 * Renderiza una barra de progreso pura en modo texto con caracteres configurables
 * y soporte opcional de color ANSI.
 *
 * @param pct Porcentaje de completitud (0 a 100).
 * @param length Longitud visible total de la barra (por defecto 10).
 * @param charFilled Carácter para los bloques llenos (por defecto "█") o secuencia ANSI de color.
 * @param charEmpty Carácter para los bloques vacíos (por defecto "░").
 * @param colorAnsi Secuencia ANSI opcional para colorear la sección llena.
 */
export function renderProgressBar(
  pct: number,
  length: number = 10,
  charFilled: string = "█",
  charEmpty: string = "░",
  colorAnsi?: string,
): string {
  const clampedPct = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const len = Math.max(1, Math.floor(length));
  const filledCount = Math.min(len, Math.max(0, Math.round((clampedPct / 100) * len)));
  const emptyCount = Math.max(0, len - filledCount);

  let filledChar = charFilled;
  let emptyChar = charEmpty;
  let activeColor = colorAnsi;

  // Si el 3er argumento es una secuencia ANSI (soporte para llamadas (pct, width, color))
  if (charFilled.startsWith("\x1b")) {
    activeColor = charFilled;
    filledChar = "█";
    emptyChar = "░";
  }

  const filledStr = filledChar.repeat(filledCount);
  const emptyStr = emptyChar.repeat(emptyCount);

  if (activeColor) {
    return `${activeColor}${filledStr}\x1b[0m${emptyStr}`;
  }

  return `${filledStr}${emptyStr}`;
}
