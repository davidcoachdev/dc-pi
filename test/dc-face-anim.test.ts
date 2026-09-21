import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext, WorkingIndicatorOptions } from "@earendil-works/pi-coding-agent";
import { AgentVisualStateStore } from "../src/core/dc-agent-state/dc-agent-state.ts";
import {
  getFaceFrame,
  getFaceFrames,
} from "../src/features/dc-face-anim/dc-face-anim-frames.ts";
import { DcFaceAnimator } from "../src/features/dc-face-anim/dc-face-animator.ts";
import dcFaceAnimExtension from "../src/features/dc-face-anim/dc-face-anim.ts";

test("getFaceFrames and getFaceFrame return valid kaomojis", () => {
  const idleFrames = getFaceFrames("idle");
  assert.ok(idleFrames.length > 0);
  assert.ok(idleFrames[0]!.includes("≧(❂‿❂)≦"));

  const thinkingFrames = getFaceFrames("thinking");
  assert.equal(thinkingFrames.length, 4);
  assert.ok(thinkingFrames[0]!.includes("≖.≖"));

  // Circular indexing
  assert.equal(getFaceFrame("thinking", 0), thinkingFrames[0]);
  assert.equal(getFaceFrame("thinking", 4), thinkingFrames[0]);
  assert.equal(getFaceFrame("thinking", 5), thinkingFrames[1]);

  // Fallback on unknown
  assert.deepEqual(getFaceFrames("unknown" as any), idleFrames);
});

test("DcFaceAnimator updates working indicator on state transitions", () => {
  const store = new AgentVisualStateStore({ idleTimeoutMs: 0 });
  const animator = new DcFaceAnimator(store, { intervalMs: 200 });

  let appliedOptions: WorkingIndicatorOptions | undefined;
  let restoreCalls = 0;

  const mockCtx = {
    hasUI: true,
    ui: {
      setWorkingIndicator(options?: WorkingIndicatorOptions) {
        if (options) {
          appliedOptions = options;
        } else {
          restoreCalls++;
          appliedOptions = undefined;
        }
      },
    },
  } as unknown as ExtensionContext;

  animator.attachUI(mockCtx);
  assert.ok(appliedOptions !== undefined);
  assert.equal(appliedOptions!.intervalMs, 200);

  // Transition state to thinking
  store.setState("thinking");
  assert.ok(appliedOptions !== undefined);
  assert.ok(appliedOptions!.frames?.[0]?.includes("≖.≖"));

  // Disable animator -> restores default
  animator.setEnabled(false);
  assert.equal(restoreCalls, 1);
  assert.equal(appliedOptions, undefined);

  // Re-enable
  animator.setEnabled(true);
  assert.ok(appliedOptions !== undefined);

  // Dispose
  animator.dispose();
  assert.equal(restoreCalls, 2);
});

test("dcFaceAnimExtension registers only /dc-face command and session events", async () => {
  const commands = new Map<string, { description?: string; handler: Function }>();
  const events = new Map<string, Function>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    on(event: string, handler: Function) {
      events.set(event, handler);
    },
  } as unknown as ExtensionAPI;

  dcFaceAnimExtension(mockPi);

  assert.equal(commands.size, 1);
  assert.ok(commands.has("dc-face"));
  assert.ok(events.has("session_start"));
  assert.ok(events.has("session_shutdown"));

  let notifiedMsg = "";
  let appliedOptions: WorkingIndicatorOptions | undefined;

  const mockCtx = {
    hasUI: true,
    ui: {
      notify(msg: string) {
        notifiedMsg = msg;
      },
      setWorkingIndicator(options?: WorkingIndicatorOptions) {
        appliedOptions = options;
      },
    },
  } as unknown as ExtensionContext;

  // Session start attaches UI
  events.get("session_start")!({}, mockCtx);
  assert.ok(appliedOptions !== undefined);

  // Command handlers
  const handler = commands.get("dc-face")!.handler;

  // 1. Show status
  await handler("", mockCtx);
  assert.ok(notifiedMsg.includes("DC Face"));

  // 2. Disable
  await handler("off", mockCtx);
  assert.ok(notifiedMsg.includes("disabled"));
  assert.equal(appliedOptions, undefined);

  // 3. Enable
  await handler("on", mockCtx);
  assert.ok(notifiedMsg.includes("enabled"));
  assert.ok(appliedOptions !== undefined);
});
