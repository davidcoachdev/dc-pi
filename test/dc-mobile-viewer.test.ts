import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
  buildViewerScriptArgs,
  formatViewerFailure,
  getLatestFrameMtime,
  getLatestFramePath,
  openLiveViewer,
  resetLiveViewerTracking,
  saveFrame,
  type DcLiveViewerFailureReason,
} from "../src/features/dc-mobile/core/dc-mobile-viewer.ts";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

interface FakeChild {
  pid: number;
  handlers: Map<string, (...args: unknown[]) => void>;
  on(event: string, handler: (...args: unknown[]) => void): FakeChild;
  unref(): void;
}

function fakeChild(pid = 4321): FakeChild {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const child: FakeChild = {
    pid,
    handlers,
    on(event, handler) {
      handlers.set(event, handler);
      return child;
    },
    unref() {
      /* nothing to detach in a fake */
    },
  };
  return child;
}

interface SpawnCall {
  file: string;
  args: string[];
  options: { detached?: boolean; stdio?: unknown };
}

function makeSpawn(pid = 4321) {
  const calls: SpawnCall[] = [];
  const children: FakeChild[] = [];
  const spawnFn = ((file: string, args: string[], options: SpawnCall["options"]) => {
    calls.push({ file, args, options });
    const child = fakeChild(pid);
    children.push(child);
    return child;
  }) as unknown as typeof spawn;

  return { calls, children, spawnFn };
}

function makeExec(available: { adb?: boolean; kitty?: boolean } = {}) {
  const calls: { file: string; args: string[] }[] = [];

  const execFn = (file: string, args: string[]): string => {
    calls.push({ file, args });
    if (file === "adb" && available.adb === false) throw new Error("spawn adb ENOENT");
    if (file === "kitty" && available.kitty === false) throw new Error("spawn kitty ENOENT");
    return "ok";
  };

  return { calls, execFn };
}

function makeCacheRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "dc-mobile-viewer-"));
}

/**
 * The compiled test tree does not contain the `.mjs` script, so every test that
 * expects a successful launch points at a stub script instead of the real one.
 */
function makeStubScript(cacheRoot: string): string {
  const scriptPath = path.join(cacheRoot, "viewer-script.mjs");
  writeFileSync(scriptPath, "// stub: the detached child is never spawned in tests\n");
  return scriptPath;
}

