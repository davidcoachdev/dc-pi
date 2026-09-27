import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  cleanVttText,
  formatDuration,
  isYtDlpAvailable,
} from "../src/features/dc-youtube/core/dc-youtube-client.ts";
import dcYoutubeExtension from "../src/features/dc-youtube/dc-youtube.ts";

test("dc-youtube helpers: formatDuration formats seconds correctly", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(45), "0:45");
  assert.equal(formatDuration(125), "2:05");
  assert.equal(formatDuration(3665), "1:01:05");
});

test("dc-youtube: cleanVttText removes WEBVTT headers, timestamps, and deduplicates consecutive lines", () => {
  const sampleVtt = `WEBVTT
Kind: captions
Language: es

1
00:00:01.000 --> 00:00:03.000
Hola a todos

2
00:00:03.000 --> 00:00:05.000
Hola a todos
<c>bienvenidos al canal</c>

3
00:00:05.000 --> 00:00:08.000
bienvenidos al canal
hoy vamos a ver TypeScript
`;

  const cleaned = cleanVttText(sampleVtt);
  assert.ok(!cleaned.includes("WEBVTT"));
  assert.ok(!cleaned.includes("-->"));
  assert.ok(!cleaned.includes("<c>"));
  assert.ok(cleaned.includes("Hola a todos bienvenidos al canal hoy vamos a ver TypeScript"));
});

test("dc-youtube: isYtDlpAvailable returns true in this environment", () => {
  assert.equal(isYtDlpAvailable(), true);
});

test("dcYoutubeExtension registers all 4 YouTube tools and /dc-youtube command", () => {
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

  dcYoutubeExtension(mockPi);

  const expectedTools = [
    "dc_youtube_search",
    "dc_youtube_video_get",
    "dc_youtube_transcript_get",
    "dc_youtube_channel_search",
  ];

  for (const tool of expectedTools) {
    assert.ok(registeredTools.includes(tool), `Tool ${tool} should be registered`);
  }

  assert.ok(registeredCommands.includes("dc-youtube"));
});
