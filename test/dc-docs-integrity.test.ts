import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findSkillFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSkillFiles(fullPath));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      results.push(fullPath);
    }
  }
  return results;
}

test("Auditoría de Integridad Documental: Validación de Skills y Enlaces", () => {
  // En .test-build/test/ subimos dos niveles para llegar al root del paquete
  const repoRoot = path.resolve(__dirname, "../..");
  const skillsDir = path.join(repoRoot, "skills");

  const skillFiles = findSkillFiles(skillsDir);
  assert.ok(skillFiles.length >= 10, `Deben existir al menos 10 archivos SKILL.md en el catálogo (encontrados: ${skillFiles.length})`);

  for (const file of skillFiles) {
    const relativePath = path.relative(repoRoot, file);
    const content = fs.readFileSync(file, "utf8");

    // 1. Debe iniciar con frontmatter YAML (---)
    assert.ok(
      content.startsWith("---"),
      `El skill ${relativePath} debe comenzar con delimitador de frontmatter '---'`
    );

    const secondDashIndex = content.indexOf("---", 3);
    assert.ok(
      secondDashIndex > 3,
      `El skill ${relativePath} debe tener un bloque de cierre de frontmatter '---'`
    );

    const frontmatter = content.slice(3, secondDashIndex);

    // 2. Debe contener 'name:' y 'description:'
    assert.match(
      frontmatter,
      /^name:\s*[a-zA-Z0-9_-]+/m,
      `El skill ${relativePath} debe definir la propiedad 'name:' en su frontmatter`
    );
    assert.match(
      frontmatter,
      /^description:\s*.+/m,
      `El skill ${relativePath} debe definir la propiedad 'description:' en su frontmatter`
    );

    // 3. Verificación de enlaces Markdown locales relativos [texto](./archivo.md)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(content)) !== null) {
      const linkTarget = match[2]?.trim();
      if (!linkTarget || linkTarget.startsWith("http://") || linkTarget.startsWith("https://") || linkTarget.startsWith("#") || linkTarget.startsWith("mailto:")) {
        continue; // Ignorar enlaces externos o anclas internas
      }

      // Resolver ruta relativa al directorio del SKILL.md
      const resolvedTarget = path.resolve(path.dirname(file), linkTarget);
      assert.ok(
        fs.existsSync(resolvedTarget),
        `En ${relativePath}, el enlace relativo '${linkTarget}' apunta a un archivo inexistente: ${resolvedTarget}`
      );
    }
  }
});
