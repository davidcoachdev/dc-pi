/**
 * Almacén en memoria para bloques de código capturados durante renderToken.
 * Permite que el manejador de mouse de AssistantMessageComponent copie el
 * código limpio original sin depender de regex sobre texto ya formateado.
 */

export interface StoredCodeBlock {
  code: string;
  lang: string;
}

let nextCodeId = 1;
const codeStore = new Map<number, StoredCodeBlock>();
export const codeBlockCollapseState = new Map<number, boolean>();
export const renderedBlockQueue: number[] = [];

export function queueRenderedBlock(id: number): void {
  renderedBlockQueue.push(id);
}

export function takeRenderedBlock(): number | undefined {
  return renderedBlockQueue.shift();
}

export function clearRenderedBlockQueue(): void {
  renderedBlockQueue.length = 0;
}

export function storeCodeBlock(code: string, lang: string): number {
  const codeId = nextCodeId++;
  codeStore.set(codeId, { code, lang });
  if (codeStore.size > 250) {
    const firstKey = codeStore.keys().next().value;
    if (firstKey !== undefined) codeStore.delete(firstKey);
  }
  return codeId;
}

export function getStoredCodeBlock(id: number): StoredCodeBlock | undefined {
  return codeStore.get(id);
}

export function clearCodeStore(): void {
  codeStore.clear();
  codeBlockCollapseState.clear();
  renderedBlockQueue.length = 0;
}
