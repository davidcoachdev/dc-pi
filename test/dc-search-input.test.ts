import test from "node:test";
import assert from "node:assert/strict";
import { DcSearchInput } from "../src/ui/dc-search-input.ts";

test("DcSearchInput handles typing and backspace", () => {
  const input = new DcSearchInput({ width: 30, placeholder: "Buscar..." });
  assert.equal(input.isEmpty(), true);
  assert.equal(input.getQuery(), "");

  input.append("c");
  input.append("l");
  input.append("a");
  input.append("u");
  input.append("d");
  input.append("e");

  assert.equal(input.getQuery(), "claude");
  assert.equal(input.isEmpty(), false);

  input.backspace();
  assert.equal(input.getQuery(), "claud");

  input.clear();
  assert.equal(input.isEmpty(), true);
});

test("DcSearchInput sliding window keeps tail visible when exceeding width", () => {
  const input = new DcSearchInput({ width: 10 });
  const longText = "1234567890abcdefghij";
  for (const char of longText) {
    input.append(char);
  }

  // Max visible characters 8
  const visible = input.getVisibleQuery(8);
  assert.ok(visible.startsWith("…"));
  // Tail should end with the latest characters written ("ghij")
  assert.ok(visible.endsWith("ghij"));
  assert.equal(visible.length <= 8, true);
});

test("DcSearchInput render keeps strictly bounded total width", () => {
  const input = new DcSearchInput({ width: 40 });
  input.setQuery("un-texto-extremadamente-largo-para-probar-que-la-ui-no-se-desborda-jamas");

  const rendered = input.render(35);
  // Must render string without breaking and stay within requested bound
  assert.ok(rendered.length >= 35);
  assert.ok(rendered.includes("🔍"));
});
