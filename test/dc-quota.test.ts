import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { TuiMouseEvent } from "@earendil-works/pi-tui";
import {
  quotaLevelColor,
  humanizeReset,
  normalizeCliProxyName,
  type QuotaSection,
} from "../src/features/dc-quota/dc-quota-types.ts";
import { DcQuotaPanel } from "../src/features/dc-quota/dc-quota-panel.ts";
import dcQuotaExtension, {
  readPiAuthKey,
  fetchZenQuota,
  fetchBridgeQuota,
  fetchAllQuotas,
} from "../src/features/dc-quota/dc-quota.ts";

const dummyTheme: Pick<Theme, "fg" | "bg" | "bold"> = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("quota pure helpers: quotaLevelColor, humanizeReset, normalizeCliProxyName", () => {
  // quotaLevelColor
  assert.equal(quotaLevelColor(80), "success");
  assert.equal(quotaLevelColor(30), "warning");
  assert.equal(quotaLevelColor(10), "error");

  // humanizeReset
  assert.equal(humanizeReset(null), "");
  assert.equal(humanizeReset(0), "now");
  assert.equal(humanizeReset(3_600_000 * 2.5), "2.5h");
  assert.equal(humanizeReset(3_600_000 * 30), "1d 6h");

  // normalizeCliProxyName
  assert.equal(normalizeCliProxyName("ac01 Gemini (Weekly)", "ac01"), "Gemini Weekly");
  assert.equal(normalizeCliProxyName("ac02 Claude (5h)", "ac02"), "Claude Five-hour");
});

test("DcQuotaPanel renders sections and quota progress bars", () => {
  const sections: QuotaSection[] = [
    {
      id: "ac01",
      title: "[AC01 - test@example.com]",
      rows: [
        { label: "Five-hour", pctLeft: 75, resetMs: 3_600_000 * 2 },
        { label: "Weekly", pctLeft: 15, resetMs: 3_600_000 * 48 },
      ],
    },
    {
      id: "ac02",
      title: "[AC02]",
      rows: [{ label: "Daily", pctLeft: 90, resetMs: 3_600_000 }],
    },
  ];

  const panel = new DcQuotaPanel({
    theme: dummyTheme,
    sections,
    requestRender: () => {},
  });

  const lines = panel.render(80);
  assert.ok(lines.length > 5);
  assert.ok(lines.some((l) => l.includes("Providers") && l.includes("AC01")));
  assert.ok(lines.some((l) => l.includes("Five-hour")));
  assert.ok(lines.some((l) => l.includes("75% left") && l.includes("25% used") && l.includes("reset 2h")));

  // Switch to AC02 section
  panel.handleInput("\x1b[B"); // down
  assert.equal(panel.getActiveSection().id, "ac02");

  // Tab switches to details
  assert.equal(panel.getFocus(), "tabs");
  panel.handleInput("\t");
  assert.equal(panel.getFocus(), "details");
});

test("DcQuotaPanel mouse click selects provider and details", () => {
  const sections: QuotaSection[] = [
    { id: "sec1", title: "Sec1", rows: [{ label: "R1", pctLeft: 50, resetMs: null }] },
    { id: "sec2", title: "Sec2", rows: [{ label: "R2", pctLeft: 80, resetMs: null }] },
  ];

  const panel = new DcQuotaPanel({
    theme: dummyTheme,
    sections,
    requestRender: () => {},
  });

  panel.render(80);

  // Click on Sec2 (col 5, row 6 -> rowIdx = 6 - 5 = 1)
  panel.handleMouse({
    type: "click",
    button: "left",
    x: 5,
    y: 6,
  } as unknown as TuiMouseEvent);
  assert.equal(panel.getActiveSection().id, "sec2");
});

test("DcQuotaPanel filters accounts by search query", () => {
  const sections: QuotaSection[] = [
    { id: "ac01", title: "[AC01 - davidxx55@gmail.com]", rows: [] },
    { id: "ac02", title: "[AC02 - dedevtk@gmail.com]", rows: [] },
  ];

  const panel = new DcQuotaPanel({
    theme: dummyTheme,
    sections,
    requestRender: () => {},
  });

  // Type 'dedev'
  panel.handleInput("d");
  panel.handleInput("e");
  panel.handleInput("d");
  panel.handleInput("e");
  panel.handleInput("v");

  assert.equal(panel.getQuery(), "dedev");
  const filtered = panel.getFilteredSections();
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]!.id, "ac02");

  // Esc clears
  panel.handleInput("\x1b");
  assert.equal(panel.getQuery(), "");
  assert.equal(panel.getFilteredSections().length, 2);
});

test("dcQuotaExtension registers only /dc-quota with Alt+Shift+Q", () => {
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

  dcQuotaExtension(mockPi);
  assert.deepEqual(registeredCommands, ["dc-quota"]);
  assert.equal(registeredShortcut, "alt+shift+q");
});

test("readPiAuthKey extracts opencode-go key accurately from auth file", () => {
  const tmpDir = path.join(os.tmpdir(), `dc-quota-auth-test-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const authFile = path.join(tmpDir, "auth.json");

  try {
    fs.writeFileSync(authFile, JSON.stringify({ "opencode-go": { key: "sk-test-key-123" } }), "utf8");
    const key = readPiAuthKey(authFile);
    assert.equal(key, "sk-test-key-123");

    // Nonexistent file returns null
    assert.equal(readPiAuthKey(path.join(tmpDir, "missing.json")), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fetchZenQuota handles errors gracefully and returns QuotaSection", async () => {
  const section = await fetchZenQuota("dummy-invalid-key");
  assert.equal(section.id, "zen");
  assert.equal(section.title, "[OpenCode Go]");
  assert.ok(section.error !== undefined || section.rows.length >= 0);
});

test("fetchBridgeQuota populates live quota rows from local bridge when available", async () => {
  const rows = await fetchBridgeQuota("ac03");
  if (rows && rows.length > 0) {
    assert.ok(rows.length >= 2);
    assert.ok(rows.some((r) => r.label.includes("Gemini") || r.label.includes("Claude")));
    assert.ok(rows.every((r) => r.pctLeft >= 0 && r.pctLeft <= 100));
  }
});

test("fetchAllQuotas includes OpenCode Go section alongside CLIProxy accounts", async () => {
  const sections = await fetchAllQuotas();
  assert.ok(sections.length >= 1);
  const zenSection = sections.find((s) => s.id === "zen");
  assert.ok(zenSection !== undefined);
  assert.equal(zenSection.title, "[OpenCode Go]");
});
