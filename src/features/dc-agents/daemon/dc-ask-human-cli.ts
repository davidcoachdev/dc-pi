#!/usr/bin/env node
/**
 * CLI Helper: dc-ask-human
 * Permite a cualquier worker o script en background realizar una pregunta con contexto enriquecido
 * al usuario humano y pausar la ejecución hasta que el usuario responda en la ventana modal de Pi.
 *
 * Uso:
 *   node dc-ask-human.js --issue=13 --context="Leí el archivo X..." --question="¿A o B?" --options="Opción A|Opción B"
 */

import { dcRemoteQuestionManager } from "./dc-remote-question.ts";

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2);
  const map: Record<string, string> = {};
  for (const a of args) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        const k = a.slice(2, eq);
        const v = a.slice(eq + 1);
        map[k] = v;
      }
    }
  }
  return map;
}

async function main() {
  const args = parseArgs();
  const issueNumber = Number(args.issue || 0);
  const issueTitle = args.title || `Issue #${issueNumber}`;
  const contextSummary = args.context || "El subagente está analizando la solución en el worktree.";
  const question = args.question || "¿Cómo deseas proceder?";
  const rawOptions = args.options || "Continuar|Cancelar";
  const options = rawOptions.split("|").map((s) => s.trim()).filter(Boolean);

  const packet = dcRemoteQuestionManager.postQuestion({
    issueNumber,
    issueTitle,
    contextSummary,
    question,
    options,
    allowCustomText: true,
  });

  process.stderr.write(`[dc-ask-human] Pregunta ${packet.id} enviada al usuario. Esperando respuesta...\n`);

  // Esperar respuesta humana
  const answer = await dcRemoteQuestionManager.waitForAnswer(packet.id);

  if (answer.customText) {
    process.stdout.write(`RESPUESTA_HUMANA: ${answer.customText}\n`);
  } else if (answer.chosenOption) {
    process.stdout.write(`OPCION_ELEGIDA: ${answer.chosenOption}\n`);
  } else {
    process.stdout.write(`DISMISSED\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`[dc-ask-human] Error: ${err.message}\n`);
    process.exit(1);
  });
}
