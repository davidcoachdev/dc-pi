import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { getToolIcon } from "../src/features/dc-tool-box/dc-tool-box-icons.ts";
import {
  getToolBoxIndent,
  installToolBoxPatch,
  isToolBoxEnabled,
  setToolBoxEnabled,
  setToolBoxIndent,
} from "../src/features/dc-tool-box/dc-tool-box-patch.ts";
import dcToolBoxExtension from "../src/features/dc-tool-box/dc-tool-box.ts";

test("getToolIcon returns specific emoji or default fallback", () => {
  assert.equal(getToolIcon("write"), "✍");
  assert.equal(getToolIcon("bash"), "📟");
  assert.equal(getToolIcon("grep"), "🔍");
  assert.equal(getToolIcon("mem_save"), "🧠");
  assert.equal(getToolIcon("unknown_tool"), "🛠");
  assert.equal(getToolIcon(undefined), "🛠");
});

test("tool-box config manages enabled state and indent bounds", () => {
  setToolBoxEnabled(true);
  assert.equal(isToolBoxEnabled(), true);

  setToolBoxEnabled(false);
  assert.equal(isToolBoxEnabled(), false);

  setToolBoxIndent(4);
  assert.equal(getToolBoxIndent(), 4);

  // Clamping
  setToolBoxIndent(20);
  assert.equal(getToolBoxIndent(), 8);

  setToolBoxIndent(-5);
  assert.equal(getToolBoxIndent(), 0);

  // Restore defaults
  setToolBoxEnabled(true);
  setToolBoxIndent(2);
});

test("installToolBoxPatch wraps ToolExecutionComponent.prototype.render", () => {
  const installed = installToolBoxPatch();
  assert.equal(installed, true);

  // Create a mock instance of ToolExecutionComponent
  const mockInstance: any = Object.create(ToolExecutionComponent.prototype);
  mockInstance.toolName = "bash";
  mockInstance.expanded = false;
  mockInstance.result = { isError: false };
  mockInstance.children = [];
  mockInstance[Symbol.for("dc.tool-execution.orig-render")] = () => [
    "Running bash command...",
    "echo 'hello'",
  ];

  const lines = mockInstance.render(60);
  assert.ok(lines.length >= 3);
  // Header with rounded corner ╭─ and icon
  assert.ok(lines.some((l: string) => l.includes("╭─") && l.includes("bash")));
  // Footer with rounded corner ╰─ and copy button 📋
  assert.ok(lines.some((l: string) => l.includes("╰") && l.includes("📋")));
});

test("installToolBoxPatch strips nested quiet-tools card frames avoiding double lines", () => {
  const installed = installToolBoxPatch();
  assert.equal(installed, true);

  const mockInstance: any = Object.create(ToolExecutionComponent.prototype);
  mockInstance.toolName = "bash";
  mockInstance.expanded = false;
  mockInstance.result = { isError: false };
  mockInstance.children = [];
  mockInstance[Symbol.for("dc.tool-execution.orig-render")] = () => [
    "",
    "╭─ ✿ $ git branch --show-current ──────────────────────────────────────────╮",
    "│ master                                                                   │",
    "│                                                                          │",
    "╰──────────────────────────────────────────────────────────────────────────╯",
  ];

  const lines = mockInstance.render(70);
  assert.ok(lines.length >= 3);
  // Contains outer DC top border and outer DC bottom border
  assert.ok(lines.some((l: string) => l.includes("╭─") && l.includes("bash")));
  assert.ok(lines.some((l: string) => l.includes("╰") && l.includes("📋")));

  // Must NOT contain the nested bottom border (the inner ╰───────╯ from quiet-tools)
  const bottomBorderCount = lines.filter((l: string) => l.includes("╰") || l.includes("└")).length;
  assert.equal(bottomBorderCount, 1, "Expected exactly 1 bottom border, but found multiple");
});

test("dcToolBoxExtension registers only single command /dc-tool-box", async () => {
  const commands = new Map<string, { description?: string; handler: Function }>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
  } as unknown as ExtensionAPI;

  dcToolBoxExtension(mockPi);

  assert.equal(commands.size, 1);
  assert.ok(commands.has("dc-tool-box"));

  let notifiedMsg = "";
  const mockCtx = {
    hasUI: true,
    ui: {
      notify(msg: string) {
        notifiedMsg = msg;
      },
    },
  } as unknown as ExtensionContext;

  const handler = commands.get("dc-tool-box")!.handler;

  // 1. Off
  await handler("off", mockCtx);
  assert.equal(isToolBoxEnabled(), false);
  assert.ok(notifiedMsg.includes("disabled"));

  // 2. On
  await handler("on", mockCtx);
  assert.equal(isToolBoxEnabled(), true);
  assert.ok(notifiedMsg.includes("enabled"));

  // 3. Indent
  await handler("indent 3", mockCtx);
  assert.equal(getToolBoxIndent(), 3);
  assert.ok(notifiedMsg.includes("indent set to 3"));

  // Reset to default
  setToolBoxIndent(2);
});

