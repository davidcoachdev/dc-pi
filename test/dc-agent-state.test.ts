import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentVisualStateStore, type AgentState } from "../src/core/dc-agent-state/dc-agent-state.ts";

test("AgentVisualStateStore transitions state and notifies subscribers", () => {
  const store = new AgentVisualStateStore();
  const transitions: Array<{ next: AgentState; prev: AgentState }> = [];

  const unsubscribe = store.subscribe((next, prev) => {
    transitions.push({ next, prev });
  });

  assert.equal(store.getState(), "idle");

  store.setState("thinking");
  assert.equal(store.getState(), "thinking");

  store.setState("working");
  assert.equal(store.getState(), "working");

  // Redundant setState does not notify
  store.setState("working");
  assert.equal(transitions.length, 2);

  unsubscribe();
  store.setState("idle");
  assert.equal(transitions.length, 2);
  store.dispose();
});

test("AgentVisualStateStore transitions to dormant after idle timeout", async () => {
  const store = new AgentVisualStateStore({ idleTimeoutMs: 20 });
  assert.equal(store.getState(), "idle");

  store.setState("idle");
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.equal(store.getState(), "dormant");
  store.dispose();
});

test("AgentVisualStateStore binds to ExtensionAPI lifecycle events", async () => {
  const handlers = new Map<string, Function>();
  const mockPi = {
    on(event: string, fn: Function) {
      handlers.set(event, fn);
    },
  } as unknown as ExtensionAPI;

  const store = new AgentVisualStateStore({ errorFlashMs: 30 });
  const unbind = store.bind(mockPi);

  assert.equal(store.getState(), "idle");

  // agent_start -> thinking
  handlers.get("agent_start")?.();
  assert.equal(store.getState(), "thinking");
  assert.equal(store.isBusy(), true);

  // message_update -> writing
  handlers.get("message_update")?.();
  assert.equal(store.getState(), "writing");

  // tool_execution_start -> working
  handlers.get("tool_execution_start")?.();
  assert.equal(store.getState(), "working");
  assert.equal(store.getToolsRunning(), 1);

  // tool_execution_end with error -> retying flash, then restores
  handlers.get("tool_execution_end")?.({ isError: true });
  assert.equal(store.getState(), "retying");
  assert.equal(store.getToolsRunning(), 0);

  // Wait for error flash timer
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(store.getState(), "thinking"); // since busy is still true

  // agent_settled -> idle
  handlers.get("agent_settled")?.();
  assert.equal(store.getState(), "idle");
  assert.equal(store.isBusy(), false);

  unbind();
});
