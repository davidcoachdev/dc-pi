import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import dcNoTelemetryExtension from "../src/integrations/dc-no-telemetry/dc-no-telemetry.ts";

test("dcNoTelemetryExtension registers session_start hook", () => {
  let sessionStartRegistered = false;
  const mockPi = {
    on(event: string, _fn: Function) {
      if (event === "session_start") sessionStartRegistered = true;
    },
  } as unknown as ExtensionAPI;

  dcNoTelemetryExtension(mockPi);
  assert.equal(sessionStartRegistered, true);
});
