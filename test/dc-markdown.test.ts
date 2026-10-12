import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import {
  blendWithBackground,
  getHeadingPrefix,
  getLangIcon,
  prettifyErrorContent,
  installMarkdownPatch,
  isCodeBoxEnabled,
  setCodeBoxEnabled,
  renderCodeBlockBox,
  storeCodeBlock,
  getStoredCodeBlock,
  createAgentResultRenderer,
  installErrorBoxPatch,
  dcMarkdownExtension,
} from "../src/features/dc-markdown/index.ts";

test("getHeadingPrefix and getLangIcon return appropriate symbols", () => {
  assert.equal(getHeadingPrefix(1), "");
  assert.equal(getHeadingPrefix(2), "");
  assert.equal(getHeadingPrefix(3), "◆ ");
  assert.equal(getHeadingPrefix(4), "▸ ");
  assert.equal(getHeadingPrefix(5), "▪ ");

  assert.equal(getLangIcon("ts"), "");
  assert.equal(getLangIcon("typescript"), "");
  assert.equal(getLangIcon("py"), "");
  assert.equal(getLangIcon("rust"), "");
  assert.equal(getLangIcon("bash"), "📟");
  assert.equal(getLangIcon("unknown"), "");
});

test("blendWithBackground computes darker background with base panel color", () => {
  const original = "\x1b[48;2;100;50;50m";
  const blended = blendWithBackground(original, 0.5);
  assert.ok(blended.startsWith("\x1b[48;2;"));
  assert.notEqual(blended, original);

  // Invalid ANSI returns original verbatim
  assert.equal(blendWithBackground("invalid"), "invalid");
});

test("prettifyErrorContent formats embedded JSON cleanly", () => {
  const raw = "Error calling provider: {\"error\":{\"code\":503,\"message\":\"Overloaded\"}} at endpoint";
  const pretty = prettifyErrorContent(raw);
  assert.ok(pretty.includes("Overloaded"));
  assert.ok(pretty.includes("  \"code\": 503"));
});

test("renderCodeBlockBox produces clean card with title and copy button without APC leaks", () => {
  const lines = renderCodeBlockBox({
    text: "const a = 123;",
    lang: "ts",
    width: 60,
    indent: "  ",
  });

  assert.ok(lines.length >= 3);
  // Header with rounded corner ╭─, icon and arrow
  assert.ok(lines[0]!.includes("╭─") && lines[0]!.includes("ts") && lines[0]!.includes("▲"));
  // No APC escape leakage in rendered strings to protect terminal layout
  assert.ok(!lines[0]!.includes("\x1b_dc:code:"), "Top row must not leak APC sequence");
  // Code block includes line numbers for code
  assert.ok(lines.some((l: string) => l.includes("1 │")));
  // Bottom border with copy button
  assert.ok(lines[lines.length - 1]!.includes("╰") && lines[lines.length - 1]!.includes("📋"));
  assert.ok(!lines[lines.length - 1]!.includes(":bot\x1b\\"), "Bottom row must not leak APC sequence");
});

test("renderCodeBlockBox for markdown (lang: 'markdown' | 'md') renders formatted headings and bullet points", () => {
  const lines = renderCodeBlockBox({
    text: "# Documento Markdown\n\n- Lista item 1\n- Lista item 2",
    lang: "markdown",
    width: 60,
    indent: "  ",
  });

  assert.ok(lines.length >= 3);
  // Header displays markdown tag
  assert.ok(lines[0]!.includes("markdown"));
  // Must NOT include code gutter numbers (1 │)
  assert.ok(!lines.some((l: string) => l.includes("1 │")), "Markdown blocks must not have line numbers");
  // Must render formatted heading without literal '#' prefix
  assert.ok(!lines.some((l: string) => l.includes("# Documento")), "Must not show literal '#' character");
  assert.ok(lines.some((l: string) => l.includes("Documento Markdown")), "Must show formatted heading text");
  // Must render bullet point '•' instead of raw dash '-'
  assert.ok(lines.some((l: string) => l.includes("•")), "Must render bullet point symbol");
});

test("storeCodeBlock stores and retrieves clean code by id", () => {
  const id = storeCodeBlock("console.log('test');", "js");
  const stored = getStoredCodeBlock(id);
  assert.ok(stored);
  assert.equal(stored!.code, "console.log('test');");
  assert.equal(stored!.lang, "js");
});

test("installMarkdownPatch formats code blocks into rounded boxes", () => {
  installMarkdownPatch();

  // Mock Markdown instance
  const mockMarkdown: any = Object.create(Markdown.prototype);
  mockMarkdown.theme = {
    codeBlockIndent: "  ",
    highlightCode: (text: string) => [text],
  };
  mockMarkdown[Symbol.for("dc.markdown.orig-render-token")] = () => [
    "```typescript",
    "const x = 1;",
    "```",
  ];

  setCodeBoxEnabled(true);
  const token = {
    type: "code",
    lang: "ts",
    text: "const x = 1;",
  };

  const lines = mockMarkdown.renderToken(token, 60);
  assert.ok(lines.length >= 3);
  // Header with rounded corner ╭─ and icon
  assert.ok(lines.some((l: string) => l.includes("╭─") && l.includes("ts")));
  // Footer with rounded corner ╰─ and copy button
  assert.ok(lines.some((l: string) => l.includes("╰") && l.includes("📋")));
  // Content with indent
  assert.ok(lines.some((l: string) => l.includes("const x = 1;")));
});

test("createAgentResultRenderer formats agent messages with header and copy button", () => {
  const renderer = createAgentResultRenderer(false);
  const comp = renderer(
    {
      details: { gentleAgents: { agent: "gentle-ai-worker", status: "completed", taskId: "t1" } },
      content: "Task completed successfully",
    },
    { expanded: false },
    {},
  );

  const lines = comp.render(60);
  assert.ok(lines.length >= 3);
  assert.ok(lines.some((l: string) => l.includes("gentle-ai-worker")));
  assert.ok(lines.some((l: string) => l.includes("Task completed successfully")));
  assert.ok(lines.some((l: string) => l.includes("📋")));
});

test("installErrorBoxPatch executes defensively without throwing", () => {
  const ok = installErrorBoxPatch();
  assert.equal(ok, true);
});

test("dcMarkdownExtension registers only single command /dc-markdown", async () => {
  const commands = new Map<string, { description?: string; handler: Function }>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerMessageRenderer() {},
    on() {},
  } as unknown as ExtensionAPI;

  dcMarkdownExtension(mockPi);

  assert.equal(commands.size, 1);
  assert.ok(commands.has("dc-markdown"));

  let notifiedMsg = "";
  const mockCtx = {
    hasUI: true,
    ui: {
      notify(msg: string) {
        notifiedMsg = msg;
      },
    },
  } as unknown as ExtensionContext;

  const handler = commands.get("dc-markdown")!.handler;

  // 1. Off
  await handler("off", mockCtx);
  assert.equal(isCodeBoxEnabled(), false);
  assert.ok(notifiedMsg.includes("desactivadas"));

  // 2. On
  await handler("on", mockCtx);
  assert.equal(isCodeBoxEnabled(), true);
  assert.ok(notifiedMsg.includes("activadas"));
});
