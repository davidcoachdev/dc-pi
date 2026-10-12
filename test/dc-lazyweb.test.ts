import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  DcLazywebClient,
  normalizeLazywebPayload,
} from "../src/features/dc-lazyweb/core/dc-lazyweb-client.ts";
import { registerDcLazywebTools } from "../src/features/dc-lazyweb/tools/dc-lazyweb-tools.ts";
import {
  DC_TOOL_BRICKS,
  DC_TOOL_BRICK_GUIDELINES,
} from "../src/features/dc-agents/core/dc-ephemeral-types.ts";
import {
  assembleLegoAgentPlan,
  isolateSpecializedToolsForOrchestrator,
} from "../src/features/dc-agents/core/dc-ephemeral-manager.ts";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dc-lazyweb-test-${prefix}-`));
}

test("dc-lazyweb: Lego brick 'lazyweb' is registered, injects guidelines, and is isolated from parent orchestrator", () => {
  assert.ok(Array.isArray(DC_TOOL_BRICKS.lazyweb), "lazyweb brick must exist in DC_TOOL_BRICKS");
  assert.deepEqual(DC_TOOL_BRICKS.lazyweb, ["dc_lazyweb_search"]);
  assert.ok(
    DC_TOOL_BRICK_GUIDELINES.lazyweb.includes("dc_lazyweb_search"),
    "lazyweb brick guideline must reference dc_lazyweb_search",
  );

  const plan = assembleLegoAgentPlan({
    task: "Investigar patrones de pricing page con toggle anual",
    toolBricks: ["lazyweb", "fs-read"],
  });

  assert.ok(plan.tools.includes("dc_lazyweb_search"));
  assert.ok(plan.tools.includes("read"));
  assert.ok(plan.directives.some((d) => d.includes("[Tool: lazyweb]") && d.includes("dc_lazyweb_search")));

  // Verify isolation from parent orchestrator
  let activeTools = ["read", "edit", "bash", "dc_lazyweb_search", "dc_ephemeral_agent_run"];
  const fakePi = {
    getActiveTools: () => activeTools,
    setActiveTools: (next: string[]) => {
      activeTools = next;
    },
  };
  isolateSpecializedToolsForOrchestrator(fakePi);
  assert.ok(!activeTools.includes("dc_lazyweb_search"), "dc_lazyweb_search must be isolated from parent");
  assert.ok(activeTools.includes("dc_ephemeral_agent_run"));
});

test("dc-lazyweb: DcLazywebClient auto-provisions and persists free bearer token with 0600 permissions", async () => {
  const tempDir = createTempDir("token");
  const tokenFile = path.join(tempDir, "lazyweb_mcp_token");
  const installIdFile = path.join(tempDir, "install_id");

  try {
    let tokenCalls = 0;
    const mockFetch = async (url: string, init?: any) => {
      if (url.includes("/api/mcp/install-token")) {
        tokenCalls++;
        const body = JSON.parse(init.body);
        assert.equal(body.install_channel, "curl");
        assert.match(body.install_id, /^[0-9a-f-]{36}$/i);
        return {
          ok: true,
          status: 200,
          headers: new Map([["content-type", "application/json"]]),
          json: async () => ({ ok: true, token: "11111111-2222-4333-8444-555555555555" }),
          text: async () => JSON.stringify({ ok: true, token: "11111111-2222-4333-8444-555555555555" }),
        } as any;
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const client = new DcLazywebClient({
      tokenFile,
      installIdFile,
      fetchImpl: mockFetch as any,
    });

    const token1 = await client.ensureToken();
    assert.equal(token1, "11111111-2222-4333-8444-555555555555");
    assert.equal(tokenCalls, 1);
    assert.equal(fs.readFileSync(tokenFile, "utf8").trim(), "11111111-2222-4333-8444-555555555555");

    // Second call must reuse cached file without hitting network
    const token2 = await client.ensureToken();
    assert.equal(token2, "11111111-2222-4333-8444-555555555555");
    assert.equal(tokenCalls, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-lazyweb: normalizeLazywebPayload extracts clean screens, flows, and experiments without bloat", () => {
  const screensNorm = normalizeLazywebPayload("screens", {
    ok: true,
    results: [
      {
        companyName: "glossgenius",
        pageUrl: "https://glossgenius.com/pricing",
        platform: "desktop",
        similarity: 0.58,
        visionDescription: "Three tier pricing page with annual toggle.",
        imageUrl: "https://example.com/gloss.png",
        extraTelemetryField: "ignored",
      },
    ],
  });
  assert.equal(screensNorm.mode, "screens");
  assert.equal(screensNorm.items.length, 1);
  assert.equal(screensNorm.items[0].company, "glossgenius");
  assert.equal(screensNorm.items[0].imageUrl, "https://example.com/gloss.png");

  const flowsNorm = normalizeLazywebPayload("flows", {
    ok: true,
    flows: [
      {
        company: "adidas",
        flowName: "Onboarding",
        steps: [
          {
            step: 1,
            visionDescription: "Intro screen",
            imageUrl: "https://example.com/adidas-1.png",
          },
        ],
      },
    ],
  });
  assert.equal(flowsNorm.mode, "flows");
  assert.equal(flowsNorm.items.length, 1);
  assert.equal(flowsNorm.items[0].company, "adidas");
  assert.equal(flowsNorm.items[0].steps?.length, 1);

  const expNorm = normalizeLazywebPayload("experiments", {
    ok: true,
    dataset_caveat: "Hypothesis only",
    evidence: {
      experiments: [
        {
          company: { company_name: "curio", category: "News" },
          control: {
            vision_description: "Control paywall",
            image_url: "https://example.com/curio-c.jpg",
          },
        },
      ],
    },
  });
  assert.equal(expNorm.mode, "experiments");
  assert.equal(expNorm.caveat, "Hypothesis only");
  assert.equal(expNorm.items.length, 1);
  assert.equal(expNorm.items[0].company, "curio");
  assert.equal(expNorm.items[0].imageUrl, "https://example.com/curio-c.jpg");
});

test("dc-lazyweb: dc_lazyweb_search executes stateless JSON-RPC call and optionally triggers preview opener", async () => {
  const tempDir = createTempDir("exec");
  const tokenFile = path.join(tempDir, "token");
  fs.writeFileSync(tokenFile, "aaaa1111-bbbb-4ccc-8ddd-eeeeffff0000\n", "utf8");

  const previewedImages: string[] = [];
  const mockFetch = async (url: string, init?: any) => {
    if (url === "https://www.lazyweb.com/mcp") {
      const rpc = JSON.parse(init.body);
      assert.equal(rpc.method, "tools/call");
      assert.equal(rpc.params.name, "lazyweb_search_screens");
      assert.equal(init.headers.Authorization, "Bearer aaaa1111-bbbb-4ccc-8ddd-eeeeffff0000");
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () =>
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: true,
                    results: [
                      {
                        companyName: "stripe",
                        pageUrl: "https://stripe.com/pricing",
                        platform: "desktop",
                        visionDescription: "Stripe pricing cards with enterprise tier",
                        imageUrl: "https://example.com/stripe-pricing.png",
                      },
                    ],
                  }),
                },
              ],
            },
          }),
      } as any;
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const client = new DcLazywebClient({
      tokenFile,
      fetchImpl: mockFetch as any,
      previewLauncher: async (urls: string[]) => {
        previewedImages.push(...urls);
        return urls.map((_, idx) => `/tmp/mock-${idx}.png`);
      },
    });

    const registered: any[] = [];
    const fakePi = {
      registerTool: (def: any) => registered.push(def),
    } as any;

    registerDcLazywebTools(fakePi, client);
    const tool = registered.find((t) => t.name === "dc_lazyweb_search");
    assert.ok(tool, "dc_lazyweb_search must be registered");

    const res = await tool.execute("call-1", {
      mode: "screens",
      query: "pricing cards",
      platform: "desktop",
      limit: 2,
      openPreview: true,
    });

    assert.equal(res.isError, undefined);
    assert.ok(res.content[0].text.includes("stripe"));
    assert.ok(res.content[0].text.includes("Stripe pricing cards"));
    assert.deepEqual(previewedImages, ["https://example.com/stripe-pricing.png"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dc-lazyweb: DcLazywebClient automatically refreshes stale token and retries once on HTTP 401", async () => {
  const tempDir = createTempDir("retry-401");
  const tokenFile = path.join(tempDir, "lazyweb_mcp_token");
  const installIdFile = path.join(tempDir, "install_id");
  fs.writeFileSync(tokenFile, "stale-expired-token\n", "utf8");

  let mcpAttempts = 0;
  let tokenRefreshCalls = 0;

  const mockFetch = async (url: string, init?: any) => {
    if (url.includes("/api/mcp/install-token")) {
      tokenRefreshCalls++;
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ ok: true, token: "fresh-renewed-token-9999" }),
        text: async () => JSON.stringify({ ok: true, token: "fresh-renewed-token-9999" }),
      } as any;
    }
    if (url === "https://www.lazyweb.com/mcp") {
      mcpAttempts++;
      if (init.headers.Authorization === "Bearer stale-expired-token") {
        return {
          ok: false,
          status: 401,
          headers: { get: () => "application/json" },
          text: async () => JSON.stringify({ error: "unauthorized" }),
        } as any;
      }
      assert.equal(init.headers.Authorization, "Bearer fresh-renewed-token-9999");
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () =>
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: true,
                    results: [
                      {
                        companyName: "linear",
                        pageUrl: "https://linear.app",
                        platform: "desktop",
                        visionDescription: "Linear dark mode hero",
                      },
                    ],
                  }),
                },
              ],
            },
          }),
      } as any;
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const client = new DcLazywebClient({
      tokenFile,
      installIdFile,
      fetchImpl: mockFetch as any,
    });

    const result = await client.search({
      mode: "screens",
      query: "dark mode hero",
      limit: 1,
    });

    assert.equal(mcpAttempts, 2);
    assert.equal(tokenRefreshCalls, 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].company, "linear");
    assert.equal(fs.readFileSync(tokenFile, "utf8").trim(), "fresh-renewed-token-9999");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

