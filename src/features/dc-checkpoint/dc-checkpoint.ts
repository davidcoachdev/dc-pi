/**
 * dc-checkpoint — Worktree snapshot and rollback tool for DC Studio.
 *
 * Saves diff.patch, status.txt, head.txt, meta.json and a restore.sh
 * under .pi/checkpoints/<id>/ prior to risky subagent or refactoring runs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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

  const statusCheck = spawnSync("git", ["status", "--short"], { cwd: repoRoot, encoding: "utf8" });
  const diffCheck = spawnSync("git", ["diff", "--binary", "HEAD"], { cwd: repoRoot, encoding: "utf8" });

  if (statusCheck.status !== 0 || diffCheck.status !== 0) {
    return { ok: false, id: "", dir: "", head, dirty: false, untracked: [], message: "Error al leer el estado o diff de Git" };
  }

  const id = `${generateCheckpointId(now)}-${sanitizedName}`;
  const dir = join(repoRoot, ".pi", "checkpoints", id);
  mkdirSync(dir, { recursive: true });

  const untracked = untrackedFromStatus(statusCheck.stdout);
  const dirty = statusCheck.stdout.trim() !== "";

  writeFileSync(join(dir, "head.txt"), `${head}\n`, "utf8");
  writeFileSync(join(dir, "status.txt"), statusCheck.stdout, "utf8");
  writeFileSync(join(dir, "diff.patch"), diffCheck.stdout, "utf8");
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
    `echo "Restaurando estado a checkpoint ${id}..."`,
    `git reset --hard ${head}`,
    `git apply --3way "${join(dir, "diff.patch")}"`,
    'echo "Restauración completada con éxito."',
    "",
  ].join("\n");

  writeFileSync(join(dir, "restore.sh"), restoreScript, { encoding: "utf8", mode: 0o755 });

  return { ok: true, id, dir, head, dirty, untracked };
}