test("installToolBoxPatch wraps updateResult and normalizes missing or nested content", () => {
  const installed = installToolBoxPatch();
  assert.equal(installed, true);

  const mockInstance: any = Object.create(ToolExecutionComponent.prototype);
  mockInstance.updateDisplay = () => {};
  mockInstance.maybeConvertImagesForKitty = () => {};

  // 1. Caso crítico: result sin content (ej: de NestedToolOutcome no desenvuelto)
  const nestedOutcome = {
    toolCall: { id: "call-1", name: "subagent_run" },
    result: {
      content: [{ type: "text", text: "Done successfully" }],
      details: { foo: "bar" },
    },
    isError: false,
  };
  mockInstance.updateResult(nestedOutcome, false);
  assert.ok(mockInstance.result);
  assert.ok(Array.isArray(mockInstance.result.content));
  assert.equal(mockInstance.result.content[0].text, "Done successfully");
  assert.deepEqual(mockInstance.result.details, { foo: "bar" });

  // 2. Caso con content undefined y sin result anidado
  const bareResult = { isError: false };
  mockInstance.updateResult(bareResult, false);
  assert.ok(Array.isArray(mockInstance.result.content));
  assert.equal(mockInstance.result.content.length, 1);
  assert.equal(mockInstance.result.content[0].type, "text");

  // 3. Caso con content como string
  const stringContentResult = { content: "direct text message" };
  mockInstance.updateResult(stringContentResult, false);
  assert.ok(Array.isArray(mockInstance.result.content));
  assert.equal(mockInstance.result.content[0].text, "direct text message");
});

test("installToolBoxPatch: compact collapsed preview rendering and mouse toggle on top bar", () => {
  installToolBoxPatch();

  const mockInstance: any = Object.create(ToolExecutionComponent.prototype);
  mockInstance.toolName = "read";
  mockInstance.args = { path: "src/index.ts" };
  mockInstance.expanded = false;
  mockInstance.result = { isError: false };
  mockInstance.children = [];
  mockInstance.ui = { requestRender() {} };
  mockInstance.setExpanded = function (val: boolean) {
    this.expanded = val;
  };
  mockInstance[Symbol.for("dc.tool-execution.orig-render")] = () => [
    "line 1 of content",
    "line 2 of content",
    "line 3 of content",
    "line 4 of content",
    "line 5 of content",
  ];

  // 1. Cuando está colapsado (expanded: false): muestra 3 líneas de preview + línea de 'más líneas'
  const collapsedLines = mockInstance.render(70);
  assert.ok(collapsedLines.length >= 5, "Collapsed should render top, 3 preview lines, hint, and bottom");
  assert.ok(collapsedLines[1].includes("▼"), "Top row must contain ▼ expand icon");
  assert.ok(collapsedLines[1].includes("read"), "Top row must display tool name");
  assert.ok(collapsedLines[1].includes("src/index.ts"), "Top row must display file path");
  assert.ok(collapsedLines.some((l: string) => l.includes("line 1 of content")));
  assert.ok(collapsedLines.some((l: string) => l.includes("line 3 of content")));
  assert.ok(collapsedLines.some((l: string) => l.includes("líneas más")), "Should include preview hint");
  assert.ok(collapsedLines[collapsedLines.length - 1].includes("📋"), "Bottom row must contain 📋 copy icon");

  // 2. Clic en la barra superior (y: 1) debe alternar expanded a true
  const mouseRes = mockInstance.handleMouse({
    type: "click",
    button: "left",
    x: 10,
    y: 1,
    width: 70,
  });
  assert.equal(mouseRes?.handled, true, "Top row click should be handled");
  assert.equal(mockInstance.expanded, true, "Click on top bar should expand tool box");

  // 3. Cuando está expandido (expanded: true): renderiza todas las líneas completas
  const expandedLines = mockInstance.render(70);
  assert.ok(expandedLines.length > 5, "Expanded should render all body lines between borders");
  assert.ok(expandedLines[1].includes("▲"), "Top row must contain ▲ collapse icon");
  assert.ok(expandedLines.some((l: string) => l.includes("line 5 of content")));
  assert.ok(expandedLines[expandedLines.length - 1].includes("📋"), "Bottom row must contain 📋");

  // 4. Clic de nuevo en la barra superior debe colapsarlo a false
  mockInstance.handleMouse({
    type: "click",
    button: "left",
    x: 10,
    y: 1,
    width: 70,
  });
  assert.equal(mockInstance.expanded, false, "Second click should collapse tool box back");
});

