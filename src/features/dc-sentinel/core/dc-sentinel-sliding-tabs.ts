import { visibleWidth } from "@earendil-works/pi-tui";

export interface SlidingTabItem<T> {
  item: T;
  index: number;
  isActive: boolean;
}

export interface SlidingTabsResult<T> {
  slice: SlidingTabItem<T>[];
  hiddenLeft: number;
  hiddenRight: number;
}

export interface TabHitbox {
  start: number;
  end: number;
  targetIndex: number;
}

/**
 * Computa una ventana deslizante horizontal (sliding window) para pestañas horizontales.
 * Mantiene la pestaña activa siempre visible y expone indicadores (+N ◀ / ▶ +M)
 * cuando la cantidad de elementos excede el ancho disponible en la terminal.
 */
export function computeSlidingTabs<T extends { label: string }>(
  items: T[],
  activeIndex: number,
  maxWidth: number,
): SlidingTabsResult<T> {
  const n = items.length;
  if (n <= 1) {
    return {
      slice: items.map((item, index) => ({ item, index, isActive: true })),
      hiddenLeft: 0,
      hiddenRight: 0,
    };
  }

  const safeActive = Math.max(0, Math.min(n - 1, activeIndex));
  const reserve = 16; // Reserva para "+99 ◀ " y " ▶ +99"
  const availableW = Math.max(16, maxWidth - reserve);

  let start = safeActive;
  let end = safeActive;
  let currentW = visibleWidth(` ${items[safeActive]!.label} `) + 2;

  let expanded = true;
  while (expanded) {
    expanded = false;

    // Expandir hacia la derecha si cabe
    if (end + 1 < n) {
      const nextW = visibleWidth(` ${items[end + 1]!.label} `) + 2;
      if (currentW + nextW <= availableW) {
        end++;
        currentW += nextW;
        expanded = true;
      }
    }

    // Expandir hacia la izquierda si cabe
    if (start - 1 >= 0) {
      const prevW = visibleWidth(` ${items[start - 1]!.label} `) + 2;
      if (currentW + prevW <= availableW) {
        start--;
        currentW += prevW;
        expanded = true;
      }
    }
  }

  const slice: SlidingTabItem<T>[] = [];
  for (let i = start; i <= end; i++) {
    slice.push({
      item: items[i]!,
      index: i,
      isActive: i === safeActive,
    });
  }

  return {
    slice,
    hiddenLeft: start,
    hiddenRight: n - 1 - end,
  };
}
