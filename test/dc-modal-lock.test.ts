import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openDcModal, isDcModalActive } from "../src/ui/dc-modal.ts";

test("openDcModal single-modal lock prevents stacking and concurrent window collapse", async () => {
  let finishFirstModal: (() => void) | undefined;

  const mockCtx = {
    hasUI: true,
    mode: "tui",
    ui: {
      custom: async () => {
        return new Promise<void>((resolve) => {
          finishFirstModal = resolve;
          // Dejar el modal abierto simulando interacción del usuario
        });
      },
    },
  } as unknown as ExtensionContext;

  assert.equal(isDcModalActive(), false);

  const dummyContent = {
    render: () => ["Content"],
    invalidate: () => {},
  };

  // 1. Abrir primera ventana
  const firstPromise = openDcModal(mockCtx, {
    title: "Modal 1",
    content: dummyContent,
  });

  // La ventana 1 debe estar activa
  assert.equal(isDcModalActive(), true);

  // 2. Intentar abrir una segunda ventana mientras la primera está abierta (ej: usuario presionó atajo de nuevo)
  const secondResult = await openDcModal(mockCtx, {
    title: "Modal 2 (Duplicado)",
    content: dummyContent,
  });

  // La segunda llamada debe descartarse inmediatamente sin colapsar la terminal
  assert.equal(secondResult, undefined);
  assert.equal(isDcModalActive(), true);

  // 3. Cerrar la primera ventana
  finishFirstModal?.();
  await firstPromise;

  // El cerrojo debe liberarse completamente
  assert.equal(isDcModalActive(), false);
});
