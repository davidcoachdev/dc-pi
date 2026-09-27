import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { markdownToSpokenText } from "../src/features/dc-audio/core/dc-audio-cleaner.ts";
import { isAudioTtsAvailable, synthesizeAudio } from "../src/features/dc-audio/core/dc-audio-synthesizer.ts";
import dcAudioExtension from "../src/features/dc-audio/dc-audio.ts";

test("dc-audio: markdownToSpokenText cleans markdown formatting for speech", () => {
  const md = `---
title: Test Frontmatter
---
# Novedades de la Semana

Este es un **resumen** muy importante sobre [TypeScript](https://typescriptlang.org).

\`\`\`ts
const code = "debe eliminarse";
\`\`\`

| Columna | Valor |
| --- | --- |
| A | B |

- Punto uno
- Punto dos

> Cita importante
`;

  const spoken = markdownToSpokenText(md);

  assert.ok(!spoken.includes("title: Test Frontmatter"));
  assert.ok(!spoken.includes("const code"));
  assert.ok(!spoken.includes("| Columna |"));
  assert.ok(!spoken.includes("https://typescriptlang.org"));
  assert.ok(!spoken.includes("**"));
  assert.ok(!spoken.includes("#"));
  assert.ok(spoken.includes("Novedades de la Semana"));
  assert.ok(spoken.includes("Este es un resumen muy importante sobre TypeScript"));
  assert.ok(spoken.includes("Punto uno Punto dos"));
});

test("dc-audio: isAudioTtsAvailable detects espeak-ng engine", () => {
  const status = isAudioTtsAvailable();
  assert.equal(status.available, true);
  assert.ok(status.engine === "espeak-ng" || status.engine === "piper");
});

test("dc-audio: synthesizeAudio creates a real wav audio file", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-audio-test-"));
  const wavPath = path.join(tmpDir, "test.wav");

  try {
    const res = await synthesizeAudio({
      text: "Hola este es un test de audio de DC Studio",
      outputPath: wavPath,
      language: "es",
      cwd: tmpDir,
    });

    assert.equal(fs.existsSync(wavPath), true);
    assert.equal(res.outputPath, wavPath);
    assert.ok(res.byteSize > 100); // Archivo WAV válido
    assert.ok(res.durationEstimateSeconds >= 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dcAudioExtension registers audio tools and command /dc-audio", () => {
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

  dcAudioExtension(mockPi);

  const expectedTools = ["dc_markdown_to_audio", "dc_text_to_audio"];

  for (const tool of expectedTools) {
    assert.ok(registeredTools.includes(tool), `Tool ${tool} should be registered`);
  }

  assert.ok(registeredCommands.includes("dc-audio"));
});
