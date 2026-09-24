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
}
