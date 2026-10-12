import test from "node:test";
import assert from "node:assert/strict";
import { DcText } from "../src/ui/dc-text.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

test("DcText: renders horizontal separator ─", () => {
  const comp = new DcText("─");
  const lines = comp.render(10);
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.includes("──────────"));
});

test("DcText: pads standard text to exact visible width", () => {
  const comp = new DcText("Hola");
  const lines = comp.render(10);
  assert.equal(lines.length, 1);
  assert.equal(visibleWidth(lines[0]!), 10);
  assert.equal(lines[0], "Hola      ");
});

test("DcText: accurately measures wide glyphs (⛩, ☠️) and pads to exact visible width", () => {
  const comp = new DcText("⛩ Torii");
  const lines = comp.render(12);
  assert.equal(lines.length, 1);
  assert.equal(visibleWidth(lines[0]!), 12);
});
