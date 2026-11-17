import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { replaceSystemPreambles, DEFAULT_PREAMBLE } from "../src/features/dc-preamble/core/dc-preamble-engine.ts";
import dcPreambleExtension from "../src/features/dc-preamble/dc-preamble.ts";

function baseMessages() {
  return [
    {
      role: "system" as const,
      content: "",
      sections: {
        preamble: "You are a coding assistant running inside pi, a coding agent harness. Help users inspect files, run commands, and modify code.",
        rules: "<rules>\n- Be concise\n</rules>",
        cwd: "/tmp/project",
      },
      timestamp: 0,
    },
    { role: "user" as const, content: "hello", timestamp: 1 },
    {
      role: "system" as const,
      content: "opaque",
      timestamp: 2,
    },
  ];
}

test("replaceSystemPreambles swaps sections.preamble and preserves everything else", () => {
  const messages = baseMessages();
  const result = replaceSystemPreambles(messages, "CUSTOM PREAMBLE");
  const system = result[0]!;

  assert.equal(system.sections!.preamble, "CUSTOM PREAMBLE");
  assert.equal(
    system.sections!.rules,
    "<rules>\n- Be concise\n</rules>",
    "other sections must survive untouched",
  );
  assert.equal(system.sections!.cwd, "/tmp/project");
  assert.equal(result[1]!.content, "hello", "user messages untouched");
  assert.equal(result[2]!.content, "opaque", "opaque system messages untouched");
  assert.notEqual(system, messages[0], "original system message must not be mutated");
});

test("replaceSystemPreambles leaves messages without a preamble section alone", () => {
  const messages = [
    { role: "system" as const, content: "", sections: { rules: "<rules>x</rules>" }, timestamp: 0 },
  ];
  const result = replaceSystemPreambles(messages, "CUSTOM PREAMBLE");
  assert.equal("preamble" in result[0]!.sections!, false, "must not create missing preamble sections");
});

function publicHook(env: Record<string, string | undefined> = {}) {
  const handlers = new Map<string, (event: any) => any>();
  const pi = { on: (name: string, fn: (event: any) => any) => handlers.set(name, fn) } as unknown as ExtensionAPI;
  dcPreambleExtension(pi, env);
  return handlers.get("context_with_system")!;
}

test("public hook normalizes only the four approved prose labels in structured system sections", () => {
  const sections = {
    preamble: "old preamble",
    docs: "# Pi documentation\nUse Pi SDK with the Pi runtime and Pi-specific coding-agent harness.",
    rules: "Pi documentation: consult Pi documentation.",
    cwd: "/workspace/Pi documentation",
    extra: { label: "Pi SDK" },
  };
  const messages = [{ role: "system", content: "Pi documentation", sections }];
  const original = structuredClone(messages);
  const result = publicHook({ DC_PREAMBLE: "Pi SDK override" })({ messages });

  assert.equal(result.messages[0].sections.docs, "# Documentation\nUse SDK with the runtime and coding-agent harness.");
  assert.equal(result.messages[0].sections.rules, "Documentation: consult Documentation.");
  assert.equal(result.messages[0].sections.preamble, "Pi SDK override", "explicit override stays verbatim");
  assert.equal(result.messages[0].sections.cwd, sections.cwd);
  assert.equal(result.messages[0].sections.extra, sections.extra);
  assert.equal(result.messages[0].content, "Pi documentation");
  assert.deepEqual(messages, original, "original messages and sections stay unchanged");
});

test("public hook preserves technical identifiers, code, non-system messages and opaque text", () => {
  const technical = [
    "/opt/pi/docs /opt/Pi documentation/readme.md",
    "@earendil-works/pi-coding-agent pi -e ./extension.ts PI_MODEL DC_PREAMBLE",
    "spin pipeline raspberrypi pi documentation Pi SDKHelper Pi runtime_config",
    "`Pi documentation` and `Pi SDK`",
    "```text\nPi runtime\nPi-specific coding-agent harness\n```",
  ].join("\n");
  const messages = [
    { role: "system", sections: { docs: technical, cwd: "Pi SDK" } },
    { role: "system", content: "Pi documentation Pi SDK" },
    { role: "user", content: "Pi documentation", sections: { docs: "Pi SDK" } },
    { role: "toolResult", content: "Pi runtime", sections: { docs: "Pi documentation" } },
  ];
  const original = structuredClone(messages);
  const result = publicHook()({ messages });
  assert.deepEqual(result.messages, original);
  assert.deepEqual(messages, original);
});

test("public hook preserves indented Markdown code while normalizing surrounding prose", () => {
  const docs = "Pi documentation\n\n    Pi SDK\n     Pi runtime\n\tPi-specific coding-agent harness\n\n   Pi SDK\nPi runtime\n";
  const messages = [{ role: "system", sections: { docs } }];
  const result = publicHook()({ messages });
  assert.equal(
    result.messages[0].sections.docs,
    "Documentation\n\n    Pi SDK\n     Pi runtime\n\tPi-specific coding-agent harness\n\n   SDK\nruntime\n",
  );
  assert.equal(messages[0].sections.docs, docs, "original indented code stays unchanged");
});

test("public hook handles labels without a preamble and is idempotent", () => {
  const handler = publicHook();
  const messages = [{ role: "system", sections: { docs: "Pi documentation" } }];
  const first = handler({ messages });
  assert.deepEqual(first.messages, [{ role: "system", sections: { docs: "Documentation" } }]);
  assert.deepEqual(handler(first), first);
  assert.deepEqual(messages[0].sections, { docs: "Pi documentation" });
});

test("DEFAULT_PREAMBLE matches the audited third-party replacement", () => {
  assert.equal(
    DEFAULT_PREAMBLE,
    "You are a coding assistant. Help users inspect files, run commands, and modify code.",
  );
});

test("extension wires context_with_system and honors DC_PREAMBLE override", () => {
  const handlers = new Map<string, (event: any) => any>();
  const pi = { on: (name: string, fn: (event: any) => any) => handlers.set(name, fn) } as unknown as ExtensionAPI;

  dcPreambleExtension(pi);
  const handler = handlers.get("context_with_system");
  assert.ok(handler, "must register a context_with_system handler");

  const messages = baseMessages();
  const result = handler({ type: "context_with_system", messages });
  assert.equal(result.messages[0]!.sections!.preamble, DEFAULT_PREAMBLE);

  const override = { DC_PREAMBLE: "ENV OVERRIDE" };
  const handlers2 = new Map<string, (event: any) => any>();
  const pi2 = { on: (name: string, fn: (event: any) => any) => handlers2.set(name, fn) } as unknown as ExtensionAPI;
  dcPreambleExtension(pi2, override);
  const result2 = handlers2.get("context_with_system")!({ type: "context_with_system", messages });
  assert.equal(result2.messages[0]!.sections!.preamble, "ENV OVERRIDE");
});
