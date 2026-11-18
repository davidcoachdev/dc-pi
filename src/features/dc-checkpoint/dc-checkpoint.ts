/**
 * dc-checkpoint — Worktree snapshot and rollback tool for DC Studio.
 *
 * Saves diff.patch, status.txt, head.txt, meta.json and a restore.sh
 * under .pi/checkpoints/<id>/ prior to risky subagent or refactoring runs.
 */

import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const VALID_HEAD_RE = /^(?:[0-9a-f]{7,64}|HEAD)$/i;

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface CheckpointResult {
  ok: boolean;
  id: string;
  dir: string;
  head: string;
  dirty: boolean;
  untracked: string[];
  message?: string;
}

export function generateCheckpointId(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function untrackedFromStatus(status: string): string[] {
  return status
    .split(/\r?\n/)
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

export function createCheckpoint(
  nameOrSlug = "snapshot",
  cwd = process.cwd(),
  now = new Date(),
): CheckpointResult {
  const sanitizedName = nameOrSlug.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-") || "snapshot";

  const rootCheck = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  if (rootCheck.status !== 0) {
    return { ok: false, id: "", dir: "", head: "", dirty: false, untracked: [], message: "El directorio actual no es un repositorio Git" };
  }
  const repoRoot = rootCheck.stdout.trim() || cwd;

  const headCheck = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  if (headCheck.status !== 0) {
    return { ok: false, id: "", dir: "", head: "", dirty: false, untracked: [], message: "No se pudo resolver HEAD en Git" };
  }
  const head = headCheck.stdout.trim();
  if (!VALID_HEAD_RE.test(head)) {
    return { ok: false, id: "", dir: "", head: "", dirty: false, untracked: [], message: "Hash HEAD inválido en Git" };
  }

  const statusCheck = spawnSync("git", ["status", "--short"], { cwd: repoRoot, encoding: "utf8" });
  const diffCheck = spawnSync("git", ["diff", "--binary", "HEAD"], { cwd: repoRoot, encoding: "utf8" });

  if (statusCheck.status !== 0 || diffCheck.status !== 0) {
    return { ok: false, id: "", dir: "", head, dirty: false, untracked: [], message: "Error al leer el estado o diff de Git" };
  }

  const untracked = untrackedFromStatus(statusCheck.stdout);
  const dirty = statusCheck.stdout.trim() !== "";

  const id = `${generateCheckpointId(now)}-${sanitizedName}`;
  const dir = join(repoRoot, ".pi", "checkpoints", id);
  mkdirSync(dir, { recursive: true });

  const untrackedDir = join(dir, "untracked");
  for (const rawEntry of untracked) {
    const cleanEntry = rawEntry.startsWith('"') && rawEntry.endsWith('"')
      ? rawEntry.slice(1, -1)
      : rawEntry;
    if (!cleanEntry || cleanEntry === ".pi" || cleanEntry.startsWith(".pi/") || cleanEntry.startsWith(".pi\\")) {
      continue;
    }
    const srcPath = resolve(repoRoot, cleanEntry);
    const destPath = resolve(untrackedDir, cleanEntry);
    const relSrc = relative(repoRoot, srcPath);
    const relDest = relative(untrackedDir, destPath);
    if (
      relSrc &&
      !relSrc.startsWith("..") &&
      relDest &&
      !relDest.startsWith("..") &&
      existsSync(srcPath)
    ) {
      mkdirSync(dirname(destPath), { recursive: true });
      cpSync(srcPath, destPath, { recursive: true });
    }
  }

  const diffPatchPath = join(dir, "diff.patch");
  writeFileSync(join(dir, "head.txt"), `${head}\n`, "utf8");
  writeFileSync(join(dir, "status.txt"), statusCheck.stdout, "utf8");
  writeFileSync(diffPatchPath, diffCheck.stdout, "utf8");
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({ name: sanitizedName, id, head, dirty, untracked, createdAt: now.toISOString() }, null, 2) + "\n",
    "utf8",
  );

  const restoreScript = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `# DC Studio Snapshot Restore — ${id}`,
    `# Restaura archivos trackeados al commit base ${head} y reaplica el diff.patch`,
    `echo ${shellQuote(`Restaurando estado a checkpoint ${id}...`)}`,
    `git reset --hard ${shellQuote(head)}`,
    `if [ -s ${shellQuote(diffPatchPath)} ]; then`,
    `  git apply --3way ${shellQuote(diffPatchPath)}`,
    "fi",
    `if [ -d ${shellQuote(untrackedDir)} ]; then`,
    `  cp -a ${shellQuote(untrackedDir)}/. ${shellQuote(repoRoot)}/`,
    "fi",
    'echo "Restauración completada con éxito."',
    "",
  ].join("\n");

  writeFileSync(join(dir, "restore.sh"), restoreScript, { encoding: "utf8", mode: 0o755 });

  return { ok: true, id, dir, head, dirty, untracked };
}
