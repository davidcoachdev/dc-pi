import test from "node:test";
import assert from "node:assert/strict";
import { Text } from "@earendil-works/pi-tui";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import {
  patchTextNotificationFilter,
  patchPiClearCommand,
  notifyNewSession,
} from "../src/integrations/dc-notify/dc-text-patch.ts";

test("patchTextNotificationFilter intercepts and suppresses Text with New session started", () => {
  patchTextNotificationFilter();

  const text = new Text("\x1b[38;2;255;0;0m✓ New session started\x1b[0m", 1, 1);
  const lines = text.render(80);

  // Debería retornar array vacío para no pintar en pantalla
  assert.deepEqual(lines, []);
});

test("patchPiClearCommand intercepts handleClearCommand and avoids adding Text to chatContainer", async () => {
  patchPiClearCommand();

  const addedChildren: any[] = [];
  const mockInteractiveMode = {
    clearStatusIndicator() {},
    runtimeHost: {
      newSession: async () => ({ cancelled: false }),
    },
    chatContainer: {
      addChild(child: any) {
        addedChildren.push(child);
      },
    },
    ui: {
      requestRender() {},
    },
  };

  const proto = (InteractiveMode as any).prototype;
  await proto.handleClearCommand.call(mockInteractiveMode);

  // No debe haber agregado ningún hijo a chatContainer (el Text '✓ New session started' fue suprimido)
  assert.equal(addedChildren.length, 0);
});
