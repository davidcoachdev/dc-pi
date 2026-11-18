/**
 * dc-skill-curator.ts — Curador y Auto-Aprendizaje de Skills desde Observaciones de Engram.
 *
 * Inspirado en el motor de auto-aprendizaje de habilidades (learn-skill-agent) de Qwen Code,
 * adaptado a la arquitectura modular y canónica de DC Studio:
 * 1. Identifica observaciones de alto valor ('pattern', 'bugfix', 'discovery', 'architecture') en Engram.
 * 2. Sintetiza borradores canónicos de SKILL.md con frontmatter válido y secciones canónicas
 *    (Activation Contract, Hard Rules, Decision Gates, Execution Steps).
 * 3. Valida y guarda de forma segura en `skills/<slug>/SKILL.md` previniendo sobreescrituras accidentales.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { EngramObservation } from "../dc-engram-db.ts";

export interface DecisionGateItem {
  condition: string;
  action: string;
}

export interface SkillDraftInput {
  name: string;
  description: string;
  triggers: string[];
  activationWhen?: string[];
  activationNotWhen?: string[];
  hardRules?: string[];
  decisionGates?: DecisionGateItem[];
  steps?: string[];
  license?: string;
  author?: string;
}

export interface SaveSkillResult {
  saved: boolean;
  filePath: string;
  reason?: string;
}

/**
 * Normaliza un string para que sea un slug válido de skill en kebab-case.
 */
export function formatSkillSlug(rawName: string): string {
  const slug = rawName
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "custom-skill";
}

/**
 * Valida la sintaxis del frontmatter YAML de un archivo SKILL.md.
 */
export function validateSkillFrontmatter(content: string): { valid: boolean; name?: string; reason?: string } {
  if (!content.startsWith("---\n")) {
    return { valid: false, reason: "El archivo no inicia con delimitador de frontmatter YAML ('---')." };
  }

  const endIdx = content.indexOf("\n---\n", 4);
  if (endIdx === -1) {
    return { valid: false, reason: "No se encontró el cierre de frontmatter YAML ('---')." };
  }

  const header = content.slice(4, endIdx);
  const nameMatch = header.match(/^name:\s*(.+)$/m);
  if (!nameMatch) {
    return { valid: false, reason: "Falta el campo obligatorio 'name' en el frontmatter." };
  }

  const descMatch = header.match(/^description:\s*(.+)$/m);
  if (!descMatch) {
    return { valid: false, reason: "Falta el campo obligatorio 'description' en el frontmatter." };
  }

  return { valid: true, name: nameMatch[1]!.trim().replace(/^['"]|['"]$/g, "") };
}

/**
 * Sintetiza un archivo SKILL.md canónico y listo para producción según las directivas de DC Studio.
 */
export function synthesizeSkillDraft(input: SkillDraftInput): string {
  const slug = formatSkillSlug(input.name);
  const triggersStr = input.triggers.map((t) => t.trim().toLowerCase()).filter(Boolean).join(", ");
  const description = input.description.replace(/^Trigger:\s*/i, "").trim();
  const license = input.license || "Apache-2.0";
  const author = input.author || "dc-studio";

  const lines: string[] = [
    "---",
    `name: ${slug}`,
    `description: "Trigger: ${triggersStr}. ${description}"`,
    `license: ${license}`,
    "metadata:",
    `  author: ${author}`,
    `  version: "1.0"`,
    "---",
    "",
    "## Activation Contract",
    "",
    "Use this skill when:",
  ];

  if (input.activationWhen && input.activationWhen.length > 0) {
    for (const item of input.activationWhen) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push(`- Handling ${slug} requirements or troubleshooting related issues.`);
  }

  lines.push("");
  lines.push("Do not use when:");
  if (input.activationNotWhen && input.activationNotWhen.length > 0) {
    for (const item of input.activationNotWhen) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push(`- Generic, unrelated tasks that do not touch ${slug}.`);
  }

  lines.push("");
  lines.push("## Hard Rules");
  lines.push("");
  if (input.hardRules && input.hardRules.length > 0) {
    for (const rule of input.hardRules) {
      lines.push(`- ${rule}`);
    }
  } else {
    lines.push("- Verify public interface and assertions before concluding.");
    lines.push("- Maintain hermetic and deterministic execution without side effects.");
  }

  lines.push("");
  lines.push("## Decision Gates");
  lines.push("");
  lines.push("| Condition | Action |");
  lines.push("| :--- | :--- |");
  if (input.decisionGates && input.decisionGates.length > 0) {
    for (const gate of input.decisionGates) {
      lines.push(`| ${gate.condition} | ${gate.action} |`);
    }
  } else {
    lines.push("| Standard workflow | Follow execution steps |");
  }

  lines.push("");
  lines.push("## Execution Steps");
  lines.push("");
  if (input.steps && input.steps.length > 0) {
    for (let i = 0; i < input.steps.length; i++) {
      lines.push(`${i + 1}. ${input.steps[i]}`);
    }
  } else {
    lines.push("1. Inspect current state and dependencies.");
    lines.push("2. Apply the verified pattern.");
    lines.push("3. Execute targeted checks to prove functionality.");
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Guarda una skill curada en `skills/<slug>/SKILL.md`.
 */
export function saveCuratedSkill(
  input: SkillDraftInput,
  skillsRootDir: string = path.join(process.cwd(), "skills"),
  allowOverwrite = false
): SaveSkillResult {
  const slug = formatSkillSlug(input.name);
  const targetDir = path.join(skillsRootDir, slug);
  const targetFile = path.join(targetDir, "SKILL.md");

  if (fs.existsSync(targetFile) && !allowOverwrite) {
    return {
      saved: false,
      filePath: targetFile,
      reason: `La skill '${slug}' ya existe en '${targetFile}'. Usa allowOverwrite: true si deseas actualizarla.`,
    };
  }

  const content = synthesizeSkillDraft(input);
  const validation = validateSkillFrontmatter(content);
  if (!validation.valid) {
    return {
      saved: false,
      filePath: targetFile,
      reason: `Error de sintaxis en el frontmatter generado: ${validation.reason}`,
    };
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(targetFile, content, "utf8");

  return {
    saved: true,
    filePath: targetFile,
  };
}

/**
 * Filtra de una lista de observaciones de Engram aquellas que contienen
 * patrones reutilizables candidatos a convertirse en skills permanentes.
 */
export function extractSkillCandidatesFromObservations(observations: EngramObservation[]): EngramObservation[] {
  const eligibleTypes = new Set(["pattern", "bugfix", "discovery", "architecture"]);
  return observations.filter((obs) => {
    return eligibleTypes.has(obs.type.toLowerCase()) && Boolean(obs.title && obs.content);
  });
}
