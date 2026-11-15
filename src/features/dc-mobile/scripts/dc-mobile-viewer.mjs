#!/usr/bin/env node
/**
 * dc-mobile live viewer (S5).
 *
 * Usage: node dc-mobile-viewer.mjs <frame.png>
 *
 * Watches the frame directory with fs.watch and redraws only when the watched
 * file changes. No timers and no polling: refreshes are event-driven.
 */

import { spawnSync } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { basename, dirname } from "node:path";

const framePath = process.argv[2];

if (!framePath) {
  process.stderr.write("uso: dc-mobile-viewer.mjs <frame.png>\n");
  process.exit(2);
}

const frameDir = dirname(framePath);
const frameName = basename(framePath);

// DC Studio palette: background #100a0d, deep red #330000, red #ff3333,
// foreground #ffcccc.
const RESET = "\x1b[0m";
const CLEAR = "\x1b[2J\x1b[H";
const BG = "\x1b[48;2;16;10;13m";
const ACCENT = "\x1b[38;2;255;51;51m";
const FOREGROUND = "\x1b[38;2;255;204;204m";
const DEEP_RED = "\x1b[48;2;51;0;0m";

let closed = false;
let drawing = false;

function terminalSize() {
  return {
    columns: Math.max(20, process.stdout.columns || 100),
    rows: Math.max(6, process.stdout.rows || 40),
  };
}

function writeLine(text) {
  process.stdout.write(`${text}\n`);
}

function drawWaiting(message) {
  process.stdout.write(
    `${BG}${FOREGROUND} ${message}${RESET}\n`,
  );
}

function draw() {
  if (closed || drawing) return;
  drawing = true;

  try {
    const { columns, rows } = terminalSize();

    process.stdout.write(CLEAR);

    // Frameless header: no borders, only colored bands.
    writeLine(
      `${BG}${ACCENT}\u258c${FOREGROUND} DC MOBILE ${ACCENT}\u00b7${FOREGROUND} ${frameName}${RESET}`,
    );
    writeLine(
      `${DEEP_RED}${ACCENT}${"\u2500".repeat(columns)}${RESET}`,
    );

    if (!existsSync(framePath)) {
      drawWaiting("esperando frame...");
      return;
    }

    const place = `${Math.max(1, columns - 2)}x${Math.max(1, rows - 3)}@1x2`;
    const result = spawnSync(
      "kitten",
      ["icat", "--place", place, framePath],
      { stdio: "inherit" },
    );

    if (result.error) {
      drawWaiting("kitten icat no está disponible; instalá Kitty para ver el frame.");
    }
  } finally {
    drawing = false;
  }
}

function cleanup(exitCode = 0) {
  if (closed) return;
  closed = true;

  try {
    watcher.close();
  } catch {
    // Watcher may already be closed.
  }

  try {
    process.stdout.write(`${RESET}${CLEAR}`);
  } catch {
    // Terminal may already be gone.
  }

  process.exit(exitCode);
}

let watcher;

try {
  watcher = watch(frameDir, (_event, filename) => {
    if (!filename) return;
    if (filename.toString() !== frameName) return;
    draw();
  });
} catch (error) {
  process.stderr.write(
    `dc-mobile-viewer: no se pudo observar ${frameDir}: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

watcher.on("error", () => cleanup(1));

process.stdout.on("resize", draw);

process.on("SIGTERM", () => cleanup(0));
process.on("SIGINT", () => cleanup(0));

draw();
