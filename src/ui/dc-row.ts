import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/**
 * Justifica dos fragmentos de texto (izquierda y derecha) en una sola fila
 * con un ancho visible fijo, garantizando seguridad ante secuencias ANSI y
 * truncamiento defensivo para evitar desbordes en el layout del terminal.
 */
export function justifyRow(left: string, right: string, width: number): string {
  if (width <= 0) return "";

  const vLeft = visibleWidth(left);
  const vRight = visibleWidth(right);
  const total = vLeft + vRight;

  if (total <= width) {
    const spaces = width - total;
    return `${left}${" ".repeat(spaces)}${right}`;
  }

  // Si desborda el ancho asignado, priorizar el contenido derecho (acciones/indicadores)
  // truncando el izquierdo con seguridad ANSI.
  if (vRight >= width) {
    return truncateToWidth(right, width, "");
  }

  const spaceLeft = width - vRight;
  if (spaceLeft > 1) {
    const truncatedLeft = truncateToWidth(left, spaceLeft - 1, "");
    const currentLeftWidth = visibleWidth(truncatedLeft);
    const pad = Math.max(1, width - currentLeftWidth - vRight);
    return `${truncatedLeft}${" ".repeat(pad)}${right}`;
  }

  const truncatedLeft = truncateToWidth(left, spaceLeft, "");
  return `${truncatedLeft}${right}`;
}
