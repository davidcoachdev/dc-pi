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
  assert.equal(humanizeReset(0), "ahora");
  assert.equal(humanizeReset(3_600_000 * 2.5), "2h 30m");
  assert.equal(humanizeReset(3_600_000 * 30), "1d 6h");

  // normalizeCliProxyName
  assert.equal(normalizeCliProxyName("ac01 Gemini (Weekly)", "ac01"), "Gemini Weekly");
  assert.equal(normalizeCliProxyName("ac02 Claude (5h)", "ac02"), "Claude Five-hour");
});

test("DcQuotaPanel renders sections, quota progress bars, and OpenAI resets", () => {
  const sections: QuotaSection[] = [
    {
      id: "cc1",
      title: "[CC1 - test@example.com]",
      resetCredits: 5,
      resetRenewalDate: "2026-10-20T12:00:00Z",
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
  assert.ok(lines.some((l) => l.includes("Cuentas") && l.includes("CC1")));
  assert.ok(lines.some((l) => l.includes("5 reset(s) disponible(s)")));
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

  // Click on Sec2 (col 5, row 5 -> rowIdx = 5 - 4 = 1)
  panel.handleMouse({
    type: "click",
    button: "left",
    x: 5,
    y: 5,
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
