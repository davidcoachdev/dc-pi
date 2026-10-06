import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import { parseGitStatus, type GitWorktreeItem } from "../src/integrations/dc-git/dc-git.ts";
import { DcChangesPanel } from "../src/features/dc-changes/dc-changes-panel.ts";
import dcChangesExtension from "../src/features/dc-changes/dc-changes.ts";

const dummyTheme: Pick<Theme, "fg" | "bg" | "bold"> = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("parseGitStatus correctly parses porcelain output", () => {
  const sample = ` M src/ui/dc-window.ts\n?? new-file.ts\nA  staged-file.ts\n D deleted.ts`;
  const parsed = parseGitStatus(sample);

  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].status, "M");
  assert.equal(parsed[0].file, "src/ui/dc-window.ts");

  assert.equal(parsed[1].status, "??");
  assert.equal(parsed[1].file, "new-file.ts");

  assert.equal(parsed[2].status, "A");
  assert.equal(parsed[3].status, "D");
});

test("DcChangesPanel renders two panels and handles navigation", () => {
  let renders = 0;
  let openedFile: string | undefined;

  const mockChanges = [
    { status: "M", file: "src/file1.ts" },
    { status: "??", file: "test/file2.test.ts" },
  ];

  const panel = new DcChangesPanel({
    cwd: "/fake",
    theme: dummyTheme,
    getChanges: () => mockChanges,
    getDiff: (_cwd, file) => [`diff for ${file}`, "+added line", "-removed line"],
    onOpenEditor: (f) => { openedFile = f; },
    requestRender: () => { renders++; },
  });

  const lines = panel.render(80);
  assert.equal(lines.length, 36); // Altura mínima de 36 filas (+12 adicionales)
  assert.ok(lines.some((l) => l.includes("src/file1.ts")));
  assert.ok(lines.some((l) => l.includes("│"))); // divider
  assert.ok(lines.some((l) => l.includes("diff for src/file1.ts")));
  assert.ok(lines.some((l) => l.includes("╭─") && l.includes("📄"))); // Formato dc-code box con título y bordes redondeados

  // Down to file 2
  assert.equal(panel.handleInput("\x1b[B"), true);
  assert.equal(panel.getSelectedIndex(), 1);
  assert.equal(panel.getSelectedFile()?.file, "test/file2.test.ts");

  // Enter to edit
  assert.equal(panel.handleInput("\r"), true);
  assert.equal(openedFile, "test/file2.test.ts");

  // Mouse click on file 1
  panel.handleMouse({
    type: "click",
    button: "left",
    x: 5,
    y: 0,
  } as unknown as TuiMouseEvent);
  assert.equal(panel.getSelectedIndex(), 0);
});

test("DcChangesPanel multi-worktree navigation with w/W keys", () => {
  const mockWorktrees: GitWorktreeItem[] = [
    { path: "/repo/main", branch: "main", head: "1234567", isCurrent: true },
    { path: "/repo/feature", branch: "feat-x", head: "7654321", isCurrent: false },
  ];

  const panel = new DcChangesPanel({
    cwd: "/repo/main",
    theme: dummyTheme,
    listWorktreesFn: () => mockWorktrees,
    getChanges: (wt) => wt.includes("feature")
      ? [{ status: "M", file: "feature-file.ts" }]
      : [{ status: "M", file: "main-file.ts" }],
    getDiff: (_cwd, file) => [`diff for ${file}`],
    requestRender: () => {},
  });

  assert.equal(panel.getActiveWorktree().branch, "main");
  assert.equal(panel.getFiles()[0]!.file, "main-file.ts");

  // Presionar 'w' para pasar al siguiente worktree (feat-x)
  panel.handleInput("w");
  assert.equal(panel.getActiveWorktree().branch, "feat-x");
  assert.equal(panel.getFiles()[0]!.file, "feature-file.ts");

  // Presionar 'W' para volver a main
  panel.handleInput("W");
  assert.equal(panel.getActiveWorktree().branch, "main");
  assert.equal(panel.getFiles()[0]!.file, "main-file.ts");

  const lines = panel.render(80);
  assert.ok(lines.some((l) => l.includes("Worktrees:") && l.includes("feat-x")));
});

test("dcChangesExtension registers only /dc-changes with Alt+F", () => {
  const registeredCommands: string[] = [];
  let registeredShortcut: string | undefined;

  const mockPi = {
    registerCommand(name: string) {
      registeredCommands.push(name);
    },
    registerShortcut(name: string) {
      registeredShortcut = name;
    },
  } as unknown as ExtensionAPI;

  dcChangesExtension(mockPi);
  assert.deepEqual(registeredCommands, ["dc-changes"]);
  assert.equal(registeredShortcut, "alt+f");
});
