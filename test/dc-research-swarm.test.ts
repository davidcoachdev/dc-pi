import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  DC_RESEARCH_CHANNELS,
  compileSwarmReport,
  executeResearchSwarm,
  type DcResearchChannel,
  type DcSwarmChannelResult,
} from "../src/features/dc-agents/core/dc-research-swarm.ts";

import { registerDcEphemeralTools } from "../src/features/dc-agents/tools/dc-ephemeral-tools.ts";
import { loadFleetState } from "../src/features/dc-agents/core/dc-taxi-dispatcher.ts";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dc-test-${prefix}-`));
}

test("dc-research-swarm: DC_RESEARCH_CHANNELS contracts and configurations", () => {
  const expectedChannels: DcResearchChannel[] = ["web", "docs", "discussions", "github", "academic", "youtube"];

  for (const ch of expectedChannels) {
    const config = DC_RESEARCH_CHANNELS[ch];
    assert.ok(config, `Channel ${ch} must be defined`);
    assert.equal(config.channel, ch);
    assert.ok(config.roleName.startsWith("dc-scout-"), `Role for ${ch} must start with dc-scout-`);
    assert.ok(config.toolBricks.length > 0, `Channel ${ch} must have at least one tool brick`);
    assert.ok(typeof config.instructions === "function", `Channel ${ch} must have instructions generator`);

    const prompt = config.instructions("TypeScript 5.8");
    assert.ok(prompt.includes("TypeScript 5.8"));
  }
});

test("dc-research-swarm: compileSwarmReport formats executive summary and sources audit", () => {
  const results: DcSwarmChannelResult[] = [
    {
      channel: "web",
      role: "dc-scout-web",
      status: "success",
      content: "1. TS 5.8 incluye checks de branches y mejoras de typecheck.",
      durationMs: 1200,
      taxiAccount: "ac02",
    },
    {
      channel: "docs",
      role: "dc-scout-docs",
      status: "success",
      content: "Manual de TypeScript Handbook actualizado para TS 5.8.",
      durationMs: 1400,
      taxiAccount: "ac04",
    },
    {
      channel: "youtube",
      role: "dc-scout-media",
      status: "failed",
      content: "",
      durationMs: 500,
      error: "No videos found",
    },
  ];

  const { reportMarkdown, sourcesMarkdown } = compileSwarmReport("TypeScript 5.8 novedades", results);

  assert.ok(reportMarkdown.includes("Informe de Investigación Profunda: TypeScript 5.8 novedades"));
  assert.ok(reportMarkdown.includes("Hallazgos de Canal: `web`"));
  assert.ok(reportMarkdown.includes("TS 5.8 incluye checks"));
  assert.ok(reportMarkdown.includes("Hallazgos de Canal: `docs`"));
  assert.ok(reportMarkdown.includes("Canal: `youtube` (Sin resultados o fallido)"));

  assert.ok(sourcesMarkdown.includes("Auditoría de Fuentes"));
  assert.ok(sourcesMarkdown.includes("Canal `web`"));
  assert.ok(sourcesMarkdown.includes("ac02"));
  assert.ok(sourcesMarkdown.includes("Canal `youtube`**: Fallido"));
});

test("dc-research-swarm: executeResearchSwarm executes channels concurrently and saves outputs", async () => {
  const tempDir = createTempDir("swarm-output");
  const testSessionId = `sess-swarm-${Date.now()}`;

  const executedTools: Array<{ name: string; params: any }> = [];

  const fakeExecuteTool = async (name: string, params: any) => {
    executedTools.push({ name, params });
    return {
      result: {
        content: [
          { type: "text", text: `Hallazgo simulado para subagente ${params.agent} (${params.label})` },
        ],
      },
    };
  };

  const channels: DcResearchChannel[] = ["web", "docs", "discussions"];

  const swarmResult = await executeResearchSwarm(
    {
      query: "Node.js SQLite nativo",
      channels,
      outputDir: tempDir,
      model: "gemini-3.8-flash-high",
      sessionId: testSessionId,
    },
    {
      sessionId: testSessionId,
      parentModel: "cpam/ac01/gemini-3.8-flash-high",
      executeToolFn: fakeExecuteTool,
    },
  );

  // 1. Verificación de resultado del enjambre
  assert.equal(swarmResult.query, "Node.js SQLite nativo");
  assert.equal(swarmResult.channelsExecuted.length, 3);
  assert.equal(executedTools.length, 3);

  // Los 3 canales deben haber sido completados exitosamente
  for (const ch of channels) {
    const res = swarmResult.channelResults[ch];
    assert.ok(res, `Result for channel ${ch} must exist`);
    assert.equal(res.status, "success");
    assert.ok(res.content.includes("Hallazgo simulado"));
    assert.ok(res.durationMs >= 0);
  }

  // 2. Verificación de archivos generados en outputDir
  const reportPath = path.join(tempDir, "report.md");
  const sourcesPath = path.join(tempDir, "sources.md");
  assert.ok(fs.existsSync(reportPath), "report.md must be written to outputDir");
  assert.ok(fs.existsSync(sourcesPath), "sources.md must be written to outputDir");

  const reportContent = fs.readFileSync(reportPath, "utf8");
  assert.ok(reportContent.includes("Node.js SQLite nativo"));
  assert.ok(reportContent.includes("dc-scout-web"));
  assert.ok(reportContent.includes("dc-scout-docs"));

  // 3. Verificación de limpieza estricta (Fresh Context Loop):
  // Ningún archivo temporal dc-ephem-*.md debe quedar huérfano en ~/.pi/agent/agents/
  const agentsDir = path.join(os.homedir(), ".pi", "agent", "agents");
  if (fs.existsSync(agentsDir)) {
    const remainingEphem = fs.readdirSync(agentsDir).filter((f) => f.startsWith("dc-ephem-"));
    // Ningún archivo del enjambre debe haber quedado abierto
    for (const tool of executedTools) {
      assert.ok(!remainingEphem.includes(`${tool.params.agent}.md`), `Agent file ${tool.params.agent} must be cleaned up`);
    }
  }
});

test("dc-research-swarm: executeResearchSwarm handles partial channel failures gracefully via Promise.allSettled", async () => {
  const testSessionId = `sess-swarm-partial-${Date.now()}`;

  const fakeExecuteTool = async (name: string, params: any) => {
    // Simular que el canal de youtube falla mientras que el de web tiene éxito
    if (params.label?.includes("youtube")) {
      throw new Error("Quota exceeded in YouTube API");
    }
    return {
      result: {
        content: [{ type: "text", text: `Web content found for ${params.agent}` }],
      },
    };
  };

  const swarmResult = await executeResearchSwarm(
    {
      query: "Rust vs Go concurrencia",
      channels: ["web", "youtube"],
      sessionId: testSessionId,
    },
    {
      sessionId: testSessionId,
      executeToolFn: fakeExecuteTool,
    },
  );

  assert.equal(swarmResult.channelResults["web"].status, "success");
  assert.ok(swarmResult.channelResults["web"].content.includes("Web content found"));

  assert.equal(swarmResult.channelResults["youtube"].status, "failed");
  assert.ok(swarmResult.channelResults["youtube"].error?.includes("Quota exceeded in YouTube API"));

  // El reporte final consolida ambos sin crashear
  assert.ok(swarmResult.reportMarkdown.includes("Hallazgos de Canal: `web`"));
  assert.ok(swarmResult.reportMarkdown.includes("Canal: `youtube` (Sin resultados o fallido)"));
});

test("dc-ephemeral-tools: dc_research_swarm tool registration in ExtensionAPI", () => {
  const registered: any[] = [];
  const fakePi = {
    registerTool(toolDef: any) {
      registered.push(toolDef);
    },
  } as any;

  registerDcEphemeralTools(fakePi);

  const swarmTool = registered.find((t) => t.name === "dc_research_swarm");
  assert.ok(swarmTool, "dc_research_swarm tool must be registered");
  assert.equal(swarmTool.name, "dc_research_swarm");
  assert.ok(swarmTool.description.includes("enjambre"));
  assert.ok(swarmTool.parameters.properties.query, "must have query param");
  assert.ok(swarmTool.parameters.properties.channels, "must have channels param");
  assert.ok(swarmTool.parameters.required.includes("query"), "query must be required");
});
