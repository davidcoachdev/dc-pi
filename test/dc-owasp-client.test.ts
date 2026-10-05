import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DcOwaspClient } from "../src/features/dc-owasp/core/dc-owasp-client.ts";
import { OWASP_CATALOG } from "../src/features/dc-owasp/core/dc-owasp-catalog.ts";

describe("DcOwaspClient & Catalog", () => {
  it("contiene elementos curados en OWASP_CATALOG con URLs y filenames válidos", () => {
    assert.ok(OWASP_CATALOG.length >= 10);
    const auth = OWASP_CATALOG.find((c) => c.id === "auth");
    assert.ok(auth);
    assert.strictEqual(auth.filename, "Authentication_Cheat_Sheet.md");
    assert.ok(auth.url.includes("Authentication_Cheat_Sheet.html"));
  });

  it("busca localmente por palabras clave en fallback sin red", async () => {
    const tmpDir = path.join(os.tmpdir(), `dc-owasp-test-${Date.now()}`);
    const client = new DcOwaspClient(tmpDir);

    const results = await client.search("sql injection");
    assert.ok(results.length > 0);
    assert.ok(results.some((r) => r.title.includes("SQL Injection")));

    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("maneja caché en disco correctamente para markdowns", async () => {
    const tmpDir = path.join(os.tmpdir(), `dc-owasp-cache-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Inyectamos un markdown simulado
    const sampleMd = "# Mock Auth Cheat Sheet\n\n## Primary Defenses\n- Use Argon2id.";
    fs.writeFileSync(path.join(tmpDir, "Authentication_Cheat_Sheet.md"), sampleMd, "utf-8");

    const client = new DcOwaspClient(tmpDir);
    const sheet = await client.getSheetMarkdown("auth");

    assert.ok(sheet);
    assert.strictEqual(sheet.markdown, sampleMd);
    assert.strictEqual(sheet.filename, "Authentication_Cheat_Sheet.md");

    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });
});