test("viewer T4/S3: script arguments carry serial, latest frame, adb and cadence", () => {
  resetLiveViewerTracking();
  const cacheRoot = makeCacheRoot();
  const { calls, spawnFn } = makeSpawn();
  const { execFn } = makeExec();
  const scriptPath = makeStubScript(cacheRoot);

  try {
    const result = openLiveViewer("192.168.100.222:34661", {
      cacheRoot,
      execFn,
      spawnFn,
      scriptPath,
      kittyBin: "kitty",
    });

    assert.equal(result.viewer, "started");
    assert.equal(result.failureReason, undefined);
    assert.equal(result.pid, 4321);
    assert.equal(calls.length, 1, "exactly one detached kitty spawn");

    const spawnCall = calls[0];
    assert.equal(spawnCall.file, "kitty");
    assert.equal(spawnCall.options.detached, true);
    assert.equal(spawnCall.options.stdio, "ignore", "the child never owns the TUI fds");

    const scriptIndex = spawnCall.args.indexOf(scriptPath);
    assert.ok(scriptIndex >= 0, "the detached child is the viewer script");
    assert.equal(spawnCall.args[scriptIndex - 1], process.execPath);

    assert.deepEqual(spawnCall.args.slice(scriptIndex + 1), [
      "--serial",
      "192.168.100.222:34661",
      "--frame",
      getLatestFramePath("192.168.100.222:34661", cacheRoot),
      "--adb",
      "adb",
      "--interval",
      "1000",
    ]);
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("viewer T4/S3: the cadence is forwarded and defaults to one frame per second", () => {
  assert.deepEqual(
    buildViewerScriptArgs({ serial: "S1", framePath: "/tmp/latest.png" }).slice(4),
    ["--adb", "adb", "--interval", "1000"],
  );
  assert.deepEqual(
    buildViewerScriptArgs({
      serial: "S1",
      framePath: "/tmp/latest.png",
      adbBin: "/opt/adb",
      intervalMs: 2_500,
    }).slice(4),
    ["--adb", "/opt/adb", "--interval", "2500"],
  );
});

test("viewer T2/S4: adb is validated up front and fails with a reason, never a spawn", () => {
  resetLiveViewerTracking();
  const cacheRoot = makeCacheRoot();
  const { calls, spawnFn } = makeSpawn();
  const { execFn, calls: execCalls } = makeExec({ adb: false });

  try {
    const result = openLiveViewer("USB123", { cacheRoot, execFn, spawnFn, adbBin: "adb" });

    assert.equal(result.viewer, "unavailable");
    assert.equal(result.failureReason, "adb-no-disponible");
    assert.equal(calls.length, 0, "no window is opened over a capture loop that cannot run");
    assert.ok(execCalls.some((call) => call.file === "adb"), "adb was probed");
    assert.match(result.message, /adb no disponible/);
    assert.match(result.message, /adb/);
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("viewer T2/S4: kitty and script failures map to their own reasons", () => {
  resetLiveViewerTracking();
  const cacheRoot = makeCacheRoot();
  const { spawnFn } = makeSpawn();

  try {
    const noKitty = openLiveViewer("USB123", {
      cacheRoot,
      execFn: makeExec({ kitty: false }).execFn,
      spawnFn,
    });
    assert.equal(noKitty.viewer, "unavailable");
    assert.equal(noKitty.failureReason, "kitty-no-disponible");
    assert.match(noKitty.message, /kitty no está disponible/);
    assert.ok(noKitty.message.includes(noKitty.latestPath), "the saved frame is still named");

    const noScript = openLiveViewer("USB123", {
      cacheRoot,
      execFn: makeExec().execFn,
      spawnFn,
      scriptPath: path.join(cacheRoot, "missing-viewer.mjs"),
    });
    assert.equal(noScript.failureReason, "script-ausente");
    assert.match(noScript.message, /script del visor/);
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("viewer T2/S4: an async spawn error is recorded through onFailure, not discarded", () => {
  resetLiveViewerTracking();
  const cacheRoot = makeCacheRoot();
  const { children, spawnFn } = makeSpawn();
  const failures: { reason: DcLiveViewerFailureReason; message: string }[] = [];
  const scriptPath = makeStubScript(cacheRoot);

  try {
    const result = openLiveViewer("USB123", {
      cacheRoot,
      execFn: makeExec().execFn,
      spawnFn,
      scriptPath,
      onFailure: (reason, message) => failures.push({ reason, message }),
    });

    assert.equal(result.viewer, "started", "the sync result still reports the spawn");
    children[0]?.handlers.get("error")?.(new Error("spawn kitty ENOENT"));

    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.reason, "spawn-fallido");
    assert.match(failures[0]?.message ?? "", /ENOENT/);
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("viewer T2: a throwing spawn returns spawn-fallido instead of throwing", () => {
  resetLiveViewerTracking();
  const cacheRoot = makeCacheRoot();
  const spawnFn = (() => {
    throw new Error("EPERM");
  }) as unknown as typeof spawn;
  const scriptPath = makeStubScript(cacheRoot);

  try {
    const result = openLiveViewer("USB123", {
      cacheRoot,
      execFn: makeExec().execFn,
      spawnFn,
      scriptPath,
    });
    assert.equal(result.viewer, "unavailable");
    assert.equal(result.failureReason, "spawn-fallido");
    assert.match(result.message, /EPERM/);
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("viewer T2: empty serial is its own reason and opens nothing", () => {
  resetLiveViewerTracking();
  const cacheRoot = makeCacheRoot();
  const { calls, spawnFn } = makeSpawn();

  try {
    const result = openLiveViewer("   ", { cacheRoot, execFn: makeExec().execFn, spawnFn });
    assert.equal(result.viewer, "unavailable");
    assert.equal(result.failureReason, "serial-vacio");
    assert.equal(calls.length, 0);
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("viewer T2/S4: every failure reason has a distinct, non-empty text", () => {
  const reasons: DcLiveViewerFailureReason[] = [
    "serial-vacio",
    "adb-no-disponible",
    "kitty-no-disponible",
    "script-ausente",
    "spawn-fallido",
  ];

  const messages = reasons.map((reason) => formatViewerFailure(reason));
  for (const message of messages) {
    assert.ok(message.trim().length > 0, "a failure always has text for the window");
  }
  assert.equal(new Set(messages).size, reasons.length, "reasons stay distinguishable");
  assert.match(formatViewerFailure("adb-no-disponible", "device offline"), /device offline/);
});

test("viewer S7: the explicit-frame open path still copies into latest.png and starts", () => {
  resetLiveViewerTracking();
  const cacheRoot = makeCacheRoot();
  const { calls, spawnFn } = makeSpawn();
  const { execFn } = makeExec();
  const scriptPath = makeStubScript(cacheRoot);

  try {
    const framePath = path.join(cacheRoot, "frame-explicit.png");
    writeFileSync(framePath, PNG_BYTES);

    const result = openLiveViewer("USB123", {
      cacheRoot,
      framePath,
      execFn,
      spawnFn,
      scriptPath,
    });

    assert.equal(result.viewer, "started");
    assert.equal(result.framePath, framePath, "the explicit frame is still the reported frame");
    assert.equal(result.latestPath, getLatestFramePath("USB123", cacheRoot));
    assert.deepEqual(
      readFileSync(result.latestPath),
      PNG_BYTES,
      "the explicit frame reached latest.png",
    );

    const spawnCall = calls[0];
    const scriptIndex = spawnCall.args.indexOf(scriptPath);
    assert.deepEqual(spawnCall.args.slice(scriptIndex + 1), [
      "--serial",
      "USB123",
      "--frame",
      result.latestPath,
      "--adb",
      "adb",
      "--interval",
      "1000",
    ]);
    assert.equal(readFileSync(framePath).equals(PNG_BYTES), true, "explicit frame untouched");
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("viewer S7: saveFrame keeps writing frame-<ts>.png plus latest.png byte for byte", () => {
  const cacheRoot = makeCacheRoot();

  try {
    const saved = saveFrame("USB123", PNG_BYTES, cacheRoot);

    assert.match(path.basename(saved.framePath), /^frame-.*\.png$/);
    assert.equal(path.basename(saved.latestPath), "latest.png");
    assert.equal(
      path.dirname(saved.framePath),
      path.dirname(saved.latestPath),
      "both files live in the serial cache directory",
    );
    assert.deepEqual(readFileSync(saved.framePath), PNG_BYTES);
    assert.deepEqual(readFileSync(saved.latestPath), PNG_BYTES);
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("viewer T4: a running viewer is reused instead of duplicated", () => {
  resetLiveViewerTracking();
  const cacheRoot = makeCacheRoot();
  // A live pid keeps the reuse branch deterministic (no real kitty involved).
  const { calls, spawnFn } = makeSpawn(process.pid);
  const { execFn } = makeExec();
  const scriptPath = makeStubScript(cacheRoot);

  try {
    const first = openLiveViewer("USB123", { cacheRoot, execFn, spawnFn, scriptPath });
    const second = openLiveViewer("USB123", { cacheRoot, execFn, spawnFn, scriptPath });

    assert.equal(first.viewer, "started");
    assert.equal(second.viewer, "reused");
    assert.equal(second.pid, first.pid);
    assert.equal(calls.length, 1, "one Kitty window per serial");
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});

test("viewer T3/S5: latest frame freshness comes from the file mtime", () => {
  const cacheRoot = makeCacheRoot();

  try {
    assert.equal(getLatestFrameMtime("USB123", cacheRoot), undefined, "absent → undefined");

    const saved = saveFrame("USB123", PNG_BYTES, cacheRoot);
    const stamp = new Date("2026-01-02T09:08:07.000Z");
    utimesSync(saved.latestPath, stamp, stamp);

    const mtime = getLatestFrameMtime("USB123", cacheRoot);
    assert.equal(typeof mtime, "number");
    assert.equal(Math.round(mtime ?? 0), stamp.getTime());
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
});
