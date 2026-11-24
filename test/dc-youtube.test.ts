import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  buildYtDlpSearchArgs,
  buildYtDlpTranscriptArgs,
  buildYtDlpVideoDetailsArgs,
  cleanVttText,
  formatDuration,
  getTranscript,
  getVideoDetails,
  isYtDlpAvailable,
  resetYtDlpAvailabilityCache,
  validateYoutubeUrl,
  validateYoutubeUrlOrId,
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

test("dc-youtube: isYtDlpAvailable returns true and memoizes the result", () => {
  resetYtDlpAvailabilityCache();
  
  const startFirst = performance.now();
  const first = isYtDlpAvailable();
  const durFirst = performance.now() - startFirst;
  assert.equal(first, true);

  // Segunda llamada debe ser instantánea por la caché en memoria (sin spawnSync)
  const startSecond = performance.now();
  const second = isYtDlpAvailable();
  const durSecond = performance.now() - startSecond;
  assert.equal(second, true);
  assert.ok(durSecond < 5, `durSecond (${durSecond}ms) should be near 0ms due to in-memory memoization`);

  // forceRefresh debe volver a chequear
  resetYtDlpAvailabilityCache();
  const third = isYtDlpAvailable(true);
  assert.equal(third, true);
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

test("dc-youtube: validateYoutubeUrl and validateYoutubeUrlOrId accept official YouTube HTTPS URLs and bare IDs", () => {
  const validUrls = [
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  ];

  for (const url of validUrls) {
    assert.equal(validateYoutubeUrl(url), url);
    assert.equal(validateYoutubeUrlOrId(url), url);
  }

  assert.equal(
    validateYoutubeUrlOrId("dQw4w9WgXcQ"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
});

test("dc-youtube: rejects SSRF, non-https schemes, credentials, metadata IPs, non-YouTube domains and flag injection", async () => {
  const forbiddenInputs = [
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "file:///etc/passwd",
    "ftp://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://evil.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "https://127.0.0.1/watch?v=dQw4w9WgXcQ",
    "https://localhost/watch?v=dQw4w9WgXcQ",
    "https://[::1]/watch?v=dQw4w9WgXcQ",
    "http://169.254.169.254/latest/meta-data",
    "https://169.254.169.254/latest/meta-data",
    "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    "--exec=id",
    "--version",
    "-o /tmp/pwned",
  ];

  for (const bad of forbiddenInputs) {
    assert.throws(
      () => validateYoutubeUrlOrId(bad),
      /bloquead|SSRF|inválid|Esquema|Credenciales|Host|Puerto/i,
      `validateYoutubeUrlOrId should reject ${bad}`,
    );
  }

  await assert.rejects(
    () => getVideoDetails("http://169.254.169.254/latest/meta-data"),
    /bloquead|SSRF|Esquema|Host/i,
  );

  await assert.rejects(
    () => getTranscript({ urlOrId: "https://evil.com/video" }),
    /bloquead|SSRF|Host/i,
  );

  await assert.rejects(
    () => getTranscript({ urlOrId: "file:///etc/passwd" }),
    /bloquead|SSRF|Esquema/i,
  );
});

test("dc-youtube: yt-dlp argument builders always place '--' immediately before target URL/query", () => {
  const detailsArgs = buildYtDlpVideoDetailsArgs("https://youtu.be/dQw4w9WgXcQ");
  const detailsSep = detailsArgs.indexOf("--");
  assert.ok(detailsSep >= 0, "video details argv must contain '--'");
  assert.equal(detailsSep, detailsArgs.length - 2);
  assert.equal(detailsArgs[detailsSep + 1], "https://youtu.be/dQw4w9WgXcQ");

  const transcriptArgs = buildYtDlpTranscriptArgs(
    "dQw4w9WgXcQ",
    "es,en",
    "/tmp/out/%(id)s.%(ext)s",
  );
  const transcriptSep = transcriptArgs.indexOf("--");
  assert.ok(transcriptSep >= 0, "transcript argv must contain '--'");
  assert.equal(transcriptSep, transcriptArgs.length - 2);
  assert.equal(
    transcriptArgs[transcriptSep + 1],
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );

  const searchArgs = buildYtDlpSearchArgs("--exec=whoami typescript", 3);
  const searchSep = searchArgs.indexOf("--");
  assert.ok(searchSep >= 0, "search argv must contain '--'");
  assert.equal(searchSep, searchArgs.length - 2);
  assert.equal(searchArgs[searchSep + 1], "ytsearch3:--exec=whoami typescript");

  assert.throws(
    () => buildYtDlpTranscriptArgs("dQw4w9WgXcQ", "--exec=id", "/tmp/out/%(id)s.%(ext)s"),
    /idioma de subtítulos inválido/i,
  );
});

test("dc-youtube: buildYtDlpSearchArgs guards NaN/non-finite limits and clamps integer range 1..10", () => {
  assert.equal(buildYtDlpSearchArgs("typescript", Number.NaN).at(-1), "ytsearch5:typescript");
  assert.equal(buildYtDlpSearchArgs("typescript", Number.POSITIVE_INFINITY).at(-1), "ytsearch5:typescript");
  assert.equal(buildYtDlpSearchArgs("typescript", Number.NEGATIVE_INFINITY).at(-1), "ytsearch5:typescript");
  assert.equal(buildYtDlpSearchArgs("typescript", 0).at(-1), "ytsearch1:typescript");
  assert.equal(buildYtDlpSearchArgs("typescript", -4).at(-1), "ytsearch1:typescript");
  assert.equal(buildYtDlpSearchArgs("typescript", 3.9).at(-1), "ytsearch3:typescript");
  assert.equal(buildYtDlpSearchArgs("typescript", 99).at(-1), "ytsearch10:typescript");
});
