import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchJson, sanitizeUrl, DcHttpError, DcHttpTimeoutError } from "../src/integrations/dc-http/dc-fetch.ts";

test("sanitizeUrl redacts sensitive query parameters", () => {
  const url1 = "https://api.example.com/v1/models?key=secret123&other=visible";
  assert.equal(sanitizeUrl(url1), "https://api.example.com/v1/models?key=%5BREDACTED%5D&other=visible");

  const url2 = "http://localhost:8317/v0/quota?token=bearerABC";
  assert.equal(sanitizeUrl(url2), "http://localhost:8317/v0/quota?token=%5BREDACTED%5D");

  const url3 = "invalid-url?apiKey=12345";
  assert.equal(sanitizeUrl(url3), "invalid-url?apiKey=[REDACTED]");
});

test("fetchJson performs successful GET and parses JSON", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.headers.accept, "application/json");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", count: 42 }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  const url = `http://127.0.0.1:${port}/test`;

  try {
    const data = await fetchJson<{ status: string; count: number }>(url);
    assert.equal(data.status, "ok");
    assert.equal(data.count, 42);
  } finally {
    server.close();
  }
});

test("fetchJson performs POST with JSON payload", async () => {
  const server = http.createServer(async (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.headers["content-type"], "application/json");
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    assert.equal(parsed.name, "dc-test");
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ created: true }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  const url = `http://127.0.0.1:${port}/create`;

  try {
    const res = await fetchJson<{ created: boolean }>(url, {
      method: "POST",
      body: { name: "dc-test" },
    });
    assert.equal(res.created, true);
  } finally {
    server.close();
  }
});

test("fetchJson throws DcHttpError on non-2xx status", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(404, "Not Found");
    res.end(JSON.stringify({ error: "missing" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  const url = `http://127.0.0.1:${port}/not-found`;

  try {
    await assert.rejects(
      async () => { await fetchJson(url); },
      (err: any) => {
        assert.ok(err instanceof DcHttpError);
        assert.equal(err.status, 404);
        assert.ok(err.message.includes("404"));
        return true;
      },
    );
  } finally {
    server.close();
  }
});

test("fetchJson throws DcHttpTimeoutError when request takes too long", async () => {
  const server = http.createServer((_req, _res) => {
    // Hangs forever
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  const url = `http://127.0.0.1:${port}/hang`;

  try {
    await assert.rejects(
      async () => {
        await fetchJson(url, { timeoutMs: 50 });
      },
      (err: any) => {
        assert.ok(err instanceof DcHttpTimeoutError);
        assert.equal(err.status, 408);
        assert.ok(err.message.includes("timed out after 50ms"));
        return true;
      },
    );
  } finally {
    server.close();
  }
});

test("fetchJson respects external AbortSignal", async () => {
  const server = http.createServer((_req, _res) => {
    // Hangs
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as any).port;
  const url = `http://127.0.0.1:${port}/hang-abort`;

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);

  try {
    await assert.rejects(
      async () => {
        await fetchJson(url, { signal: controller.signal, timeoutMs: 5000 });
      },
      (err: any) => {
        assert.ok(err instanceof DcHttpError);
        return true;
      },
    );
  } finally {
    server.close();
  }
});
