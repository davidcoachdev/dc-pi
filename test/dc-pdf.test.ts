import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import dcPdfExtension from "../src/features/dc-pdf/dc-pdf.ts";

test("dcPdfExtension registers dc_pdf_extract tool and /dc-pdf command", () => {
  const registeredTools: string[] = [];
  const registeredCommands: string[] = [];

  const mockPi = {
    registerTool(tool: { name: string }) {
      registeredTools.push(tool.name);
    },
    registerCommand(name: string) {
      registeredCommands.push(name);
    },
  } as unknown as ExtensionAPI;

  dcPdfExtension(mockPi);

  assert.ok(registeredTools.includes("dc_pdf_extract"));
  assert.ok(registeredCommands.includes("dc-pdf"));
});
