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

  it("bloquea intentos de Path Traversal fuera del directorio de caché incluso con symlinks", async () => {
    const tmpDir = path.join(os.tmpdir(), `dc-owasp-traversal-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const client = new DcOwaspClient(tmpDir);

    // Intentos de escape con ../ o rutas absolutas
    const escape1 = await client.getSheetMarkdown("../../../etc/passwd");
    assert.strictEqual(escape1, null);

    const escape2 = await client.getSheetMarkdown("..\\..\\windows\\win.ini");
    assert.strictEqual(escape2, null);

    const escape3 = await client.getSheetMarkdown("../");
    assert.strictEqual(escape3, null);

    // Escape mediante symlink hacia un archivo externo
    const outsideFile = path.join(os.tmpdir(), `outside-secret-${Date.now()}.md`);
    fs.writeFileSync(outsideFile, "SECRET_DATA", "utf-8");
    const linkPath = path.join(tmpDir, "evil_symlink.md");
    try {
      fs.symlinkSync(outsideFile, linkPath);
      const escapeSymlink = await client.getSheetMarkdown("evil_symlink.md");
      assert.strictEqual(escapeSymlink, null, "Symlink que apunta fuera de cacheDir debe ser bloqueado");
    } finally {
      try { fs.unlinkSync(outsideFile); } catch {}
      try { fs.unlinkSync(linkPath); } catch {}
    }

    // Escape mediante dangling symlink (symlink colgante cuyo destino no existe)
    const danglingTarget = path.join(os.tmpdir(), `dangling-secret-${Date.now()}.md`);
    const danglingLink = path.join(tmpDir, "dangling_link.md");
    try {
      fs.symlinkSync(danglingTarget, danglingLink);
      const escapeDangling = await client.getSheetMarkdown("dangling_link.md");
      assert.strictEqual(escapeDangling, null, "Dangling symlink debe ser bloqueado para evitar creación fuera de cacheDir");
      assert.strictEqual(fs.existsSync(danglingTarget), false, "El destino externo nunca debe ser creado");
    } finally {
      try { fs.unlinkSync(danglingLink); } catch {}
      try { fs.unlinkSync(danglingTarget); } catch {}
    }

    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });
});
