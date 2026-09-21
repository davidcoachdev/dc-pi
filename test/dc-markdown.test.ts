import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import {
  blendWithBackground,
  getHeadingPrefix,
  getLangIcon,
  prettifyErrorContent,
} from "../src/features/dc-markdown/dc-markdown-tokens.ts";
import {
  installMarkdownPatch,
  isCodeBoxEnabled,
  setCodeBoxEnabled,
} from "../src/features/dc-markdown/dc-markdown-patch.ts";
import dcMarkdownExtension from "../src/features/dc-markdown/dc-markdown.ts";

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
  // Footer with rounded corner ╰─
  assert.ok(lines.some((l: string) => l.includes("╰")));
  // Content with indent
  assert.ok(lines.some((l: string) => l.includes("const x = 1;")));
});

test("dcMarkdownExtension registers only single command /dc-markdown", async () => {
  const commands = new Map<string, { description?: string; handler: Function }>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
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
  assert.ok(notifiedMsg.includes("disabled"));

  // 2. On
  await handler("on", mockCtx);
  assert.equal(isCodeBoxEnabled(), true);
  assert.ok(notifiedMsg.includes("enabled"));
});
