import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { markdownToSpokenText } from "../src/features/dc-audio/core/dc-audio-cleaner.ts";
import {
  buildEspeakArgs,
  buildPiperArgs,
  isAudioTtsAvailable,
  synthesizeAudio,
  resetAudioTtsAvailabilityCache,
} from "../src/features/dc-audio/core/dc-audio-synthesizer.ts";
import { registerDcAudioTools } from "../src/features/dc-audio/tools/dc-audio-tools.ts";
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

test("dc-audio: isAudioTtsAvailable detects engine and memoizes result", () => {
  resetAudioTtsAvailabilityCache();

  const startFirst = performance.now();
  const status = isAudioTtsAvailable();
  const durFirst = performance.now() - startFirst;
  assert.equal(status.available, true);
  assert.ok(status.engine === "espeak-ng" || status.engine === "piper");

  // Segunda llamada debe ser instantánea (< 5ms) al usar caché en memoria sin invocar spawnSync
  const startSecond = performance.now();
  const statusSecond = isAudioTtsAvailable();
  const durSecond = performance.now() - startSecond;
  assert.equal(statusSecond.available, true);
  assert.equal(statusSecond.engine, status.engine);
  assert.ok(durSecond < 5, `durSecond (${durSecond}ms) should be near 0ms due to in-memory memoization`);

  // forceRefresh debe forzar re-chequeo
  resetAudioTtsAvailabilityCache();
  const statusThird = isAudioTtsAvailable(true);
  assert.equal(statusThird.available, true);
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

test("dc-audio: buildEspeakArgs guards text with '--' and blocks flag injection", () => {
  const args = buildEspeakArgs({
    language: "es",
    speed: 160,
    outputPath: "/tmp/out.wav",
    text: "-w /tmp/pwned.wav --version",
  });

  const ddIndex = args.indexOf("--");
  assert.ok(ddIndex >= 0, "espeak-ng args must include '--' separator");
  assert.equal(args[ddIndex + 1], "-w /tmp/pwned.wav --version");
  assert.equal(ddIndex, args.length - 2);

  assert.throws(
    () =>
      buildEspeakArgs({
        language: "--version",
        speed: 160,
        outputPath: "/tmp/out.wav",
        text: "hola",
      }),
    /idioma inválido/i,
  );
});

test("dc-audio: synthesizeAudio treats text starting with '-' as speech, not CLI flags", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-audio-flag-test-"));
  const wavPath = path.join(tmpDir, "safe.wav");
  const decoyPath = path.join(tmpDir, "pwned.wav");

  try {
    const res = await synthesizeAudio({
      text: `-w ${decoyPath} --version hola mundo`,
      outputPath: wavPath,
      language: "es",
      cwd: tmpDir,
    });

    assert.equal(fs.existsSync(wavPath), true);
    assert.equal(fs.existsSync(decoyPath), false, "Injected -w flag must never be executed");
    assert.equal(res.outputPath, wavPath);
    assert.ok(res.byteSize > 100);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-audio: synthesizeAudio confines outputPath inside cwd or os.tmpdir() and blocks symlinks", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-audio-confine-"));
  const escapeLink = path.join(tmpDir, "escape-link.wav");
  fs.symlinkSync("/etc/dc-audio-escape-nonexistent.wav", escapeLink);

  try {
    await assert.rejects(
      () =>
        synthesizeAudio({
          text: "hola",
          outputPath: "/etc/dc-audio-evil.wav",
          cwd: tmpDir,
        }),
      /Acceso denegado|fuera de los directorios permitidos/i,
    );

    await assert.rejects(
      () =>
        synthesizeAudio({
          text: "hola",
          outputPath: "../../../../etc/dc-audio-evil.wav",
          cwd: tmpDir,
        }),
      /Acceso denegado|fuera de los directorios permitidos/i,
    );

    await assert.rejects(
      () =>
        synthesizeAudio({
          text: "hola",
          outputPath: "~/dc-audio-evil.wav",
          cwd: tmpDir,
        }),
      /Acceso denegado|fuera de los directorios permitidos/i,
    );

    await assert.rejects(
      () =>
        synthesizeAudio({
          text: "hola",
          outputPath: escapeLink,
          cwd: tmpDir,
        }),
      /Acceso denegado|symlink|fuera de los directorios permitidos/i,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-audio tools: dc_markdown_to_audio and dc_text_to_audio confine input and output paths", async () => {
  const registeredTools: any[] = [];
  const mockPi = {
    registerTool(tool: any) {
      registeredTools.push(tool);
    },
  } as unknown as ExtensionAPI;

  registerDcAudioTools(mockPi);
  const mdTool = registeredTools.find((t) => t.name === "dc_markdown_to_audio");
  const txtTool = registeredTools.find((t) => t.name === "dc_text_to_audio");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-audio-tools-"));
  const validMd = path.join(tmpDir, "brief.md");
  const symlinkMd = path.join(tmpDir, "passwd-link.md");
  fs.writeFileSync(validMd, "# Hola\n\nTexto de prueba.");
  fs.symlinkSync("/etc/passwd", symlinkMd);

  try {
    const ctx = { cwd: tmpDir };

    // Input path fuera de roots (/etc/passwd)
    const resEtc = await mdTool.execute("c1", { path: "/etc/passwd" }, undefined, undefined, ctx);
    assert.equal(resEtc.isError, true);
    assert.match(resEtc.content[0].text, /Acceso denegado|fuera de los directorios permitidos/i);

    // Input path con ~
    const resHome = await mdTool.execute("c2", { path: "~/.ssh/id_rsa" }, undefined, undefined, ctx);
    assert.equal(resHome.isError, true);
    assert.match(resHome.content[0].text, /Acceso denegado|fuera de los directorios permitidos/i);

    // Input path symlink apuntando a /etc/passwd
    const resSym = await mdTool.execute("c3", { path: "passwd-link.md" }, undefined, undefined, ctx);
    assert.equal(resSym.isError, true);
    assert.match(resSym.content[0].text, /Acceso denegado|symlink|fuera de los directorios permitidos/i);

    // Output path traversal en dc_markdown_to_audio
    const resOutMd = await mdTool.execute(
      "c4",
      { path: "brief.md", outputPath: "/etc/out.wav" },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(resOutMd.isError, true);
    assert.match(resOutMd.content[0].text, /Acceso denegado|fuera de los directorios permitidos/i);

    // Output path traversal en dc_text_to_audio
    const resOutTxt = await txtTool.execute(
      "c5",
      { text: "hola mundo", outputPath: "../../../../etc/out.wav" },
      undefined,
      undefined,
      ctx,
    );
    assert.equal(resOutTxt.isError, true);
    assert.match(resOutTxt.content[0].text, /Acceso denegado|fuera de los directorios permitidos/i);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dc-audio: piper synthesis branch pipes text via stdin, validates args and handles errors", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dc-audio-piper-"));
  const modelPath = path.join(tmpDir, "es_ES-test.onnx");
  const outWav = path.join(tmpDir, "piper-out.wav");
  const captureJson = path.join(tmpDir, "captured.json");
  const mockPiperScript = path.join(tmpDir, "mock-piper.mjs");

  fs.writeFileSync(modelPath, "fake-onnx-model");
  fs.writeFileSync(
    mockPiperScript,
    `
import * as fs from "node:fs";
const args = process.argv.slice(2);
const outIdx = args.indexOf("--output_file");
const outFile = outIdx >= 0 ? args[outIdx + 1] : "";
let stdinText = "";
for await (const chunk of process.stdin) {
  stdinText += chunk.toString("utf8");
}
if (stdinText.includes("TRIGGER_FAIL")) {
  process.stderr.write("mock piper synthesis error\\n");
  process.exit(2);
}
fs.writeFileSync(${JSON.stringify(captureJson)}, JSON.stringify({ args, stdinText }));
fs.writeFileSync(outFile, Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(128, 1)]));
`,
  );

  const mockSpawn: typeof spawn = ((_cmd: string, args?: readonly string[], opts?: any) =>
    spawn(process.execPath, [mockPiperScript, ...(args ?? [])], opts)) as typeof spawn;

  try {
    // 1. buildPiperArgs valida rutas
    const built = buildPiperArgs({ modelPath, outputPath: outWav, speed: 160 });
    assert.deepEqual(built, ["--model", modelPath, "--output_file", outWav, "--length_scale", "1.00"]);
    assert.throws(
      () => buildPiperArgs({ modelPath: "--evil", outputPath: outWav, speed: 160 }),
      /modelo piper inválida/i,
    );

    // 2. Rama piper exitosa con texto iniciado en '-' enviado por stdin
    const res = await synthesizeAudio(
      {
        text: "-w /tmp/pwned.wav Hola desde piper",
        outputPath: outWav,
        engine: "piper",
        language: "es",
        speed: 160,
        cwd: tmpDir,
      },
      {
        checkAvailable: () => ({ available: true, engine: "piper" }),
        spawnFn: mockSpawn,
        piperModelPath: modelPath,
      },
    );

    assert.equal(res.engineUsed, "piper");
    assert.equal(res.outputPath, outWav);
    assert.ok(res.byteSize > 100);
    const captured = JSON.parse(fs.readFileSync(captureJson, "utf8"));
    assert.ok(captured.args.includes("--model"));
    assert.ok(captured.args.includes("--output_file"));
    assert.equal(captured.stdinText.trim(), "-w /tmp/pwned.wav Hola desde piper");

    // 3. Manejo de error cuando piper sale con código distinto de 0
    await assert.rejects(
      () =>
        synthesizeAudio(
          {
            text: "TRIGGER_FAIL",
            outputPath: path.join(tmpDir, "fail.wav"),
            engine: "piper",
            cwd: tmpDir,
          },
          {
            checkAvailable: () => ({ available: true, engine: "piper" }),
            spawnFn: mockSpawn,
            piperModelPath: modelPath,
          },
        ),
      /mock piper synthesis error/i,
    );

    // 4. Error claro cuando falta PIPER_MODEL_PATH
    await assert.rejects(
      () =>
        synthesizeAudio(
          {
            text: "hola",
            outputPath: path.join(tmpDir, "nomodel.wav"),
            engine: "piper",
            cwd: tmpDir,
          },
          {
            checkAvailable: () => ({ available: true, engine: "piper" }),
            spawnFn: mockSpawn,
            piperModelPath: "",
          },
        ),
      /PIPER_MODEL_PATH/i,
    );

    // 5. Bloquea outputPath fuera de roots antes de invocar piper
    let spawned = false;
    await assert.rejects(
      () =>
        synthesizeAudio(
          {
            text: "hola",
            outputPath: "/etc/piper-escape.wav",
            engine: "piper",
            cwd: tmpDir,
          },
          {
            checkAvailable: () => ({ available: true, engine: "piper" }),
            spawnFn: ((...args: any[]) => {
              spawned = true;
              return (mockSpawn as any)(...args);
            }) as typeof spawn,
            piperModelPath: modelPath,
          },
        ),
      /Acceso denegado|fuera de los directorios permitidos/i,
    );
    assert.equal(spawned, false, "piper must never be spawned for unconfined outputPath");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
