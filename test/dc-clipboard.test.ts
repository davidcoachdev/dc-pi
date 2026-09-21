import test from "node:test";
import assert from "node:assert/strict";
import { DcClipboard, formatOsc52 } from "../src/integrations/dc-clipboard/dc-clipboard.ts";

test("formatOsc52 correctly encodes text to Base64 escape sequence", () => {
  const seq = formatOsc52("hello world");
  assert.equal(seq, "\x1b]52;c;aGVsbG8gd29ybGQ=\x07");
});

test("DcClipboard detects backend based on platform and environment", () => {
  const origWayland = process.env.WAYLAND_DISPLAY;
  const origDisplay = process.env.DISPLAY;

  try {
    delete process.env.WAYLAND_DISPLAY;
    delete process.env.DISPLAY;

    const cbFallback = new DcClipboard();
    const b1 = cbFallback.detectBackend();
    // On Linux without Wayland or Display -> osc52
    assert.ok(b1 === "osc52" || b1 === "pbcopy" || b1 === "clip");

    process.env.WAYLAND_DISPLAY = "wayland-0";
    const cbWayland = new DcClipboard();
    if (process.platform === "linux") {
      assert.equal(cbWayland.detectBackend(), "wl-copy");
    }

    delete process.env.WAYLAND_DISPLAY;
    process.env.DISPLAY = ":0";
    const cbX11 = new DcClipboard();
    if (process.platform === "linux") {
      assert.equal(cbX11.detectBackend(), "xsel");
    }
  } finally {
    if (origWayland !== undefined) process.env.WAYLAND_DISPLAY = origWayland;
    else delete process.env.WAYLAND_DISPLAY;
    if (origDisplay !== undefined) process.env.DISPLAY = origDisplay;
    else delete process.env.DISPLAY;
  }
});

test("DcClipboard respects preferredBackend and handles none", async () => {
  const cbNone = new DcClipboard({ preferredBackend: "none" });
  assert.equal(cbNone.detectBackend(), "none");
  const result = await cbNone.copy("test");
  assert.equal(result, false);
});
