import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  LAYOUT_NODE_SYMBOL,
  SIDEBAR_STATE_SYMBOL,
  describeComp,
  describeNode,
  probeLayout,
  runDoctorDiagnostic,
} from "../src/features/dc-doctor/dc-doctor-inspector.ts";
import dcDoctorExtension from "../src/features/dc-doctor/dc-doctor.ts";

test("describeNode and describeComp inspect layout tree structures", () => {
  // Non-object
  assert.deepEqual(describeNode(null), { type: "object" });
  assert.deepEqual(describeNode(undefined), { type: "undefined" });

  // Simple node
  const node = {
    type: "hstack",
    gap: 2,
    entries: [
      {
        basis: "auto",
        component: {
          render: (_w: number) => ["\x1b[31mHello World\x1b[0m"],
        },
      },
    ],
  };

  const desc = describeNode(node);
  assert.equal(desc.type, "hstack");
  assert.equal(desc.gap, 2);
  assert.ok(Array.isArray(desc.entries));
  assert.equal((desc.entries as any[])[0].comp.first, "Hello World");

  // Component with nested node function
  const nestedComp = {
    [LAYOUT_NODE_SYMBOL]: () => ({
      type: "vstack",
      entries: [],
    }),
  };

  const compDesc = describeComp(nestedComp as any, 0);
  assert.equal(compDesc.node, true);
  assert.equal((compDesc.nodeShape as any).type, "vstack");
});

test("probeLayout extracts root, sidebar and UI methods", () => {
  const mockTui = {
    layoutRoot: {
      [LAYOUT_NODE_SYMBOL]: () => ({
        type: "hstack",
        entries: [],
      }),
      [Symbol.for("dc.sidebar.frame-wrapped")]: true,
    },
    terminal: {
      [SIDEBAR_STATE_SYMBOL]: {
        parts: new Map([["sidebar-view", {}]]),
        active: true,
      },
    },
  };

  const mockCtx = {
    ui: {
      getEditorComponent: () => {},
      setEditorComponent: () => {},
      setHeader: () => {},
      setFooter: () => {},
      setWidget: () => {},
    },
  } as unknown as ExtensionContext;

  const probe = probeLayout(mockTui, mockCtx);
  assert.equal(probe.hasRoot, true);
  assert.equal(probe.rootWrapped, true);
  assert.equal(probe.sidebarActive, true);
  assert.deepEqual(probe.sidebarParts, ["sidebar-view"]);
  assert.ok(probe.uiMethods.includes("setHeader"));
  assert.ok(probe.uiMethods.includes("setWidget"));
});

test("runDoctorDiagnostic detects layout changes vs saved report", () => {
  const tmpDir = path.join(os.tmpdir(), `dc-doctor-test-${Date.now()}`);
  const reportFile = path.join(tmpDir, "dc-doctor.json");
  const summaryFile = path.join(tmpDir, "dc-doctor.txt");

  const mockCtx = { ui: {} } as unknown as ExtensionContext;

  try {
    // Run 1: initial run (no previous report exists)
    const tui1 = {
      layoutRoot: {
        [LAYOUT_NODE_SYMBOL]: () => ({ type: "hstack", entries: [] }),
      },
    };

    const r1 = runDoctorDiagnostic(tui1, mockCtx, { reportFile, summaryFile });
    assert.equal(r1.changed, false);
    assert.ok(fs.existsSync(reportFile));
    assert.ok(fs.existsSync(summaryFile));

    // Run 2: same shape -> changed = false
    const r2 = runDoctorDiagnostic(tui1, mockCtx, { reportFile, summaryFile });
    assert.equal(r2.changed, false);
    assert.ok(!r2.message.includes("⚠️"));

    // Run 3: shape changed -> changed = true
    const tui2 = {
      layoutRoot: {
        [LAYOUT_NODE_SYMBOL]: () => ({ type: "vstack", entries: [{ basis: 10 }] }),
      },
    };

    const r3 = runDoctorDiagnostic(tui2, mockCtx, { reportFile, summaryFile });
    assert.equal(r3.changed, true);
    assert.ok(r3.message.includes("⚠️ LA ESTRUCTURA CAMBIÓ"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("dcDoctorExtension registers only single command /dc-doctor and session_start", async () => {
  const commands = new Map<string, { description?: string; handler: Function }>();
  const events = new Map<string, Function>();

  const mockPi = {
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    on(event: string, handler: Function) {
      events.set(event, handler);
    },
  } as unknown as ExtensionAPI;

  const tmpDir = path.join(os.tmpdir(), `dc-doctor-ext-test-${Date.now()}`);
  const reportFile = path.join(tmpDir, "dc-doctor.json");

  try {
    dcDoctorExtension(mockPi, { reportFile, writeFiles: false });

    assert.equal(commands.size, 1);
    assert.ok(commands.has("dc-doctor"));
    assert.ok(events.has("session_start"));

    let anchorInstalled = false;
    let notifiedMsg = "";
    const mockCtx = {
      hasUI: true,
      mode: "tui",
      ui: {
        setWidget(id: string, factory: Function) {
          if (id === "dc-doctor-anchor") {
            anchorInstalled = true;
            factory({ layoutRoot: {} });
          }
        },
        notify(msg: string) {
          notifiedMsg = msg;
        },
      },
    } as unknown as ExtensionContext;

    // Trigger session_start
    events.get("session_start")!({}, mockCtx);
    assert.equal(anchorInstalled, true);

    // Trigger command
    const handler = commands.get("dc-doctor")!.handler;
    await handler("", mockCtx);
    assert.ok(notifiedMsg.includes("Pi"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
