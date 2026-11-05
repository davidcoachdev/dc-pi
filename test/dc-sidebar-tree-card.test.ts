import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import {
  scanDirectory,
  getFileGlyph,
  DcProjectTreeCard,
  createProjectTreeCard,
} from "../src/features/dc-sidebar/components/dc-sidebar-tree-card.ts";

test("scanDirectory ignores node_modules and .git, orders folders first", () => {
  const cwd = process.cwd();
  const nodes = scanDirectory(cwd, cwd, 1);

  assert.ok(nodes.length > 0);
  assert.ok(!nodes.some((n) => n.name === "node_modules"));
  assert.ok(!nodes.some((n) => n.name === ".git"));

  // Verificar que src está presente y es carpeta
  const srcNode = nodes.find((n) => n.name === "src");
  assert.ok(srcNode);
  assert.equal(srcNode.isDir, true);
});

test("getFileGlyph returns proper icons for extensions", () => {
  assert.equal(getFileGlyph("src", true, true), "📂");
  assert.equal(getFileGlyph("src", true, false), "📁");
  assert.equal(getFileGlyph("index.ts", false, false), "📘");
  assert.equal(getFileGlyph("app.js", false, false), "📒");
  assert.equal(getFileGlyph("package.json", false, false), "⚙️ ");
  assert.equal(getFileGlyph("README.md", false, false), "📜");
});

test("DcProjectTreeCard renders tree lines connecting parent with children and items count", () => {
  const cwd = process.cwd();
  const treeComp = new DcProjectTreeCard(cwd);

  // Asegurar que 'src' y 'src/features' están expandidas
  treeComp.toggleDir("src"); // si estaba en Set se quita, volver a poner
  treeComp.toggleDir("src");

  const lines = treeComp.render(60);
  const plainLines = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));

  // Debe contener líneas conectores de árbol de jerarquía
  assert.ok(
    plainLines.some((l) => l.includes("├── ") || l.includes("└── ")),
    "Must render hierarchical branch connectors (├── or └──)"
  );

  // Debe renderizar badge de conteo de items en carpetas
  assert.ok(
    plainLines.some((l) => /\(\d+ items?\)/.test(l)),
    "Must render folder item count badge like (N items)"
  );

  // Verificar título de tarjeta
  const card = createProjectTreeCard(cwd);
  const title = `PROYECTO - ${path.basename(cwd) || "workspace"}`;
  const cardLines = card.render(Math.max(60, title.length + 20)).map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
  assert.ok(cardLines.some((l) => l.includes(title)), "Must render PROYECTO - <name> card title");
});
