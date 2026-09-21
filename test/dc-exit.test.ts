import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import dcExitExtension, {
  CLEAR_SCREEN,
  isSessionChangeReason,
} from "../src/features/dc-exit/dc-exit.ts";

test("isSessionChangeReason correctly identifies session switches vs real quit", () => {
  assert.equal(isSessionChangeReason("reload"), true);
  assert.equal(isSessionChangeReason("new"), true);
  assert.equal(isSessionChangeReason("new-session"), true);
  assert.equal(isSessionChangeReason("resume"), true);
  assert.equal(isSessionChangeReason("fork"), true);

  assert.equal(isSessionChangeReason("quit"), false);
  assert.equal(isSessionChangeReason(undefined), false);
  assert.equal(isSessionChangeReason("other"), false);
});

test("dcExitExtension ignores session reload/fork without arming exit hook", () => {
  const listeners = new Map<string, Function>();
  let armedExit = false;

  const mockPi = {
    on(event: string, fn: Function) {
      listeners.set(event, fn);
    },
  } as unknown as ExtensionAPI;

  dcExitExtension(mockPi, {
    onExitFn: () => {
      armedExit = true;
    },
    writeFn: () => {},
  });

  assert.ok(listeners.has("session_shutdown"));

  const shutdownHandler = listeners.get("session_shutdown")!;

  // Trigger with reload -> should NOT arm
  shutdownHandler({ reason: "reload" });
  assert.equal(armedExit, false);

  // Trigger with fork -> should NOT arm
  shutdownHandler({ reason: "fork" });
  assert.equal(armedExit, false);
});

test("dcExitExtension arms on real quit and writes CLEAR_SCREEN on exit", () => {
  const listeners = new Map<string, Function>();
  let exitCallback: (() => void) | undefined;
  let writtenData = "";

  const mockPi = {
    on(event: string, fn: Function) {
      listeners.set(event, fn);
    },
  } as unknown as ExtensionAPI;

  dcExitExtension(mockPi, {
    onExitFn: (fn) => {
      exitCallback = fn;
    },
    writeFn: (data) => {
      writtenData += data;
    },
  });

  const shutdownHandler = listeners.get("session_shutdown")!;

  // Trigger with quit
  shutdownHandler({ reason: "quit" });
  assert.ok(exitCallback !== undefined);

  // Trigger second time -> idempotency check (only arms once)
  let secondArmed = false;
  shutdownHandler({ reason: "quit" });
  assert.equal(secondArmed, false);

  // Fire the process exit callback
  exitCallback!();
  assert.equal(writtenData, CLEAR_SCREEN);
});
